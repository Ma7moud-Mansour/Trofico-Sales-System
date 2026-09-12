import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DateTime } from "luxon";
const base = process.env.TEST_API_URL || "http://127.0.0.1:4002/api/v1";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Isolated test database required");
const pool = new pg.Pool({ connectionString: url });
const accounts = JSON.parse(
  readFileSync(".runtime/test-accounts.json", "utf8"),
);
class Client {
  cookies = new Map();
  csrf = "";
  constructor(account) {
    this.account = account;
  }
  async call(path, method = "GET", body, options = {}) {
    if (method !== "GET" && !this.csrf && !options.skipCsrf)
      await this.bootstrap();
    const r = await fetch(base + "/" + path, {
      method,
      headers: {
        Cookie: [...this.cookies].map(([k, v]) => k + "=" + v).join("; "),
        Origin: options.origin || "http://localhost:3000",
        ...(method === "GET"
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-Token": options.skipCsrf ? "" : this.csrf,
              "Idempotency-Key": options.key || randomUUID(),
            }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const n = pair.indexOf("=");
      this.cookies.set(pair.slice(0, n), pair.slice(n + 1));
    }
    const json = await r.json();
    return {
      status: r.status,
      data: json.data,
      error: json.error,
      headers: r.headers,
    };
  }
  async bootstrap() {
    const r = await this.call("auth/csrf");
    assert.equal(r.status, 200);
    this.csrf = r.data.token;
  }
  async login() {
    await this.bootstrap();
    const r = await this.call("auth/login", "POST", {
      username: this.account.username,
      password: this.account.password,
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    this.csrf = "";
    await this.bootstrap();
    return r;
  }
  async ok(path, method = "GET", body, options) {
    const r = await this.call(path, method, body, options);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data;
  }
}
const clients = {};
let customer, products;
before(async () => {
  for (const a of accounts) {
    clients[a.role] = new Client(a);
    await clients[a.role].login();
  }
  const w = await clients.SUPER_ADMIN.ok("workspace");
  customer = w.customers[0];
  products = w.products.filter((p) =>
    ["MAN-01", "ORG-01", "APP-01"].includes(p.sku),
  );
});
after(() => pool.end());
test("B26 Cairo DST day uses UTC start and exclusive next-day boundary", async () => {
  const a = await make(),
    b = await make();
  const start = DateTime.fromISO("2026-04-24", {
    zone: "Africa/Cairo",
  }).startOf("day");
  const end = start.plus({ days: 1 }).startOf("day");
  assert.equal(end.diff(start, "hours").hours, 23);
  await pool.query("UPDATE orders SET submitted_at=$2 WHERE id=$1", [
    a.id,
    start.toUTC().toISO(),
  ]);
  await pool.query("UPDATE orders SET submitted_at=$2 WHERE id=$1", [
    b.id,
    end.toUTC().toISO(),
  ]);
  const r = await clients.SALES_REP.ok(
    "orders?from=2026-04-24&to=2026-04-24&pageSize=100",
  );
  assert.ok(r.items.some((o) => o.id === a.id));
  assert.ok(!r.items.some((o) => o.id === b.id));
});
test("B27 backend restart preserves committed orders and opaque sessions", async () => {
  const childEnv = {
    ...process.env,
    DATABASE_URL: url,
    NODE_ENV: "test",
    PORT: "4061",
  };
  const launch = async () => {
    const child = spawn(process.execPath, ["backend/dist/main.js"], {
      env: childEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    for (let n = 0; n < 100; n++) {
      try {
        const r = await fetch("http://127.0.0.1:4061/api/v1/health/live");
        if (r.ok) return child;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill();
    throw Error("Restart test server failed to start");
  };
  const cookie = [...clients.SALES_REP.cookies]
    .map(([k, v]) => k + "=" + v)
    .join("; ");
  let child = await launch();
  try {
    const before = await fetch("http://127.0.0.1:4061/api/v1/orders", {
      headers: { Cookie: cookie },
    }).then((r) => r.json());
    child.kill();
    await once(child, "exit");
    child = await launch();
    const me = await fetch("http://127.0.0.1:4061/api/v1/auth/me", {
      headers: { Cookie: cookie },
    });
    assert.equal(me.status, 200);
    const after = await fetch("http://127.0.0.1:4061/api/v1/orders", {
      headers: { Cookie: cookie },
    }).then((r) => r.json());
    assert.deepEqual(after.data, before.data);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
test("Database runtime privileges, UTC timestamps, private audit and deleted-draft retry", async () => {
  const privilege = await pool.query(
    "SELECT has_table_privilege(current_user,'stock_movements','UPDATE') ledger,has_table_privilege(current_user,'activity_events','DELETE') audit",
  );
  assert.equal(privilege.rows[0].ledger, false);
  assert.equal(privilege.rows[0].audit, false);
  const d = await clients.SALES_REP.ok("orders", "POST", {
    customerId: "",
    deliveryAddress: "",
    items: [],
  });
  assert.ok(Math.abs(Date.now() - Date.parse(d.createdAt)) < 10000);
  const audit = await clients.SUPER_ADMIN.ok("activity");
  assert.equal(
    audit.some((e) => e.orderId === d.id),
    false,
  );
  const key = randomUUID();
  const first = await clients.SALES_REP.ok(
    "orders/" + d.id,
    "DELETE",
    { expectedVersion: d.version },
    { key },
  );
  assert.deepEqual(
    await clients.SALES_REP.ok(
      "orders/" + d.id,
      "DELETE",
      { expectedVersion: d.version },
      { key },
    ),
    first,
  );
});
const rep = () => clients.SALES_REP,
  mgr = () => clients.SALES_MANAGER,
  wh = () => clients.WAREHOUSE_MANAGER,
  log = () => clients.LOGISTICS,
  admin = () => clients.SUPER_ADMIN;
async function make(qty = 2, product = products[0], extra = []) {
  const d = await rep().ok("orders", "POST", {
    customerId: customer.id,
    deliveryAddress: "مدينة نصر",
    items: [{ productId: product.id, quantity: String(qty) }, ...extra],
  });
  return rep().ok(`orders/${d.id}/submit`, "POST", {
    expectedVersion: d.version,
  });
}
async function approve(o, partial = false) {
  return mgr().ok(`orders/${o.id}/review`, "POST", {
    expectedVersion: o.version,
    decisions: o.items.map((i, n) => ({
      itemId: i.id,
      status: partial && n ? "REJECTED" : "APPROVED",
      ...(partial && n ? { reason: "غير مناسب" } : {}),
    })),
  });
}
async function assign(o) {
  return log().ok(`orders/${o.id}/assignment`, "POST", {
    expectedVersion: o.version,
    driverId: clients.DRIVER.account.id,
  });
}
test("B01 B03 authentication, opaque HttpOnly session, CSRF and forbidden Origin", async () => {
  const c = new Client({ username: "not-found", password: "wrong-password" });
  await c.bootstrap();
  assert.equal((await c.call("auth/login", "POST", c.account)).status, 401);
  const r = await rep().call("orders", "POST", {}, { skipCsrf: true });
  assert.equal(r.status, 403);
  assert.equal(
    (await rep().call("orders", "POST", {}, { origin: "https://evil.example" }))
      .status,
    403,
  );
  const s = await pool.query("SELECT token_hash FROM sessions LIMIT 1");
  assert.match(s.rows[0].token_hash, /^[0-9a-f]{64}$/);
});
test("B04 B05 scope on drafts, submitted orders, counts and every department", async () => {
  const d = await rep().ok("orders", "POST", {
    customerId: "",
    deliveryAddress: "",
    items: [],
  });
  for (const role of ["REP2", "SUPER_ADMIN", "FINANCE", "DRIVER"])
    assert.equal((await clients[role].call("orders/" + d.id)).status, 404);
  const o = await make();
  assert.equal((await clients.REP2.call("orders/" + o.id)).status, 404);
  assert.equal(
    (
      await clients.REP2.ok(
        "orders?search=" + encodeURIComponent(o.orderNumber),
      )
    ).total,
    0,
  );
  for (const role of [
    "SALES_MANAGER",
    "WAREHOUSE_MANAGER",
    "FINANCE",
    "LOGISTICS",
    "DRIVER",
    "SUPER_ADMIN",
  ])
    assert.equal((await clients[role].ok("orders/" + o.id)).id, o.id);
});
test("B06 B07 B08 B14 atomic decisions, transition and stale version", async () => {
  let o = await make(2, products[0], [
    { productId: products[1].id, quantity: "3" },
  ]);
  assert.equal(
    (
      await wh().call(`orders/${o.id}/warehouse-confirmation`, "POST", {
        expectedVersion: o.version,
      })
    ).error.code,
    "INVALID_TRANSITION",
  );
  const invalid = [
    { itemId: o.items[0].id, status: "APPROVED" },
    { itemId: o.items[0].id, status: "APPROVED" },
  ];
  assert.equal(
    (
      await mgr().call(`orders/${o.id}/review`, "POST", {
        expectedVersion: o.version,
        decisions: invalid,
      })
    ).status,
    400,
  );
  assert.equal((await mgr().ok("orders/" + o.id)).status, "PENDING_APPROVAL");
  o = await approve(o, true);
  assert.equal(o.approvalOutcome, "PARTIAL");
  assert.equal(
    o.items.find((i) => i.approvalStatus === "REJECTED").approvedQuantity,
    0,
  );
  assert.equal(
    (
      await wh().call(`orders/${o.id}/warehouse-confirmation`, "POST", {
        expectedVersion: o.version - 1,
      })
    ).error.code,
    "VERSION_CONFLICT",
  );
  const rejected = await make();
  const result = await mgr().ok(`orders/${rejected.id}/review`, "POST", {
    expectedVersion: rejected.version,
    decisions: rejected.items.map((i) => ({
      itemId: i.id,
      status: "REJECTED",
      reason: "رفض كامل",
    })),
  });
  assert.equal(result.status, "REJECTED");
});
test("B09 B10 last stock contention and rollback of all products", async () => {
  const product = await admin().ok("products", "POST", {
    name: "اختبار تنافس " + randomUUID(),
    sku: randomUUID(),
    unit: "كرتونة",
    active: true,
  });
  await wh().ok("inventory/openings", "POST", {
    productId: product.id,
    quantity: 5,
    expectedVersion: 1,
    reason: "اختبار",
  });
  const a = await approve(await make(5, product)),
    b = await approve(await make(5, product));
  const result = await Promise.all(
    [a, b].map((o) =>
      wh().call(`orders/${o.id}/warehouse-confirmation`, "POST", {
        expectedVersion: o.version,
      }),
    ),
  );
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  const counts = await pool.query(
    "SELECT on_hand,reserved FROM inventory_balances WHERE product_id=$1",
    [product.id],
  );
  assert.deepEqual(counts.rows[0], { on_hand: 5, reserved: 5 });
  const rollback = await approve(
    await make(2, products[0], [{ productId: product.id, quantity: "1" }]),
  );
  const before = await pool.query(
    "SELECT reserved FROM inventory_balances WHERE product_id=$1",
    [products[0].id],
  );
  assert.equal(
    (
      await wh().call(`orders/${rollback.id}/warehouse-confirmation`, "POST", {
        expectedVersion: rollback.version,
      })
    ).status,
    409,
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT reserved FROM inventory_balances WHERE product_id=$1",
        [products[0].id],
      )
    ).rows,
    before.rows,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM reservations WHERE order_id=$1",
        [rollback.id],
      )
    ).rows[0].n,
    0,
  );
});
test("B11 B12 B13 simultaneous idempotency and retry after commit", async () => {
  const o = await approve(await make());
  const key = randomUUID();
  const body = { expectedVersion: o.version };
  const [a, b] = await Promise.all([
    wh().call(`orders/${o.id}/warehouse-confirmation`, "POST", body, { key }),
    wh().call(`orders/${o.id}/warehouse-confirmation`, "POST", body, { key }),
  ]);
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(
    await wh().ok(`orders/${o.id}/warehouse-confirmation`, "POST", body, {
      key,
    }),
    a.data,
  );
  assert.equal(
    (
      await wh().call(
        `orders/${o.id}/warehouse-confirmation`,
        "POST",
        { expectedVersion: 99 },
        { key },
      )
    ).error.code,
    "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM stock_movements WHERE order_id=$1 AND type='RESERVE'",
        [o.id],
      )
    ).rows[0].n,
    1,
  );
});
test("B15 B18 B20 complete stock lifecycle; failure then delivery without extra issue", async () => {
  let o = await approve(await make());
  o = await wh().ok(`orders/${o.id}/warehouse-confirmation`, "POST", {
    expectedVersion: o.version,
  });
  o = await assign(o);
  assert.equal(
    (
      await clients.DRIVER2.call(`orders/${o.id}/dispatch`, "POST", {
        expectedVersion: o.version,
      })
    ).status,
    403,
  );
  o = await clients.DRIVER.ok(`orders/${o.id}/dispatch`, "POST", {
    expectedVersion: o.version,
  });
  o = await clients.DRIVER.ok(`orders/${o.id}/delivery-attempts`, "POST", {
    expectedVersion: o.version,
    reasonCode: "OTHER",
    reason: "المستلم غير موجود",
  });
  assert.equal(o.status, "IN_TRANSIT");
  assert.equal(
    (
      await clients.DRIVER.call(`orders/${o.id}/deliver`, "POST", {
        expectedVersion: o.version,
        recipientName: "",
      })
    ).status,
    400,
  );
  o = await clients.DRIVER.ok(`orders/${o.id}/deliver`, "POST", {
    expectedVersion: o.version,
    recipientName: "المستلم",
  });
  assert.equal(o.status, "DELIVERED");
  assert.equal(o.fulfillmentIssue, null);
  const rows = await pool.query(
    "SELECT type,count(*)::int n FROM stock_movements WHERE order_id=$1 GROUP BY type",
    [o.id],
  );
  assert.equal(rows.rows.find((r) => r.type === "DISPATCH").n, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM delivery_attempts WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
    2,
  );
});
test("B16 B17 cancellation races dispatch without dangling reservations", async () => {
  let o = await approve(await make());
  o = await wh().ok(`orders/${o.id}/warehouse-confirmation`, "POST", {
    expectedVersion: o.version,
  });
  o = await assign(o);
  const r = await Promise.all([
    mgr().call(`orders/${o.id}/cancel`, "POST", {
      expectedVersion: o.version,
      reason: "اختبار إلغاء",
    }),
    log().call(`orders/${o.id}/dispatch`, "POST", {
      expectedVersion: o.version,
    }),
  ]);
  assert.deepEqual(r.map((r) => r.status).sort(), [200, 409]);
  const final = await log().ok("orders/" + o.id);
  assert.ok(["CANCELLED", "IN_TRANSIT"].includes(final.status));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM reservations WHERE order_id=$1 AND state='ACTIVE'",
        [o.id],
      )
    ).rows[0].n,
    0,
  );
});
test("B19 disable assigned driver vs dispatch cannot leave inactive driver in transit", async () => {
  const created = await admin().ok("users", "POST", {
    username: randomUUID(),
    name: "سائق سباق",
    roles: ["DRIVER"],
    active: true,
  });
  let o = await approve(await make());
  o = await wh().ok(`orders/${o.id}/warehouse-confirmation`, "POST", {
    expectedVersion: o.version,
  });
  o = await log().ok(`orders/${o.id}/assignment`, "POST", {
    expectedVersion: o.version,
    driverId: created.id,
  });
  const r = await Promise.all([
    admin().call("users/" + created.id, "PATCH", {
      username: created.username,
      name: created.name,
      roles: ["DRIVER"],
      active: false,
      expectedVersion: created.version,
    }),
    log().call(`orders/${o.id}/dispatch`, "POST", {
      expectedVersion: o.version,
    }),
  ]);
  assert.equal(r[0].error.code, "DRIVER_BUSY");
  assert.equal(r[1].status, 200);
});
test("B21 snapshots preserved, B23 adjustment cannot undercut reservations, B24 ledger reconciles", async () => {
  let o = await make();
  const original = o.items[0].productSnapshot.name;
  const p = (await admin().ok("products")).find(
    (p) => p.id === o.items[0].productId,
  );
  await admin().ok("products/" + p.id, "PATCH", {
    name: original + " جديد",
    sku: p.sku,
    unit: p.unit,
    active: p.active,
    expectedVersion: p.version,
  });
  assert.equal(
    (await mgr().ok("orders/" + o.id)).items[0].productSnapshot.name,
    original,
  );
  const b = (await wh().ok("inventory/balances")).find((b) => b.reserved > 0);
  assert.equal(
    (
      await wh().call("inventory/adjustments", "POST", {
        productId: b.productId,
        expectedVersion: b.version,
        countedOnHand: 0,
        reason: "اختبار",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await wh().call("inventory/openings", "POST", {
        productId: b.productId,
        expectedVersion: b.version,
        quantity: 1,
        reason: "افتتاح مكرر",
      })
    ).error.code,
    "OPENING_EXISTS",
  );
  const diff = await pool.query(
    "SELECT b.product_id FROM inventory_balances b JOIN (SELECT product_id,sum(on_hand_delta) h,sum(reserved_delta) r FROM stock_movements GROUP BY product_id)m USING(product_id) WHERE b.on_hand<>m.h OR b.reserved<>m.r",
  );
  assert.equal(diff.rowCount, 0);
});
test("B25 DTOs omit secrets; role endpoints and unknown fields rejected", async () => {
  for (const path of [
    "users",
    "customers",
    "products",
    "activity",
    "inventory/movements",
    "lookups/customers",
  ])
    assert.equal((await clients.FINANCE.call(path)).status, 403);
  const w = JSON.stringify(await clients.FINANCE.ok("workspace"));
  assert.doesNotMatch(
    w,
    /passwordHash|password_hash|token_hash|temporaryPassword/,
  );
  assert.equal(
    (
      await rep().call("orders", "POST", {
        customerId: "",
        deliveryAddress: "",
        items: [],
        createdBy: clients.SUPER_ADMIN.account.id,
      })
    ).status,
    400,
  );
});
test("B26 date filters and invalid pagination, B27 sessions persistent database", async () => {
  assert.equal((await rep().call("orders?pageSize=101")).status, 400);
  assert.equal((await rep().call("orders?from=2026-02-30")).status, 400);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
  }).format(new Date());
  const a = await rep().ok(
    "orders?from=" + day + "&to=" + day + "&pageSize=100",
  );
  assert.equal(a.total, a.items.length);
  assert.ok(a.total > 0);
  const fresh = new Client(rep().account);
  fresh.cookies = new Map(rep().cookies);
  assert.equal((await fresh.ok("auth/me")).id, rep().account.id);
});
test("B02 password reset, forced password change, logout invalidate sessions", async () => {
  const user = await admin().ok("users", "POST", {
    username: randomUUID(),
    name: "اختبار جلسة",
    roles: ["SALES_REP"],
    active: true,
  });
  const c = new Client({
    username: user.username,
    password: user.temporaryPassword,
  });
  await c.login();
  assert.equal(
    (await c.call("workspace")).error.code,
    "PASSWORD_CHANGE_REQUIRED",
  );
  const next = randomUUID() + "pass";
  await c.ok("auth/change-password", "POST", {
    currentPassword: user.temporaryPassword,
    newPassword: next,
  });
  assert.equal((await c.call("auth/me")).status, 401);
  c.account.password = next;
  await c.login();
  const current = (await admin().ok("users")).find((u) => u.id === user.id);
  await admin().ok("users/" + user.id + "/reset-password", "POST", {
    expectedVersion: current.version,
  });
  assert.equal((await c.call("auth/me")).status, 401);
  await clients.REP2.ok("auth/logout", "POST", {});
  assert.equal((await clients.REP2.call("auth/me")).status, 401);
});
test("B22 competing removal of two administrators preserves last active admin", async () => {
  const second = await admin().ok("users", "POST", {
    username: randomUUID(),
    name: "مدير ثان",
    roles: ["SUPER_ADMIN"],
    active: true,
  });
  const first = (await admin().ok("users")).find(
    (u) => u.id === admin().account.id,
  );
  const payload = (u) => ({
    username: u.username,
    name: u.name,
    roles: ["FINANCE"],
    active: true,
    expectedVersion: u.version,
  });
  const r = await Promise.all([
    admin().call("users/" + second.id, "PATCH", payload(second)),
    admin().call("users/" + first.id, "PATCH", payload(first)),
  ]);
  assert.ok(r.some((x) => x.status === 200));
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active AND r.role='SUPER_ADMIN'",
        )
      ).rows[0].n,
    ),
    1,
  );
});
