import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(".runtime");
mkdirSync(root, { recursive: true });
const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const run = (exe, args) => {
  const p = spawnSync(path.join(bin, exe + ".exe"), args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: exe === "pg_ctl" ? "ignore" : "pipe",
  });
  if (p.status !== 0) throw Error(`${exe} failed: ${p.stderr}`);
  return p.stdout;
};
const pwPath = path.join(root, "pg-password");
if (!existsSync(pwPath)) writeFileSync(pwPath, randomBytes(32).toString("hex"));
const pw = readFileSync(pwPath, "utf8");
const data = path.join(root, "postgres");
if (!existsSync(path.join(data, "PG_VERSION")))
  run("initdb", [
    "-D",
    data,
    "-U",
    "sales_owner",
    "--pwfile=" + pwPath,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ]);
const status = spawnSync(path.join(bin, "pg_ctl.exe"), ["-D", data, "status"], {
  windowsHide: true,
});
if (status.status !== 0)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, "postgres.log"),
    "-o",
    "-p 55439 -h 127.0.0.1",
    "-w",
    "start",
  ]);
process.env.PGPASSWORD = pw;
for (const name of ["sales_dev", "sales_test", "sales_restore"]) {
  const found = run("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    "55439",
    "-U",
    "sales_owner",
    "-d",
    "postgres",
    "-Atc",
    `SELECT 1 FROM pg_database WHERE datname='${name}'`,
  ]);
  if (!found.trim())
    run("createdb", [
      "-h",
      "127.0.0.1",
      "-p",
      "55439",
      "-U",
      "sales_owner",
      name,
    ]);
}
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    `DATABASE_URL=postgresql://sales_owner:${pw}@127.0.0.1:55439/sales_dev\nMIGRATION_DATABASE_URL=postgresql://sales_owner:${pw}@127.0.0.1:55439/sales_dev\nTEST_DATABASE_URL=postgresql://sales_owner:${pw}@127.0.0.1:55439/sales_test\nRESTORE_DATABASE_URL=postgresql://sales_owner:${pw}@127.0.0.1:55439/sales_restore\nCSRF_SECRET=${randomBytes(32).toString("hex")}\nPORT=4000\nALLOWED_ORIGINS=http://localhost:3000,http://localhost:3015\nNEXT_PUBLIC_DATA_MODE=api\n`,
  );
console.log(
  "Isolated PostgreSQL ready on 127.0.0.1:55439; development/test/restore databases created. Secrets stored in ignored files.",
);
