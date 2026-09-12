import { z } from "zod";
import { type Request, type Response } from "express";
import { db, transaction, one, write, check, ApiError } from "./db.js";
import {
  authenticate,
  login,
  changePassword,
  cookieName,
  cookieOptions,
  digest,
  requireRole,
} from "./auth.js";
import {
  loginSchema,
  changeSchema,
  commandSchemas,
  querySchema,
  version,
} from "./schemas.js";
import { readEndpoint } from "./queries.js";
import { getOrder, camel } from "./repository.js";
import { rows } from "./db.js";
import { draft, orderCommand, authorizeCommand } from "./orders.js";
import { master, resetPassword, stock } from "./masters.js";
function stable(x: unknown): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  return (
    "{" +
    Object.keys(x)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) + ":" + stable((x as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
export async function handle(req: Request, res: Response, requestId: string) {
  const path = req.path.replace(/^\/api\/v1\/?/, "").replace(/\/$/, "");
  const token = req.cookies[cookieName] as string | undefined;
  if (path === "health/live" && req.method === "GET") return { live: true };
  if (path === "auth/login" && req.method === "POST") {
    const p = loginSchema.parse(req.body);
    const result = await login(p.username, p.password, req.ip || "unknown");
    res.cookie(cookieName, result.token, {
      ...cookieOptions,
      maxAge: 12 * 60 * 60 * 1000,
    });
    return result.user;
  }
  if (path === "auth/change-password" && req.method === "POST") {
    const p = changeSchema.parse(req.body);
    const result = await changePassword(
      token || "",
      p.currentPassword,
      p.newPassword,
    );
    res.clearCookie(cookieName, cookieOptions);
    return result;
  }
  if (path === "auth/logout" && req.method === "POST") {
    await transaction(async (tx) => {
      await authenticate(tx, token, true);
      await write(
        tx,
        "UPDATE sessions SET revoked_at=now() WHERE token_hash=$1",
        digest(token!),
      );
    });
    res.clearCookie(cookieName, cookieOptions);
    return { loggedOut: true };
  }
  if (req.method === "GET")
    return db.$transaction(
      async (tx) => {
        const u = await authenticate(tx, token, path === "auth/me");
        if (path === "auth/me") return u;
        if (path === "health/ready") {
          requireRole(u, "SUPER_ADMIN");
          const migration = await one(
            tx,
            `SELECT 1 FROM _prisma_migrations WHERE finished_at IS NOT NULL AND migration_name='202609110001_initial'`,
          );
          check(migration, 503, "NOT_READY", "الخدمة غير جاهزة");
          return { ready: true };
        }
        const detail = path.match(/^orders\/([0-9a-f-]{36})(\/activity)?$/i);
        if (detail) {
          const o = await getOrder(tx, detail[1], u);
          return detail[2]
            ? (
                await rows(
                  tx,
                  "SELECT * FROM activity_events WHERE order_id=$1::uuid ORDER BY occurred_at,id",
                  o.id,
                )
              ).map(camel)
            : o;
        }
        const q: Record<string, unknown> =
          path === "orders" ? querySchema.parse(req.query) : {};
        if (q.from && q.to)
          check(
            String(q.from) <= String(q.to),
            400,
            "VALIDATION_ERROR",
            "الفترة غير صحيحة",
          );
        const result = await readEndpoint(tx, u, path, q);
        check(result !== undefined, 404, "NOT_FOUND", "المسار غير موجود");
        return result;
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
  const key = req.get("Idempotency-Key");
  check(
    key && key.length >= 8 && key.length <= 200,
    400,
    "VALIDATION_ERROR",
    "مفتاح العملية مطلوب",
  );
  const hash = digest(stable({ path, method: req.method, body: req.body }));
  return transaction(async (tx) => {
    const u = await authenticate(tx, token);
    const match = path.match(/^orders\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/i);
    const masterMatch = path.match(
      /^(users|customers|products)(?:\/([0-9a-f-]{36}))?(\/reset-password)?$/i,
    );
    const prior = await one<{ request_hash: string; response_body: unknown }>(
      tx,
      "SELECT request_hash,response_body FROM idempotency_records WHERE actor_id=$1::uuid AND key=$2 AND expires_at>now()",
      u.id,
      key,
    );
    if (
      match &&
      req.method === "DELETE" &&
      prior &&
      prior.request_hash === hash
    ) {
      requireRole(u, "SALES_REP");
      const previous = prior.response_body as { createdBy?: string };
      check(previous.createdBy === u.id, 404, "NOT_FOUND", "الطلب غير موجود");
      return prior.response_body;
    }
    let existingOrder;
    if (match) {
      existingOrder = await getOrder(tx, match[1], u, true);
      const action =
        match[2] || (req.method === "DELETE" ? "delete" : "submit");
      if (action in commandSchemas)
        authorizeCommand(u, existingOrder, action, true);
    }
    if (masterMatch) requireRole(u, "SUPER_ADMIN");
    if (path.startsWith("inventory/"))
      requireRole(u, "SUPER_ADMIN", "WAREHOUSE_MANAGER");
    if (path === "orders") requireRole(u, "SALES_REP");
    if (prior) {
      check(
        prior.request_hash === hash,
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "مفتاح العملية مستخدم لبيانات مختلفة",
      );
      return prior.response_body;
    }
    let result: unknown;
    if (path === "orders" && req.method === "POST")
      result = await draft(tx, u, undefined, req.body, requestId);
    else if (match) {
      if (req.method === "PATCH" && !match[2])
        result = await draft(tx, u, match[1], req.body, requestId);
      else {
        const action = match[2] || (req.method === "DELETE" ? "delete" : "");
        check(
          action in commandSchemas &&
            (req.method === "POST" ||
              (action === "delete" && req.method === "DELETE")),
          404,
          "NOT_FOUND",
          "المسار غير موجود",
        );
        result = await orderCommand(
          tx,
          u,
          match[1],
          action as keyof typeof commandSchemas,
          req.body,
          requestId,
        );
      }
    } else if (masterMatch) {
      if (masterMatch[3] && req.method === "POST") {
        const p = z
          .object({ expectedVersion: version })
          .strict()
          .parse(req.body);
        result = await resetPassword(
          tx,
          u,
          masterMatch[2],
          p.expectedVersion,
          requestId,
        );
      } else {
        check(
          req.method === (masterMatch[2] ? "PATCH" : "POST"),
          404,
          "NOT_FOUND",
          "المسار غير موجود",
        );
        result = await master(
          tx,
          u,
          masterMatch[1] as "users" | "customers" | "products",
          masterMatch[2],
          req.body,
          requestId,
        );
      }
    } else if (
      /^inventory\/(openings|receipts|adjustments)$/.test(path) &&
      req.method === "POST"
    )
      result = await stock(
        tx,
        u,
        path.split("/")[1] as "openings" | "receipts" | "adjustments",
        req.body,
        requestId,
      );
    else throw new ApiError(404, "NOT_FOUND", "المسار غير موجود");
    // Reset/create passwords are returned once; replay gives a receipt without redisclosing the secret.
    const saved =
      result && typeof result === "object" && "temporaryPassword" in result
        ? Object.fromEntries(
            Object.entries(result).filter(([k]) => k !== "temporaryPassword"),
          )
        : result;
    await write(
      tx,
      `INSERT INTO idempotency_records(actor_id,key,command,resource_id,request_hash,response_status,response_body) VALUES($1::uuid,$2,$3,$4::uuid,$5,200,$6::jsonb) ON CONFLICT(actor_id,key) DO UPDATE SET request_hash=excluded.request_hash,response_body=excluded.response_body,created_at=now(),expires_at=now()+interval '7 days'`,
      u.id,
      key,
      req.method + " " + path,
      match?.[1] || null,
      hash,
      JSON.stringify(saved),
    );
    return result;
  });
}
