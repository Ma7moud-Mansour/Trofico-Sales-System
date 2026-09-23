import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { type Tx, type Row, rows, one, write, check, MAIN } from "./db.js";
import { type Actor } from "./auth.js";
import { hasPermission } from "./permissions.js";
export const iso = (x: unknown) =>
  x instanceof Date ? x.toISOString() : x == null ? undefined : String(x);
export function camel(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}
export function scope(u: Actor, offset = 1) {
  if (u.active && u.roles.includes("SUPER_ADMIN"))
    return { sql: "true", args: [] as unknown[] };
  const canView = hasPermission(u, "ORDERS_VIEW");
  const creates = hasPermission(u, "ORDERS_CREATE");
  const owns = creates || u.roles.includes("SALES_REP");
  const delivery = hasPermission(u, "DELIVERY_CONFIRM");
  const operational = hasPermission(
    u,
    "FINANCE_RECOMMEND",
    "MANAGER_DECIDE",
    "WAREHOUSE_PREPARE",
    "LOGISTICS_VIEW",
  );
  const broad = canView && operational;
  return {
    sql: `($${offset + 1}::boolean AND (
      (o.status='DRAFT' AND o.created_by=$${offset}::uuid AND $${offset + 2}::boolean)
      OR (o.status<>'DRAFT' AND (
        $${offset + 3}::boolean
        OR (o.created_by=$${offset}::uuid AND $${offset + 2}::boolean)
        OR ($${offset + 4}::boolean AND EXISTS(
          SELECT 1 FROM order_assignments sa WHERE sa.order_id=o.id AND sa.driver_id=$${offset}::uuid
        ))
      ))
    ))`,
    args: [u.id, canView, owns, broad, delivery],
  };
}
export async function getOrder(tx: Tx, id: string, u: Actor, lock = false) {
  const s = scope(u, 2);
  const row = await one<Row>(
    tx,
    `SELECT o.* FROM orders o WHERE o.id=$1::uuid AND ${s.sql}${lock ? " FOR UPDATE" : ""}`,
    id,
    ...s.args,
  );
  check(row, 404, "NOT_FOUND", "الطلب غير موجود");
  return orderDto(tx, row);
}
export async function orderDto(tx: Tx, row: Row) {
  const o = camel(row);
  o.orderNumber = o.orderNumber || "مسودة";
  o.customerId = o.customerId || "";
  o.requestedDeliveryDate = iso(row.requested_delivery_date)?.slice(0, 10);
  o.items = (
    await rows(
      tx,
      "SELECT * FROM order_items WHERE order_id=$1::uuid ORDER BY id",
      row.id,
    )
  ).map((i) => {
    const r = camel(i);
    delete r.orderId;
    return r;
  });
  const a = await one(
    tx,
    "SELECT * FROM order_assignments WHERE order_id=$1::uuid",
    row.id,
  );
  if (a) {
    o.assignment = camel(a);
    (o.assignment as Row).scheduledDate = iso(a.scheduled_date)?.slice(0, 10);
  } else delete o.assignment;
  return o;
}
export async function event(
  tx: Tx,
  u: Actor,
  type: string,
  summary: string,
  requestId: string,
  orderId?: string,
  changes?: string,
) {
  await write(
    tx,
    `INSERT INTO activity_events(id,order_id,actor_id,actor_name_snapshot,actor_role,type,summary,changes,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::uuid)`,
    randomUUID(),
    orderId || null,
    u.id,
    u.name,
    u.roles[0],
    type,
    summary,
    changes || null,
    requestId,
  );
}
export function expected(actual: unknown, value: unknown) {
  check(
    actual === value,
    409,
    "VERSION_CONFLICT",
    "تم تعديل البيانات بواسطة مستخدم آخر. حدّث البيانات ثم حاول مجددًا",
    { currentVersion: actual },
  );
}
export async function balance(tx: Tx, productId: string) {
  await write(
    tx,
    `INSERT INTO inventory_balances(warehouse_id,product_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`,
    MAIN,
    productId,
  );
  return (await one(
    tx,
    "SELECT * FROM inventory_balances WHERE warehouse_id=$1::uuid AND product_id=$2::uuid FOR UPDATE",
    MAIN,
    productId,
  ))!;
}
export async function movement(
  tx: Tx,
  u: Actor,
  b: Row,
  type: string,
  hand: number,
  reserved: number,
  reason: string,
  operation: string,
  orderId?: string,
) {
  const after = {
    onHand: Number(b.on_hand) + hand,
    reserved: Number(b.reserved) + reserved,
  };
  check(
    after.onHand >= after.reserved && after.reserved >= 0,
    409,
    "INSUFFICIENT_STOCK",
    "الرصيد لا يكفي أو أقل من المحجوز",
  );
  await write(
    tx,
    "UPDATE inventory_balances SET on_hand=$3,reserved=$4,version=version+1 WHERE warehouse_id=$1::uuid AND product_id=$2::uuid",
    MAIN,
    b.product_id,
    after.onHand,
    after.reserved,
  );
  await write(
    tx,
    `INSERT INTO stock_movements(id,warehouse_id,product_id,order_id,type,on_hand_delta,reserved_delta,reason,actor_id,operation_id,before_balance,after_balance) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::jsonb,$12::jsonb)`,
    randomUUID(),
    MAIN,
    b.product_id,
    orderId || null,
    type,
    hand,
    reserved,
    reason,
    u.id,
    operation,
    JSON.stringify({ onHand: b.on_hand, reserved: b.reserved }),
    JSON.stringify(after),
  );
}
export async function listOrders(
  tx: Tx,
  u: Actor,
  f: Record<string, unknown> = {},
) {
  const s = scope(u);
  const args: unknown[] = [...s.args];
  const clauses = [s.sql];
  const add = (expr: string, v: unknown) => {
    args.push(v);
    clauses.push(expr.replace("?", `$${args.length}`));
  };
  for (const [key, col] of [
    ["status", "status"],
    ["outcome", "approval_outcome"],
    ["rep", "created_by"],
    ["customer", "customer_id"],
  ] as const)
    if (f[key])
      add(
        `o.${col}=?${["rep", "customer"].includes(key) ? "::uuid" : ""}`,
        f[key],
      );
  if (f.search)
    add(
      `(coalesce(o.order_number,'')||' '||coalesce(o.customer_snapshot->>'name','')||' '||coalesce(o.customer_snapshot->>'code','')||' '||o.creator_name_snapshot) ILIKE ?`,
      `%${String(f.search).replace(/[\\%_]/g, "\\$&")}%`,
    );
  if (f.from)
    add(
      "o.submitted_at>=?::timestamptz",
      DateTime.fromISO(String(f.from), { zone: "Africa/Cairo" })
        .startOf("day")
        .toUTC()
        .toISO(),
    );
  if (f.to)
    add(
      "o.submitted_at<?::timestamptz",
      DateTime.fromISO(String(f.to), { zone: "Africa/Cairo" })
        .plus({ days: 1 })
        .startOf("day")
        .toUTC()
        .toISO(),
    );
  if (f.scope === "/finance") clauses.push("o.status='PENDING_FINANCE'");
  if (f.scope === "/approvals") clauses.push("o.status='PENDING_MANAGER'");
  if (f.scope === "/warehouse")
    clauses.push("o.status IN ('MANAGER_APPROVED','WAREHOUSE_CONFIRMED')");
  if (f.scope === "/logistics")
    clauses.push(
      "o.status IN ('WAREHOUSE_CONFIRMED','IN_TRANSIT','DELIVERED')",
    );
  if (f.scope === "/my-deliveries")
    add(
      "EXISTS(SELECT 1 FROM order_assignments a WHERE a.order_id=o.id AND a.driver_id=?::uuid)",
      u.id,
    );
  if (f.tab === "drafts") clauses.push("o.status='DRAFT'");
  if (f.tab === "submitted") clauses.push("o.status<>'DRAFT'");
  if (f.tab === "mine") {
    const c: string[] = [];
    if (hasPermission(u, "FINANCE_RECOMMEND"))
      c.push("o.status='PENDING_FINANCE'");
    if (hasPermission(u, "MANAGER_DECIDE"))
      c.push("o.status='PENDING_MANAGER'");
    if (hasPermission(u, "WAREHOUSE_PREPARE"))
      c.push("o.status IN ('MANAGER_APPROVED','WAREHOUSE_CONFIRMED')");
    if (hasPermission(u, "DELIVERY_CONFIRM")) {
      args.push(u.id);
      c.push(
        `o.status IN ('WAREHOUSE_CONFIRMED','IN_TRANSIT') AND EXISTS(SELECT 1 FROM order_assignments a WHERE a.order_id=o.id AND a.driver_id=$${args.length}::uuid)`,
      );
    }
    clauses.push(
      c.length ? `(${c.map((x) => `(${x})`).join(" OR ")})` : "false",
    );
  }
  if (f.issue === "DELIVERY")
    clauses.push("o.fulfillment_issue->>'type'='DELIVERY'");
  if (f.issue === "unassigned")
    clauses.push(
      "NOT EXISTS(SELECT 1 FROM order_assignments a WHERE a.order_id=o.id)",
    );
  if (f.issue === "STOCK")
    clauses.push(
      "(o.fulfillment_issue->>'type'='STOCK' OR (o.status='MANAGER_APPROVED' AND EXISTS(SELECT 1 FROM order_items i LEFT JOIN inventory_balances b ON b.product_id=i.product_id WHERE i.order_id=o.id AND i.approval_status='APPROVED' AND i.approved_quantity>coalesce(b.on_hand-b.reserved,0))))",
    );
  if (f.issue === "today")
    clauses.push(
      "(o.delivered_at AT TIME ZONE 'Africa/Cairo')::date=(now() AT TIME ZONE 'Africa/Cairo')::date",
    );
  const where = clauses.join(" AND ");
  const count = await one<{ total: bigint }>(
    tx,
    `SELECT count(*) AS total FROM orders o WHERE ${where}`,
    ...args,
  );
  const page = Number(f.page || 1),
    pageSize = Number(f.pageSize || 10);
  args.push(pageSize, (page - 1) * pageSize);
  const sort =
    f.sort === "number"
      ? "o.order_number ASC"
      : f.sort === "oldest" || (!f.sort && f.tab === "mine")
        ? "o.updated_at ASC"
        : "o.updated_at DESC";
  const result = await rows(
    tx,
    `SELECT o.* FROM orders o WHERE ${where} ORDER BY ${sort},o.id LIMIT $${args.length - 1} OFFSET $${args.length}`,
    ...args,
  );
  return {
    items: await Promise.all(result.map((r) => orderDto(tx, r))),
    total: Number(count!.total),
    page,
    pageSize,
  };
}
