import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { fileURLToPath } from "node:url";
export const config = z
  .object({
    DATABASE_URL: z.string().startsWith("postgres"),
    PORT: z.coerce.number().default(4000),
    ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
    CSRF_SECRET: z.string().min(32),
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    TRUST_PROXY: z.enum(["loopback", "none"]).default("none"),
  })
  .parse(process.env);
if (
  process.env.NODE_ENV === "production" &&
  (config.COOKIE_SECURE !== "true" ||
    config.ALLOWED_ORIGINS.split(",").some((x) => !x.startsWith("https://")))
)
  throw Error("Production requires HTTPS origins and secure cookies");
const connectionUrl = new URL(config.DATABASE_URL);
if (connectionUrl.hostname.endsWith(".pooler.supabase.com")) {
  connectionUrl.searchParams.set("sslmode", "verify-full");
  connectionUrl.searchParams.set(
    "sslrootcert",
    fileURLToPath(new URL("../certs/supabase-ca.crt", import.meta.url)),
  );
}
export const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: connectionUrl.href,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options: "-c statement_timeout=15000 -c timezone=UTC",
  }),
});
export type Tx = Prisma.TransactionClient;
export type Row = Record<string, unknown>;
export async function rows<T = Row>(
  tx: Tx,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql, ...args);
}
export async function one<T = Row>(
  tx: Tx,
  sql: string,
  ...args: unknown[]
): Promise<T | undefined> {
  return (await rows<T>(tx, sql, ...args))[0];
}
export async function write(tx: Tx, sql: string, ...args: unknown[]) {
  return tx.$executeRawUnsafe(sql, ...args);
}
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      return await db.$transaction(
        async (tx) => {
          await rows(tx, "SELECT pg_advisory_xact_lock(74110911)::text");
          return fn(tx);
        },
        { maxWait: 15000, timeout: 20000 },
      );
    } catch (e) {
      const x = e as { code?: string; meta?: { code?: string } };
      if (
        attempt >= 2 ||
        !(x.code === "P2034" || ["40001", "40P01"].includes(x.meta?.code || ""))
      )
        throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
    }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function check(
  value: unknown,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): asserts value {
  if (!value) throw new ApiError(status, code, message, details);
}
export const MAIN = "00000000-0000-4000-8000-000000000001";
