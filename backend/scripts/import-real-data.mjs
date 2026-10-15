// Explicit maintenance command. Never runs during application startup.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";
import * as argon from "@node-rs/argon2";

const stableId = (key) => {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export function buildImportPlan(source) {
  if (!/^[a-f0-9]{64}$/.test(source.sourceSha256 ?? ""))
    throw Error("Missing source checksum");
  if (!source.customers?.length || !source.products?.length)
    throw Error("Empty source data");
  const names = [
    ...new Set(source.customers.map((c) => c.representative?.trim())),
  ];
  if (names.some((n) => !n)) throw Error("Missing representative name");
  const representatives = names.map((name, i) => ({
    id: stableId(`trofico:rep:${source.sourceSha256}:${name}`),
    name,
    username: `rep.${String(i + 1).padStart(3, "0")}`,
  }));
  const byName = new Map(representatives.map((r) => [r.name, r.id]));
  const customers = source.customers.map((c, i) => {
    if (!c.name?.trim() || !Number.isInteger(c.sourceRow))
      throw Error("Invalid customer source row");
    return {
      id: stableId(`trofico:customer:${source.sourceSha256}:${c.sourceRow}`),
      code: `C-${String(i + 1).padStart(5, "0")}`,
      name: c.name.trim(),
      representativeId: byName.get(c.representative.trim()),
      areaId: null,
    };
  });
  const products = source.products.map((p, i) => {
    if (
      !p.name?.trim() ||
      !Number.isInteger(p.sourceRow) ||
      (p.weight !== null && (!Number.isFinite(p.weight) || p.weight <= 0))
    )
      throw Error("Invalid product source row");
    return {
      id: stableId(`trofico:product:${source.sourceSha256}:${p.sourceRow}`),
      sku: `P-${String(i + 1).padStart(4, "0")}`,
      name: p.name.trim(),
      unit: "عبوة",
      weight: p.weight,
      weightUnit: p.weightUnit?.trim() ?? "",
    };
  });
  for (const records of [customers, products])
    if (new Set(records.map((r) => r.id)).size !== records.length)
      throw Error("Duplicate source rows");
  return {
    sourceSha256: source.sourceSha256,
    representatives,
    customers,
    products,
  };
}

function backupDatabase(url, directory) {
  const u = new URL(url);
  const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
  const file = path.resolve(directory, "before-import.dump");
  const passfile = path.resolve(directory, "backup.pgpass");
  const escape = (s) => s.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  fs.writeFileSync(
    passfile,
    [
      u.hostname,
      u.port || "5432",
      u.pathname.slice(1),
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
    ]
      .map(escape)
      .join(":") + "\n",
    { mode: 0o600 },
  );
  const backupEnv = {
    ...process.env,
    PGPASSFILE: passfile,
    PGCLIENTENCODING: "UTF8",
    ...(!["127.0.0.1", "localhost"].includes(u.hostname)
      ? {
          PGSSLMODE: "verify-full",
          PGSSLROOTCERT: path.resolve("backend/certs/supabase-ca.crt"),
        }
      : {}),
  };
  delete backupEnv.PGPASSWORD;
  const result = spawnSync(
    path.join(bin, "pg_dump.exe"),
    [
      "-w",
      "-h",
      u.hostname,
      "-p",
      u.port || "5432",
      "-U",
      decodeURIComponent(u.username),
      "-d",
      u.pathname.slice(1),
      "-Fc",
      "--no-owner",
      "--no-acl",
      "-f",
      file,
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      env: backupEnv,
    },
  );
  fs.unlinkSync(passfile);
  if (result.status !== 0)
    throw Error("Database backup failed; no data was changed");
  const check = spawnSync(path.join(bin, "pg_restore.exe"), ["--list", file], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (check.status !== 0 || !check.stdout.includes("TABLE DATA"))
    throw Error("Backup verification failed");
  return file;
}

export async function importRealData({
  sourceFile,
  envFile = ".env",
  apply = false,
  outputDirectory = ".runtime/real-data-import",
}) {
  const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const plan = buildImportPlan(source);
  const env = dotenv.parse(fs.readFileSync(envFile));
  const url = new URL(env.MIGRATION_DATABASE_URL || env.DATABASE_URL);
  const connectionUrl = new URL(url);
  connectionUrl.searchParams.delete("sslmode");
  const remote = !["127.0.0.1", "localhost"].includes(url.hostname);
  const client = new pg.Client({
    connectionString: connectionUrl.href,
    connectionTimeoutMillis: 15000,
    ...(remote
      ? {
          ssl: {
            ca: fs.readFileSync("backend/certs/supabase-ca.crt", "utf8"),
            rejectUnauthorized: true,
          },
        }
      : {}),
  });
  const summary = {
    customers: plan.customers.length,
    products: plan.products.length,
    representatives: plan.representatives.length,
  };
  await client.connect();
  let inTransaction = false;
  try {
    const prior = await client.query(
      "SELECT id FROM activity_events WHERE type='REAL_DATA_IMPORT' AND changes::jsonb->>'sourceSha256'=$1",
      [plan.sourceSha256],
    );
    if (prior.rowCount) return { alreadyImported: true, ...summary };
    const preflight = async () => {
      if (
        (
          await client.query(
            "SELECT id FROM orders WHERE created_by NOT IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%') AND (customer_id IS NULL OR customer_id NOT IN (SELECT id FROM customers WHERE code_normalized LIKE 'demo-c-%')) LIMIT 1",
          )
        ).rowCount
      )
        throw Error(
          "Non-demo orders found; refusing to remove business history",
        );
      if (
        (
          await client.query(
            "SELECT id FROM stock_movements WHERE actor_id NOT IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%') AND product_id NOT IN (SELECT id FROM products WHERE sku_normalized LIKE 'demo-p-%') LIMIT 1",
          )
        ).rowCount
      )
        throw Error(
          "Non-demo inventory movements found; refusing to remove business history",
        );
      if (
        (
          await client.query(
            "SELECT id FROM stock_receipts WHERE created_by NOT IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%') AND product_id NOT IN (SELECT id FROM products WHERE sku_normalized LIKE 'demo-p-%') LIMIT 1",
          )
        ).rowCount
      )
        throw Error(
          "Non-demo stock receipts found; refusing to remove business history",
        );
      if (
        (
          await client.query(
            "SELECT id FROM customers WHERE code_normalized NOT LIKE 'demo-c-%' LIMIT 1",
          )
        ).rowCount
      )
        throw Error(
          "Non-demo customers found; review this database before replacement",
        );
      if (
        (
          await client.query(
            "SELECT id FROM users WHERE username_normalized=ANY($1::text[]) LIMIT 1",
            [plan.representatives.map((r) => r.username)],
          )
        ).rowCount
      )
        throw Error(
          "Representative usernames already exist; refusing to replace credentials",
        );
    };
    await preflight();
    if (!apply) return { dryRun: true, ...summary, target: url.hostname };
    const directory = path.resolve(
      outputDirectory,
      `${remote ? "production" : "local"}-${Date.now()}`,
    );
    fs.mkdirSync(directory, { recursive: true });
    const backup = backupDatabase(url.href, directory);
    // Save credentials before committing so successful imports always have a private handoff.
    const accounts = [];
    for (const r of plan.representatives) {
      const password = randomBytes(18).toString("base64url");
      accounts.push({
        ...r,
        password,
        hash: await argon.hash(password, {
          algorithm: argon.Algorithm.Argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
        }),
      });
    }
    const accessFile = path.join(directory, "representative-access.json");
    fs.writeFileSync(
      accessFile,
      JSON.stringify(
        accounts.map((a) => ({
          id: a.id,
          name: a.name,
          username: a.username,
          password: a.password,
        })),
        null,
        2,
      ),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(directory, "source-data.json"),
      JSON.stringify(source, null, 2),
      { mode: 0o600 },
    );
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT pg_advisory_xact_lock(74110911)");
    await client.query(
      "LOCK TABLE users, customers, products, orders, areas, user_areas, stock_movements, stock_receipts IN SHARE ROW EXCLUSIVE MODE",
    );
    await preflight();
    const areasBefore = (await client.query("SELECT * FROM areas ORDER BY id"))
      .rows;
    const admin = (
      await client.query(
        "SELECT u.id,u.name FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active AND r.role='SUPER_ADMIN' ORDER BY u.created_at LIMIT 1",
      )
    ).rows[0];
    if (!admin) throw Error("An active administrator is required");
    // All operational rows were verified to belong exclusively to the disposable demo batch.
    await client.query(
      `DELETE FROM activity_events WHERE order_id IS NOT NULL
        OR actor_id IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%')
        OR (type='USER_CREATED' AND summary LIKE 'إنشاء حساب عرض:%')
        OR (type='MASTER_SAVE' AND
          CASE WHEN changes IS JSON THEN changes::jsonb->>'id' END IN (
            SELECT id::text FROM customers UNION ALL SELECT id::text FROM products
            UNION ALL SELECT u.id::text FROM users u WHERE username_normalized LIKE 'demo.%'
              AND NOT EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('SUPER_ADMIN','SALES_MANAGER'))
          ))`,
    );
    for (const table of [
      "delivery_attempts",
      "order_assignments",
      "reservations",
      "stock_movements",
      "stock_receipts",
      "order_items",
      "orders",
      "inventory_balances",
      "customers",
      "products",
      "idempotency_records",
    ])
      await client.query(`DELETE FROM ${table}`);
    // Retain existing leadership accounts and passwords, removing the old demo login prefix.
    await client.query(`UPDATE users SET username=substring(username FROM 6),username_normalized=substring(username_normalized FROM 6),version=version+1,updated_at=now()
      WHERE username_normalized LIKE 'demo.%' AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=users.id AND r.role IN ('SUPER_ADMIN','SALES_MANAGER'))`);
    await client.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%')",
    );
    await client.query(
      "DELETE FROM user_areas WHERE user_id IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%')",
    );
    await client.query(
      "DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username_normalized LIKE 'demo.%')",
    );
    await client.query(
      "DELETE FROM users WHERE username_normalized LIKE 'demo.%'",
    );
    for (const a of accounts) {
      await client.query(
        "INSERT INTO users(id,name,username,username_normalized,password_hash,must_change_password) VALUES($1,$2,$3,$3,$4,true)",
        [a.id, a.name, a.username, a.hash],
      );
      await client.query(
        "INSERT INTO user_roles(user_id,role) VALUES($1,'SALES_REP')",
        [a.id],
      );
    }
    await client.query(
      `INSERT INTO customers(id,code,code_normalized,name,phone,default_address,representative_id,area_id)
      SELECT x.id,x.code,lower(x.code),x.name,'','',x."representativeId",NULL
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,code text,name text,"representativeId" uuid)`,
      [JSON.stringify(plan.customers)],
    );
    await client.query(
      `INSERT INTO products(id,sku,sku_normalized,name,unit,weight,weight_unit)
      SELECT x.id,x.sku,lower(x.sku),x.name,x.unit,x.weight,x."weightUnit"
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,sku text,name text,unit text,weight double precision,"weightUnit" text)`,
      [JSON.stringify(plan.products)],
    );
    await client.query(
      "INSERT INTO inventory_balances(warehouse_id,product_id) SELECT w.id,p.id FROM warehouses w CROSS JOIN products p",
    );
    if (
      JSON.stringify(
        (await client.query("SELECT * FROM areas ORDER BY id")).rows,
      ) !== JSON.stringify(areasBefore)
    )
      throw Error("Areas changed; rolling back");
    const counts = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM customers) customers,(SELECT count(*)::int FROM products) products,(SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM inventory_balances WHERE on_hand<>0 OR reserved<>0) nonzero_balances",
      )
    ).rows[0];
    if (
      counts.customers !== summary.customers ||
      counts.products !== summary.products ||
      counts.orders ||
      counts.nonzero_balances
    )
      throw Error("Import verification failed");
    await client.query(
      "INSERT INTO activity_events(id,actor_id,actor_name_snapshot,actor_role,type,summary,changes,request_id) VALUES($1,$2,$3,'SUPER_ADMIN','REAL_DATA_IMPORT','استبدال بيانات العرض ببيانات ملف العملاء والأصناف',$4,$5)",
      [
        randomUUID(),
        admin.id,
        admin.name,
        JSON.stringify({ sourceSha256: plan.sourceSha256, ...summary }),
        randomUUID(),
      ],
    );
    await client.query("COMMIT");
    inTransaction = false;
    const result = {
      imported: true,
      ...counts,
      representatives: summary.representatives,
      areasPreserved: areasBefore.length,
      backup,
      accessFile,
    };
    fs.writeFileSync(
      path.join(directory, "result.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  } catch (e) {
    if (inTransaction) await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const value = (key, fallback) => {
    const i = process.argv.indexOf(key);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const sourceFile = value("--source");
  if (!sourceFile)
    throw Error(
      "Usage: node backend/scripts/import-real-data.mjs --source SOURCE.json [--env-file .env] [--apply]",
    );
  importRealData({
    sourceFile,
    envFile: value("--env-file", ".env"),
    apply: process.argv.includes("--apply"),
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
