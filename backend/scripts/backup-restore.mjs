import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
const source =
    process.env.TEST_MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL,
  target = process.env.RESTORE_DATABASE_URL;
if (
  !source ||
  !target ||
  !new URL(source).pathname.endsWith("_test") ||
  !new URL(target).pathname.endsWith("_restore") ||
  source === target
)
  throw Error("Isolated test and restore databases required");
const dest = new pg.Client({ connectionString: target });
await dest.connect();
if (
  Number(
    (
      await dest.query(
        "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].count,
  )
)
  throw Error("Restore database must be empty; nothing was overwritten");
const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
mkdirSync(".runtime/backups", { recursive: true });
const dump = path.resolve(".runtime/backups/test-verification.dump");
function run(exe, url, args) {
  const u = new URL(url);
  const result = spawnSync(
    path.join(bin, exe + ".exe"),
    [
      "-h",
      u.hostname,
      "-p",
      u.port,
      "-U",
      decodeURIComponent(u.username),
      "-d",
      u.pathname.slice(1),
      ...args,
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
    },
  );
  if (result.status !== 0) throw Error(exe + " failed: " + result.stderr);
}
const start = Date.now();
run("pg_dump", source, ["-Fc", "--no-owner", "--no-acl", "-f", dump]);
run("pg_restore", target, ["--no-owner", "--no-acl", dump]);
const src = new pg.Client({ connectionString: source });
await src.connect();
const tables = [
  "users",
  "customers",
  "products",
  "orders",
  "order_items",
  "inventory_balances",
  "reservations",
  "stock_movements",
  "delivery_attempts",
  "activity_events",
];
const counts = {};
for (const table of tables) {
  const a = (await src.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
    b = (await dest.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
  if (a !== b) throw Error("Count mismatch: " + table);
  counts[table] = a;
}
const query = `SELECT b.product_id FROM inventory_balances b LEFT JOIN(SELECT product_id,sum(on_hand_delta) h,sum(reserved_delta) r FROM stock_movements GROUP BY product_id)m USING(product_id) LEFT JOIN(SELECT product_id,sum(quantity) q FROM reservations WHERE state='ACTIVE' GROUP BY product_id)a USING(product_id) WHERE b.on_hand<>coalesce(m.h,0) OR b.reserved<>coalesce(m.r,0) OR b.reserved<>coalesce(a.q,0)`;
if ((await dest.query(query)).rowCount)
  throw Error("Restored ledger does not reconcile");
for (const table of ["orders", "reservations", "stock_movements"]) {
  const a = (
      await src.query(
        `SELECT row_to_json(t) r FROM (SELECT * FROM ${table} ORDER BY id LIMIT 5)t`,
      )
    ).rows,
    b = (
      await dest.query(
        `SELECT row_to_json(t) r FROM (SELECT * FROM ${table} ORDER BY id LIMIT 5)t`,
      )
    ).rows;
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error("Sample mismatch: " + table);
}
console.log(
  JSON.stringify(
    {
      verified: true,
      counts,
      elapsedMs: Date.now() - start,
      ledgerDifferences: 0,
    },
    null,
    2,
  ),
);
await src.end();
await dest.end();
