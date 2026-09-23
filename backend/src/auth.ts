import { randomBytes, randomUUID, createHash } from "node:crypto";
import * as argon from "@node-rs/argon2";
import {
  type Tx,
  type Row,
  one,
  write,
  transaction,
  check,
  config,
} from "./db.js";
import { permissionValues } from "./permissions.js";
export type Actor = {
  id: string;
  name: string;
  username: string;
  active: boolean;
  roles: string[];
  permissions: string[];
  areaIds: string[];
  version: number;
  mustChangePassword: boolean;
};
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const hashPassword = (s: string) =>
  argon.hash(s, {
    algorithm: argon.Algorithm.Argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export const cookieName =
  config.COOKIE_SECURE === "true" ? "__Host-session" : "sales-session";
export const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE === "true",
  sameSite: "lax" as const,
  path: "/",
};
export async function getActor(tx: Tx, id: string) {
  const actor = await one<Actor>(
    tx,
    `SELECT u.id,u.name,u.username,u.active,u.version,u.must_change_password AS "mustChangePassword",
      coalesce((SELECT array_agg(r.role ORDER BY r.role) FROM user_roles r WHERE r.user_id=u.id),'{}') AS roles,
      coalesce((
        SELECT array_agg(DISTINCT permission ORDER BY permission)
        FROM user_roles r
        JOIN role_permission_sets s ON s.role=r.role
        CROSS JOIN LATERAL unnest(s.permissions) permission
        WHERE r.user_id=u.id
      ),'{}') AS permissions,
      coalesce((SELECT array_agg(a.area_id::text ORDER BY a.area_id) FROM user_areas a WHERE a.user_id=u.id),'{}') AS "areaIds"
     FROM users u WHERE u.id=$1::uuid`,
    id,
  );
  if (actor?.roles.includes("SUPER_ADMIN"))
    actor.permissions = [...permissionValues];
  return actor;
}
export function requireRole(u: Actor, ...roles: string[]) {
  check(
    u.active &&
      (u.roles.includes("SUPER_ADMIN") ||
        roles.some((r) => u.roles.includes(r))),
    403,
    "FORBIDDEN",
    "ليس لديك صلاحية لهذا الإجراء",
  );
}
export async function authenticate(
  tx: Tx,
  token: string | undefined,
  limited = false,
) {
  check(token, 401, "UNAUTHENTICATED", "يرجى تسجيل الدخول");
  const s = await one<Row>(
    tx,
    `SELECT * FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()`,
    digest(token),
  );
  check(s, 401, "UNAUTHENTICATED", "انتهت الجلسة، سجّل الدخول مجددًا");
  const u = await getActor(tx, String(s.user_id));
  check(u?.active, 401, "UNAUTHENTICATED", "يرجى تسجيل الدخول");
  check(
    limited || !u.mustChangePassword,
    403,
    "PASSWORD_CHANGE_REQUIRED",
    "يجب تغيير كلمة المرور أولًا",
  );
  if (Date.now() - new Date(String(s.last_seen_at)).getTime() > 60000)
    await write(
      tx,
      `UPDATE sessions SET last_seen_at=now(),idle_expires_at=LEAST(absolute_expires_at,now()+($2*interval '1 minute')) WHERE id=$1::uuid`,
      s.id,
      config.SESSION_IDLE_MINUTES,
    );
  return u;
}
export async function login(username: string, password: string, ip: string) {
  const normalized = username.trim().toLowerCase();
  const permitted = await transaction(async (tx) => {
    let ok = true;
    for (const [key, max] of [
      [`ip:${digest(ip)}`, 30],
      [`user:${digest(normalized)}`, 5],
    ] as const) {
      const x = await one<{ attempts: number }>(
        tx,
        `INSERT INTO login_limits VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET started_at=CASE WHEN login_limits.started_at<now()-interval '1 minute' THEN now() ELSE login_limits.started_at END,attempts=CASE WHEN login_limits.started_at<now()-interval '1 minute' THEN 1 ELSE login_limits.attempts+1 END RETURNING attempts`,
        key,
      );
      if (x!.attempts > max) ok = false;
    }
    return ok;
  });
  check(
    permitted,
    429,
    "RATE_LIMITED",
    "محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا",
  );
  // Expensive hashing outside business locks; recheck hash and active state under lock.
  const candidate = await import("./db.js").then(({ db }) =>
    one<Row>(
      db,
      "SELECT id,password_hash FROM users WHERE username_normalized=$1",
      normalized,
    ),
  );
  const dummy =
    "$argon2id$v=19$m=65536,t=3,p=1$YWJjZGVmZ2hpamtsbW5vcA$W4Jp4wUk5UNZW+wQonqhPnSnWtRwIGkwMYiBvlOrsCc";
  const valid = await argon
    .verify(String(candidate?.password_hash || dummy), password)
    .catch(() => false);
  check(
    valid && candidate,
    401,
    "UNAUTHENTICATED",
    "اسم المستخدم أو كلمة المرور غير صحيحة",
  );
  return transaction(async (tx) => {
    const current = await one<Row>(
      tx,
      "SELECT password_hash FROM users WHERE id=$1::uuid",
      candidate.id,
    );
    const user = await getActor(tx, String(candidate.id));
    check(
      user?.active && current?.password_hash === candidate.password_hash,
      401,
      "UNAUTHENTICATED",
      "اسم المستخدم أو كلمة المرور غير صحيحة",
    );
    const token = randomBytes(32).toString("base64url");
    await write(
      tx,
      `INSERT INTO sessions(id,token_hash,user_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$2,$3::uuid,now()+($4*interval '1 minute'),now()+($5*interval '1 hour'))`,
      randomUUID(),
      digest(token),
      user.id,
      config.SESSION_IDLE_MINUTES,
      config.SESSION_ABSOLUTE_HOURS,
    );
    return { user, token };
  });
}
export async function revoke(tx: Tx, userId: string) {
  await write(
    tx,
    "UPDATE sessions SET revoked_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL",
    userId,
  );
}
export async function changePassword(
  token: string,
  current: string,
  next: string,
) {
  const newHash = await hashPassword(next);
  return transaction(async (tx) => {
    const u = await authenticate(tx, token, true);
    const row = await one<Row>(
      tx,
      "SELECT password_hash FROM users WHERE id=$1::uuid",
      u.id,
    );
    check(
      await argon.verify(String(row!.password_hash), current),
      400,
      "VALIDATION_ERROR",
      "كلمة المرور الحالية غير صحيحة",
    );
    check(current !== next, 400, "VALIDATION_ERROR", "اختر كلمة مرور جديدة");
    await write(
      tx,
      "UPDATE users SET password_hash=$2,must_change_password=false,version=version+1,updated_at=now() WHERE id=$1::uuid",
      u.id,
      newHash,
    );
    await revoke(tx, u.id);
    return { changed: true };
  });
}
