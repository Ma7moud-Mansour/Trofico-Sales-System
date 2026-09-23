import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { db, transaction, one, write, check, ApiError } from "./db.js";
import { hashPassword, getActor } from "./auth.js";
import { roles } from "./schemas.js";
import { balance, movement } from "./repository.js";
import { reconcile } from "./masters.js";
async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY)
    return readFileSync(0, "utf8").replace(/\r?\n$/, "");
  process.stdout.write("Administrator password (hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return new Promise((resolve, reject) => {
    const listener = (chunk: Buffer) => {
      for (const c of chunk.toString()) {
        if (c === "\u0003") {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (c === "\r" || c === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", listener);
      process.stdout.write("\n");
    };
    process.stdin.on("data", listener);
  });
}
async function run() {
  const action = process.argv[2];
  if (action === "bootstrap") {
    const username = process.env.BOOTSTRAP_USERNAME || "admin";
    const secret = await readSecret();
    check(
      secret.length >= 12 && secret.length <= 128,
      400,
      "VALIDATION_ERROR",
      "Password must be 12–128 characters supplied on stdin",
    );
    const hash = await hashPassword(secret);
    await transaction(async (tx) => {
      const exists = await one(
        tx,
        `SELECT 1 FROM user_roles WHERE role='SUPER_ADMIN' LIMIT 1`,
      );
      check(
        !exists,
        409,
        "ALREADY_BOOTSTRAPPED",
        "Admin already exists; bootstrap refused",
      );
      const id = randomUUID();
      await write(
        tx,
        "INSERT INTO users(id,username,username_normalized,name,password_hash,must_change_password) VALUES($1::uuid,$2,$3,$4,$5,false)",
        id,
        username,
        username.toLowerCase(),
        "مدير النظام",
        hash,
      );
      await write(
        tx,
        "INSERT INTO user_roles VALUES($1::uuid,'SUPER_ADMIN')",
        id,
      );
    });
    console.log("Administrator created. No seed data loaded.");
  } else if (action === "seed-test") {
    const name = new URL(process.env.DATABASE_URL!).pathname;
    check(
      process.env.NODE_ENV !== "production" && name.endsWith("_test"),
      400,
      "TEST_DB_REQUIRED",
      "Test seed requires a database name ending _test",
    );
    const accounts: {
      id: string;
      username: string;
      password: string;
      role: string;
    }[] = [];
    const password = randomBytes(18).toString("base64url");
    const hash = await hashPassword(password);
    await transaction(async (tx) => {
      const existing = await one<{ n: bigint }>(
        tx,
        "SELECT count(*) n FROM users",
      );
      check(
        Number(existing!.n) === 0,
        409,
        "NOT_EMPTY",
        "Seed requires an empty test database",
      );
      for (const role of roles) {
        const id = randomUUID(),
          username = role.toLowerCase();
        await write(
          tx,
          "INSERT INTO users(id,username,username_normalized,name,password_hash,must_change_password) VALUES($1::uuid,$2,$2,$3,$4,false)",
          id,
          username,
          role,
          hash,
        );
        await write(tx, "INSERT INTO user_roles VALUES($1::uuid,$2)", id, role);
        if (role === "SALES_REP")
          await write(
            tx,
            "INSERT INTO user_areas(user_id,area_id) VALUES($1::uuid,'10000000-0000-4000-8000-000000000006'::uuid)",
            id,
          );
        accounts.push({ id, username, password, role });
      }
      const second = randomUUID();
      await write(
        tx,
        "INSERT INTO users(id,username,username_normalized,name,password_hash,must_change_password) VALUES($1::uuid,'rep2','rep2','مندوب آخر',$2,false)",
        second,
        hash,
      );
      await write(
        tx,
        "INSERT INTO user_roles VALUES($1::uuid,'SALES_REP')",
        second,
      );
      await write(
        tx,
        "INSERT INTO user_areas(user_id,area_id) VALUES($1::uuid,'10000000-0000-4000-8000-000000000006'::uuid)",
        second,
      );
      accounts.push({ id: second, username: "rep2", password, role: "REP2" });
      const secondDriver = randomUUID();
      await write(
        tx,
        "INSERT INTO users(id,username,username_normalized,name,password_hash,must_change_password) VALUES($1::uuid,'driver2','driver2','سائق آخر',$2,false)",
        secondDriver,
        hash,
      );
      await write(
        tx,
        "INSERT INTO user_roles VALUES($1::uuid,'DRIVER')",
        secondDriver,
      );
      accounts.push({
        id: secondDriver,
        username: "driver2",
        password,
        role: "DRIVER2",
      });
      await write(
        tx,
        "INSERT INTO customers(id,code,code_normalized,name,phone,default_address,area_id,active,version) VALUES($1::uuid,'C-001','c-001','شركة النور','01000000000','مدينة نصر — القاهرة','10000000-0000-4000-8000-000000000006'::uuid,true,1)",
        randomUUID(),
      );
      const admin = await getActor(
        tx,
        accounts.find((a) => a.role === "SUPER_ADMIN")!.id,
      );
      for (const [sku, name] of [
        ["MAN-01", "عصير مانجو"],
        ["ORG-01", "عصير برتقال"],
        ["APP-01", "عصير تفاح"],
      ]) {
        const id = randomUUID();
        await write(
          tx,
          "INSERT INTO products VALUES($1::uuid,$2,$3,$4,$5,true,1)",
          id,
          sku,
          sku.toLowerCase(),
          name,
          "عبوة",
        );
        const b = await balance(tx, id);
        await movement(
          tx,
          admin!,
          b,
          "OPENING",
          100,
          0,
          "رصيد افتتاحي للاختبارات فقط",
          randomUUID(),
        );
      }
    });
    mkdirSync(".runtime", { recursive: true });
    writeFileSync(
      ".runtime/test-accounts.json",
      JSON.stringify(accounts, null, 2),
    );
    console.log(
      "Isolated test seed complete; credentials saved to ignored .runtime/test-accounts.json.",
    );
  } else if (action === "reconcile") {
    const differences = await reconcile(db);
    console.log(JSON.stringify({ differences }, null, 2));
    if (differences.length) process.exitCode = 1;
  } else if (action === "cleanup") {
    await transaction(async (tx) => {
      await write(
        tx,
        "DELETE FROM sessions WHERE absolute_expires_at<now()-interval '7 days' OR revoked_at<now()-interval '7 days'",
      );
      await write(tx, "DELETE FROM idempotency_records WHERE expires_at<now()");
      await write(
        tx,
        "DELETE FROM login_limits WHERE started_at<now()-interval '1 day'",
      );
    });
    console.log(
      "Expired operational records cleaned; business history retained.",
    );
  } else throw Error("Usage: cli bootstrap | seed-test | reconcile | cleanup");
}
run()
  .catch((e) => {
    console.error(
      e instanceof ApiError
        ? e.message
        : "Operation failed; check configuration and database access.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
