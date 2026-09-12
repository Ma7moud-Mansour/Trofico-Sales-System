import "dotenv/config";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const file = ".runtime/runtime-password";
if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"));
const secret = readFileSync(file, "utf8");
const owner = process.env.MIGRATION_DATABASE_URL;
for (const name of ["sales_dev", "sales_test", "sales_restore"]) {
  const url = new URL(owner);
  url.pathname = "/" + name;
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  const exists = await c.query(
    "SELECT 1 FROM pg_roles WHERE rolname='sales_runtime'",
  );
  if (!exists.rowCount)
    await c.query(
      `CREATE ROLE sales_runtime LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
  await c.query("GRANT USAGE ON SCHEMA public TO sales_runtime");
  const tables = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'",
  );
  if (tables.rowCount) {
    await c.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO sales_runtime",
    );
    await c.query(
      "REVOKE UPDATE,DELETE ON activity_events,stock_movements FROM sales_runtime",
    );
    await c.query(
      "REVOKE DELETE ON users,customers,products,warehouses FROM sales_runtime",
    );
    await c.query(
      "REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM sales_runtime",
    );
  }
  await c.end();
}
let env = readFileSync(".env", "utf8");
for (const [key, name] of [
  ["DATABASE_URL", "sales_dev"],
  ["TEST_DATABASE_URL", "sales_test"],
]) {
  const url = new URL(owner);
  url.username = "sales_runtime";
  url.password = secret;
  url.pathname = "/" + name;
  env = env.replace(new RegExp("^" + key + "=.*$", "m"), key + "=" + url.href);
}
if (!env.includes("TEST_MIGRATION_DATABASE_URL=")) {
  const url = new URL(owner);
  url.pathname = "/sales_test";
  env += "TEST_MIGRATION_DATABASE_URL=" + url.href + "\n";
}
writeFileSync(".env", env);
console.log(
  "Runtime role configured with append-only ledger/audit privileges; migration credentials kept separate.",
);
