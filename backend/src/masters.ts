import { randomUUID, randomBytes } from "node:crypto";
import { type Tx, rows, one, write, check, MAIN } from "./db.js";
import {
  type Actor,
  requireRole,
  hashPassword,
  getActor,
  revoke,
} from "./auth.js";
import { event, expected, balance, movement, camel } from "./repository.js";
import {
  customerSchema,
  productSchema,
  userSchema,
  areaSchema,
  stockSchema,
  stockReceiptReviewSchema,
} from "./schemas.js";
import { customerDto, productDto } from "./orders.js";
export async function master(
  tx: Tx,
  u: Actor,
  kind: "users" | "customers" | "products" | "areas",
  id: string | undefined,
  input: unknown,
  requestId: string,
) {
  requireRole(
    u,
    ...(kind === "users" || kind === "areas" ? ["SUPER_ADMIN"] : ["FINANCE"]),
  );
  const p = (
    kind === "users"
      ? userSchema
      : kind === "customers"
        ? customerSchema
        : kind === "products"
          ? productSchema
          : areaSchema
  ).parse(input) as Record<string, unknown>;
  if (kind === "users") {
    const roles = p.roles as string[];
    if (!roles.includes("SALES_REP")) p.areaIds = [];
    const areaIds = p.areaIds as string[];
    if (areaIds.length) {
      const valid = await one<{ n: bigint }>(
        tx,
        "SELECT count(*) AS n FROM areas WHERE active AND id=ANY($1::uuid[])",
        areaIds,
      );
      check(
        Number(valid!.n) === areaIds.length,
        400,
        "VALIDATION_ERROR",
        "اختر مناطق نشطة وصحيحة للمندوب",
      );
    }
  }
  if (id) {
    const old = await one(
      tx,
      `SELECT * FROM ${kind} WHERE id=$1::uuid FOR UPDATE`,
      id,
    );
    check(old, 404, "NOT_FOUND", "السجل غير موجود");
    expected(old.version, p.expectedVersion);
    if (kind === "users") {
      const roles = p.roles as string[];
      check(
        id !== u.id || p.active,
        400,
        "VALIDATION_ERROR",
        "لا يمكنك تعطيل حسابك الحالي",
      );
      const before = await getActor(tx, id);
      if (
        before!.roles.includes("SUPER_ADMIN") &&
        (!p.active || !roles.includes("SUPER_ADMIN"))
      ) {
        const count = await one<{ n: bigint }>(
          tx,
          `SELECT count(*) AS n FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active AND r.role='SUPER_ADMIN'`,
        );
        check(
          Number(count!.n) > 1,
          409,
          "LAST_ADMIN",
          "لا يمكن إزالة آخر مدير نظام نشط",
        );
      }
      if (!p.active || !roles.includes("DRIVER")) {
        const busy = await one(
          tx,
          `SELECT o.id FROM orders o JOIN order_assignments a ON a.order_id=o.id WHERE a.driver_id=$1::uuid AND o.status IN ('WAREHOUSE_CONFIRMED','IN_TRANSIT') LIMIT 1`,
          id,
        );
        check(
          !busy,
          409,
          "DRIVER_BUSY",
          "أعد تعيين طلبات السائق الجاهزة وأكمل الرحلات قبل تعطيله أو إزالة دوره",
        );
      }
    } else if (kind === "areas" && !p.active) {
      const used = await one<{ used: boolean }>(
        tx,
        `SELECT EXISTS(SELECT 1 FROM customers WHERE active AND area_id=$1::uuid)
          OR EXISTS(
            SELECT 1 FROM user_areas ua JOIN users u ON u.id=ua.user_id
            JOIN user_roles r ON r.user_id=u.id AND r.role='SALES_REP'
            WHERE u.active AND ua.area_id=$1::uuid
          ) AS used`,
        id,
      );
      check(
        !used!.used,
        409,
        "AREA_IN_USE",
        "انقل العملاء والمندوبين من المنطقة قبل تعطيلها",
      );
    }
  } else
    check(
      p.expectedVersion === undefined,
      400,
      "VALIDATION_ERROR",
      "لا ترسل إصدارًا عند الإنشاء",
    );
  const existing = !!id;
  id = id || randomUUID();
  let temporaryPassword: string | undefined;
  if (kind === "customers") {
    const area = await one<{ active: boolean }>(
      tx,
      "SELECT active FROM areas WHERE id=$1::uuid",
      p.areaId,
    );
    check(
      area && (area.active || !p.active),
      400,
      "VALIDATION_ERROR",
      "اختر منطقة نشطة للعميل",
    );
    await write(
      tx,
      `INSERT INTO customers(id,code,code_normalized,name,phone,default_address,area_id,active) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8) ON CONFLICT(id) DO UPDATE SET code=excluded.code,code_normalized=excluded.code_normalized,name=excluded.name,phone=excluded.phone,default_address=excluded.default_address,area_id=excluded.area_id,active=excluded.active,version=customers.version+1`,
      id,
      p.code,
      String(p.code).toLowerCase(),
      p.name,
      p.phone,
      p.defaultAddress,
      p.areaId,
      p.active,
    );
  } else if (kind === "products") {
    await write(
      tx,
      `INSERT INTO products(id,sku,sku_normalized,name,unit,active) VALUES($1::uuid,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,sku_normalized=excluded.sku_normalized,name=excluded.name,unit=excluded.unit,active=excluded.active,version=products.version+1`,
      id,
      p.sku,
      String(p.sku).toLowerCase(),
      p.name,
      p.unit,
      p.active,
    );
    await balance(tx, id);
  } else if (kind === "areas") {
    await write(
      tx,
      `INSERT INTO areas(id,name,name_normalized,active) VALUES($1::uuid,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_normalized=excluded.name_normalized,active=excluded.active,version=areas.version+1`,
      id,
      p.name,
      String(p.name).toLowerCase(),
      p.active,
    );
  } else {
    if (existing) {
      await write(
        tx,
        "UPDATE users SET name=$2,username=$3,username_normalized=$4,active=$5,version=version+1,updated_at=now() WHERE id=$1::uuid",
        id,
        p.name,
        p.username,
        String(p.username).toLowerCase(),
        p.active,
      );
      if (id !== u.id) await revoke(tx, id);
    } else {
      temporaryPassword = randomBytes(18).toString("base64url");
      await write(
        tx,
        "INSERT INTO users(id,name,username,username_normalized,active,password_hash) VALUES($1::uuid,$2,$3,$4,$5,$6)",
        id,
        p.name,
        p.username,
        String(p.username).toLowerCase(),
        p.active,
        await hashPassword(temporaryPassword),
      );
    }
    await write(tx, "DELETE FROM user_roles WHERE user_id=$1::uuid", id);
    for (const r of p.roles as string[])
      await write(tx, "INSERT INTO user_roles VALUES($1::uuid,$2)", id, r);
    await write(tx, "DELETE FROM user_areas WHERE user_id=$1::uuid", id);
    for (const areaId of p.areaIds as string[])
      await write(
        tx,
        "INSERT INTO user_areas(user_id,area_id) VALUES($1::uuid,$2::uuid)",
        id,
        areaId,
      );
  }
  await event(
    tx,
    u,
    "MASTER_SAVE",
    `${existing ? "تعديل" : "إضافة"} ${kind}`,
    requestId,
    undefined,
    JSON.stringify({ id, ...p }),
  );
  const row = await one(tx, `SELECT * FROM ${kind} WHERE id=$1::uuid`, id);
  const record =
    kind === "users"
      ? await getActor(tx, id)
      : kind === "customers"
        ? customerDto(row!)
        : kind === "products"
          ? productDto(row!)
          : areaDto(row!);
  return { ...record, temporaryPassword };
}
export function areaDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    version: row.version,
  };
}
export async function resetPassword(
  tx: Tx,
  u: Actor,
  id: string,
  version: number,
  requestId: string,
) {
  requireRole(u, "SUPER_ADMIN");
  const target = await getActor(tx, id);
  check(target, 404, "NOT_FOUND", "المستخدم غير موجود");
  expected(target.version, version);
  const temporaryPassword = randomBytes(18).toString("base64url");
  await write(
    tx,
    "UPDATE users SET password_hash=$2,must_change_password=true,version=version+1,updated_at=now() WHERE id=$1::uuid",
    id,
    await hashPassword(temporaryPassword),
  );
  await revoke(tx, id);
  await event(
    tx,
    u,
    "PASSWORD_RESET",
    "إعادة ضبط كلمة المرور",
    requestId,
    undefined,
    JSON.stringify({ userId: id }),
  );
  return { id, temporaryPassword };
}
export async function stock(
  tx: Tx,
  u: Actor,
  type: "openings" | "receipts" | "adjustments",
  input: unknown,
  requestId: string,
) {
  requireRole(
    u,
    ...(type === "receipts" ? ["WAREHOUSE_MANAGER"] : ["SUPER_ADMIN"]),
  );
  const p = stockSchema.parse(input);
  const product = await one(
    tx,
    "SELECT id FROM products WHERE id=$1::uuid",
    p.productId,
  );
  check(product, 404, "NOT_FOUND", "الصنف غير موجود");
  const b = await balance(tx, p.productId);
  expected(b.version, p.expectedVersion);
  if (type === "receipts") {
    check(
      p.quantity !== undefined && p.countedOnHand === undefined,
      400,
      "VALIDATION_ERROR",
      "أدخل كمية الوارد",
    );
    const id = randomUUID();
    await write(
      tx,
      `INSERT INTO stock_receipts(id,warehouse_id,product_id,quantity,reason,status,created_by,created_by_name_snapshot) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,'PENDING_FINANCE',$6::uuid,$7)`,
      id,
      MAIN,
      p.productId,
      p.quantity,
      p.reason,
      u.id,
      u.name,
    );
    await event(
      tx,
      u,
      "STOCK_RECEIPT_REQUEST",
      "تسجيل وارد بانتظار موافقة الحسابات",
      requestId,
      undefined,
      JSON.stringify({ id, ...p }),
    );
    return camel(
      (await one(tx, "SELECT * FROM stock_receipts WHERE id=$1::uuid", id))!,
    );
  }
  if (type === "openings") {
    const prior = await one(
      tx,
      "SELECT id FROM stock_movements WHERE product_id=$1::uuid LIMIT 1",
      p.productId,
    );
    check(!prior, 409, "OPENING_EXISTS", "سبق تسجيل حركة لهذا الصنف");
  }
  check(
    type === "adjustments"
      ? p.countedOnHand !== undefined && p.quantity === undefined
      : p.quantity !== undefined && p.countedOnHand === undefined,
    400,
    "VALIDATION_ERROR",
    "أدخل كمية الحركة المناسبة",
  );
  await movement(
    tx,
    u,
    b,
    type === "openings" ? "OPENING" : "ADJUSTMENT",
    type === "adjustments" ? p.countedOnHand! - Number(b.on_hand) : p.quantity!,
    0,
    p.reason,
    randomUUID(),
  );
  await event(
    tx,
    u,
    "STOCK_MOVEMENT",
    p.reason,
    requestId,
    undefined,
    JSON.stringify({ type, ...p }),
  );
  return camel(await balance(tx, p.productId));
}
export async function reviewStockReceipt(
  tx: Tx,
  u: Actor,
  id: string,
  decision: "approve" | "reject",
  input: unknown,
  requestId: string,
) {
  requireRole(u, "FINANCE");
  const p = stockReceiptReviewSchema.parse(input);
  const receipt = await one(
    tx,
    "SELECT * FROM stock_receipts WHERE id=$1::uuid FOR UPDATE",
    id,
  );
  check(receipt, 404, "NOT_FOUND", "طلب الوارد غير موجود");
  expected(receipt.version, p.expectedVersion);
  check(
    receipt.status === "PENDING_FINANCE",
    409,
    "INVALID_TRANSITION",
    "تمت مراجعة طلب الوارد بالفعل",
  );
  check(
    decision !== "reject" || p.note.length > 0,
    400,
    "VALIDATION_ERROR",
    "سبب رفض الوارد مطلوب",
  );
  if (decision === "approve") {
    const b = await balance(tx, String(receipt.product_id));
    await movement(
      tx,
      u,
      b,
      "RECEIPT",
      Number(receipt.quantity),
      0,
      String(receipt.reason),
      id,
    );
  }
  await write(
    tx,
    `UPDATE stock_receipts SET status=$2,reviewed_by=$3::uuid,reviewed_at=now(),finance_note=$4,version=version+1 WHERE id=$1::uuid`,
    id,
    decision === "approve" ? "APPROVED" : "REJECTED",
    u.id,
    p.note || null,
  );
  await event(
    tx,
    u,
    decision === "approve"
      ? "STOCK_RECEIPT_APPROVED"
      : "STOCK_RECEIPT_REJECTED",
    decision === "approve" ? "اعتماد الوارد وإضافته للمخزون" : "رفض طلب الوارد",
    requestId,
    undefined,
    JSON.stringify({ receiptId: id, note: p.note }),
  );
  return camel(
    (await one(tx, "SELECT * FROM stock_receipts WHERE id=$1::uuid", id))!,
  );
}
export async function reconcile(tx: Tx) {
  return rows(
    tx,
    `SELECT b.product_id,b.on_hand,b.reserved,coalesce(m.hand,0)::integer AS ledger_on_hand,coalesce(m.reserved,0)::integer AS ledger_reserved,coalesce(r.quantity,0)::integer AS active_reservations FROM inventory_balances b LEFT JOIN (SELECT product_id,sum(on_hand_delta) hand,sum(reserved_delta) reserved FROM stock_movements GROUP BY product_id)m ON m.product_id=b.product_id LEFT JOIN(SELECT product_id,sum(quantity) quantity FROM reservations WHERE state='ACTIVE' GROUP BY product_id)r ON r.product_id=b.product_id WHERE b.on_hand<>coalesce(m.hand,0) OR b.reserved<>coalesce(m.reserved,0) OR b.reserved<>coalesce(r.quantity,0)`,
  );
}
