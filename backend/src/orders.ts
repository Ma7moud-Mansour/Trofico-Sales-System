import { randomUUID } from "node:crypto";
import { type Tx, type Row, one, rows, write, check, MAIN } from "./db.js";
import { type Actor, requireRole } from "./auth.js";
import {
  getOrder,
  event,
  expected,
  has,
  balance,
  movement,
} from "./repository.js";
import { draftSchema, commandSchemas } from "./schemas.js";
export async function draft(
  tx: Tx,
  u: Actor,
  id: string | undefined,
  input: unknown,
  requestId: string,
) {
  requireRole(u, "SALES_REP");
  const p = draftSchema.parse(input);
  let o: Row | undefined;
  if (id) {
    o = await getOrder(tx, id, u, true);
    check(o.createdBy === u.id, 404, "NOT_FOUND", "الطلب غير موجود");
    check(
      o.status === "DRAFT",
      409,
      "INVALID_TRANSITION",
      "الطلب المرسل غير قابل للتعديل",
    );
    expected(o.version, p.expectedVersion);
  } else
    check(
      p.expectedVersion === undefined,
      400,
      "VALIDATION_ERROR",
      "الإصدار لا يرسل عند الإنشاء",
    );
  check(
    new Set(p.items.map((i) => i.productId)).size === p.items.length,
    400,
    "VALIDATION_ERROR",
    "الصنف مكرر",
  );
  let customer: Row | undefined;
  if (p.customerId) {
    customer = await one(
      tx,
      "SELECT * FROM customers WHERE id=$1::uuid AND active",
      p.customerId,
    );
    check(customer, 400, "VALIDATION_ERROR", "اختر عميلًا نشطًا");
  }
  const products: Row[] = [];
  for (const i of p.items) {
    const product = await one(
      tx,
      "SELECT * FROM products WHERE id=$1::uuid AND active",
      i.productId,
    );
    check(product, 400, "VALIDATION_ERROR", "اختر منتجًا نشطًا");
    products.push(product);
  }
  id = id || randomUUID();
  if (!o)
    await write(
      tx,
      `INSERT INTO orders(id,created_by,creator_name_snapshot,status) VALUES($1::uuid,$2::uuid,$3,'DRAFT')`,
      id,
      u.id,
      u.name,
    );
  await write(
    tx,
    `UPDATE orders SET customer_id=$2::uuid,customer_snapshot=$3::jsonb,delivery_address=$4,requested_delivery_date=$5::date,notes=$6,updated_at=now(),version=version+$7 WHERE id=$1::uuid`,
    id,
    p.customerId || null,
    customer ? JSON.stringify(customerDto(customer)) : null,
    p.deliveryAddress,
    p.requestedDeliveryDate || null,
    p.notes || null,
    o ? 1 : 0,
  );
  await write(tx, "DELETE FROM order_items WHERE order_id=$1::uuid", id);
  for (let n = 0; n < p.items.length; n++) {
    const i = p.items[n];
    await write(
      tx,
      `INSERT INTO order_items(id,order_id,product_id,product_snapshot,requested_quantity,note) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5,$6)`,
      randomUUID(),
      id,
      i.productId,
      JSON.stringify(productDto(products[n])),
      i.quantity,
      i.note || null,
    );
  }
  await event(tx, u, "DRAFT", "حفظ المسودة", requestId, id);
  return getOrder(tx, id, u);
}
export function customerDto(c: Row) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    defaultAddress: c.default_address,
    active: c.active,
    version: c.version,
  };
}
export function productDto(p: Row) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    active: p.active,
    version: p.version,
  };
}
export function authorizeCommand(
  u: Actor,
  o: Row,
  type: string,
  replay = false,
) {
  const rules: Record<string, string[]> = {
    submit: ["SALES_REP"],
    review: ["SALES_MANAGER"],
    "warehouse-confirmation": ["WAREHOUSE_MANAGER"],
    "warehouse-notes": ["WAREHOUSE_MANAGER"],
    assignment: ["LOGISTICS"],
    dispatch: ["LOGISTICS", "DRIVER"],
    deliver: ["LOGISTICS", "DRIVER"],
    "delivery-attempts": ["LOGISTICS", "DRIVER"],
    cancel: ["SALES_REP", "SALES_MANAGER", "SUPER_ADMIN"],
    delete: ["SALES_REP"],
  };
  requireRole(u, ...rules[type]);
  if (
    ["dispatch", "deliver", "delivery-attempts"].includes(type) &&
    !has(u, "LOGISTICS")
  )
    check(
      (o.assignment as Row | undefined)?.driverId === u.id,
      403,
      "FORBIDDEN",
      "الطلب غير مسند إليك",
    );
  if (["submit", "delete"].includes(type))
    check(o.createdBy === u.id, 404, "NOT_FOUND", "الطلب غير موجود");
  if (type === "cancel" && !has(u, "SALES_MANAGER", "SUPER_ADMIN"))
    check(
      o.createdBy === u.id &&
        (replay || ["DRAFT", "PENDING_APPROVAL"].includes(String(o.status))),
      403,
      "FORBIDDEN",
      "لا يمكنك إلغاء الطلب بعد المراجعة",
    );
}
export async function orderCommand(
  tx: Tx,
  u: Actor,
  id: string,
  type: keyof typeof commandSchemas,
  input: unknown,
  requestId: string,
) {
  const p = commandSchemas[type].parse(input) as Record<string, unknown>;
  const o = await getOrder(tx, id, u, true);
  authorizeCommand(u, o, type);
  expected(o.version, p.expectedVersion);
  const stage: Record<string, string[]> = {
    submit: ["DRAFT"],
    review: ["PENDING_APPROVAL"],
    "warehouse-confirmation": ["MANAGER_APPROVED"],
    "warehouse-notes": ["MANAGER_APPROVED"],
    assignment: ["WAREHOUSE_CONFIRMED"],
    dispatch: ["WAREHOUSE_CONFIRMED"],
    deliver: ["IN_TRANSIT"],
    "delivery-attempts": ["IN_TRANSIT"],
    cancel: [
      "DRAFT",
      "PENDING_APPROVAL",
      "MANAGER_APPROVED",
      "WAREHOUSE_CONFIRMED",
    ],
    delete: ["DRAFT"],
  };
  check(
    stage[type].includes(String(o.status)),
    409,
    "INVALID_TRANSITION",
    "الإجراء غير متاح في المرحلة الحالية",
  );
  const items = o.items as Row[];
  let status = String(o.status);
  let eventType: string = type;
  let summary = "تحديث الطلب";
  const operation = randomUUID();
  if (type === "submit") {
    check(
      o.customerId && String(o.deliveryAddress).trim() && items.length > 0,
      400,
      "VALIDATION_ERROR",
      "العميل والعنوان وصنف واحد على الأقل مطلوبون",
    );
    const customer = await one(
      tx,
      "SELECT * FROM customers WHERE id=$1::uuid AND active",
      o.customerId,
    );
    check(customer, 400, "VALIDATION_ERROR", "العميل غير نشط");
    for (const i of items) {
      const product = await one(
        tx,
        "SELECT * FROM products WHERE id=$1::uuid AND active",
        i.productId,
      );
      check(product, 400, "VALIDATION_ERROR", "أحد المنتجات غير نشط");
      await write(
        tx,
        "UPDATE order_items SET product_snapshot=$2::jsonb WHERE id=$1::uuid",
        i.id,
        JSON.stringify(productDto(product)),
      );
    }
    const counter = await one<{ year: number; next_value: number }>(
      tx,
      `INSERT INTO order_number_counters(year,next_value) VALUES(extract(year from now() AT TIME ZONE 'Africa/Cairo'),1) ON CONFLICT(year) DO UPDATE SET next_value=order_number_counters.next_value+1 RETURNING *`,
    );
    await write(
      tx,
      "UPDATE orders SET order_number=$2,submitted_at=now(),customer_snapshot=$3::jsonb WHERE id=$1::uuid",
      id,
      `SO-${counter!.year}-${String(counter!.next_value).padStart(6, "0")}`,
      JSON.stringify(customerDto(customer)),
    );
    status = "PENDING_APPROVAL";
    eventType = "SUBMIT";
    summary = "إرسال الطلب إلى الإدارات";
  } else if (type === "review") {
    const decisions = p.decisions as {
      itemId: string;
      status: string;
      reason?: string;
    }[];
    check(
      decisions.length === items.length &&
        new Set(decisions.map((d) => d.itemId)).size === items.length &&
        decisions.every((d) => items.some((i) => i.id === d.itemId)),
      400,
      "VALIDATION_ERROR",
      "يجب مراجعة كل بند مرة واحدة",
    );
    for (const d of decisions) {
      check(
        d.status !== "REJECTED" || d.reason?.trim(),
        400,
        "VALIDATION_ERROR",
        "سبب الرفض مطلوب",
      );
      await write(
        tx,
        `UPDATE order_items SET approval_status=$2,approved_quantity=CASE WHEN $2='APPROVED' THEN requested_quantity ELSE 0 END,rejection_reason=$3 WHERE id=$1::uuid`,
        d.itemId,
        d.status,
        d.status === "REJECTED" ? d.reason : null,
      );
    }
    const approved = decisions.filter((d) => d.status === "APPROVED").length;
    status = approved ? "MANAGER_APPROVED" : "REJECTED";
    await write(
      tx,
      "UPDATE orders SET approval_outcome=$2,manager_approved_at=now() WHERE id=$1::uuid",
      id,
      approved === items.length ? "FULL" : approved ? "PARTIAL" : "NONE",
    );
    eventType = "REVIEW";
    summary = "إنهاء مراجعة أصناف الطلب";
  } else if (type === "warehouse-confirmation") {
    const approved = items
      .filter((i) => i.approvalStatus === "APPROVED")
      .sort((a, b) => String(a.productId).localeCompare(String(b.productId)));
    const stocks: Row[] = [];
    const deficits: Row[] = [];
    for (const i of approved) {
      const b = await balance(tx, String(i.productId));
      stocks.push(b);
      const available = Number(b.on_hand) - Number(b.reserved);
      if (available < Number(i.approvedQuantity))
        deficits.push({
          productId: i.productId,
          required: i.approvedQuantity,
          available,
          shortage: Number(i.approvedQuantity) - available,
        });
    }
    check(
      !deficits.length,
      409,
      "INSUFFICIENT_STOCK",
      "الكميات المتاحة لا تكفي لتأكيد الطلب",
      { items: deficits },
    );
    for (let n = 0; n < approved.length; n++) {
      const i = approved[n];
      await write(
        tx,
        `INSERT INTO reservations VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'ACTIVE')`,
        randomUUID(),
        id,
        i.id,
        MAIN,
        i.productId,
        i.approvedQuantity,
      );
      await movement(
        tx,
        u,
        stocks[n],
        "RESERVE",
        0,
        Number(i.approvedQuantity),
        "حجز الطلب",
        operation,
        id,
      );
    }
    await write(
      tx,
      "UPDATE orders SET warehouse_confirmed_at=now(),fulfillment_issue=NULL WHERE id=$1::uuid",
      id,
    );
    status = "WAREHOUSE_CONFIRMED";
    eventType = "WAREHOUSE";
    summary = "تأكيد الجاهزية وحجز الكميات";
  } else if (type === "warehouse-notes") {
    await write(
      tx,
      "UPDATE orders SET fulfillment_issue=$2::jsonb WHERE id=$1::uuid",
      id,
      JSON.stringify({ type: "STOCK", reason: p.reason }),
    );
    eventType = "STOCK_ISSUE";
    summary = String(p.reason);
  } else if (type === "assignment") {
    const driver = await one(
      tx,
      `SELECT u.* FROM users u WHERE u.id=$1::uuid AND u.active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='DRIVER') FOR UPDATE`,
      p.driverId,
    );
    check(driver, 400, "VALIDATION_ERROR", "اختر سائقًا نشطًا");
    await write(
      tx,
      `INSERT INTO order_assignments(order_id,driver_id,driver_name_snapshot,assigned_by,scheduled_date,loading_note) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::date,$6) ON CONFLICT(order_id) DO UPDATE SET driver_id=excluded.driver_id,driver_name_snapshot=excluded.driver_name_snapshot,assigned_by=excluded.assigned_by,assigned_at=now(),scheduled_date=excluded.scheduled_date,loading_note=excluded.loading_note`,
      id,
      p.driverId,
      driver.name,
      u.id,
      p.scheduledDate || null,
      p.loadingNote || null,
    );
    eventType = "ASSIGN";
    summary = "تعيين السائق";
  } else if (type === "dispatch" || type === "cancel") {
    if (type === "dispatch") {
      const a = o.assignment as Row | undefined;
      check(a, 409, "INVALID_TRANSITION", "عيّن سائقًا أولًا");
      const driver = await one(
        tx,
        `SELECT u.id FROM users u WHERE u.id=$1::uuid AND active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND role='DRIVER') FOR UPDATE`,
        a.driverId,
      );
      check(driver, 409, "INVALID_TRANSITION", "السائق المعين غير نشط");
    }
    const reservations = await rows(
      tx,
      `SELECT * FROM reservations WHERE order_id=$1::uuid AND state='ACTIVE' ORDER BY product_id FOR UPDATE`,
      id,
    );
    if (type === "dispatch")
      check(
        reservations.length ===
          items.filter((i) => i.approvalStatus === "APPROVED").length &&
          reservations.every((r) =>
            items.some(
              (i) =>
                i.id === r.order_item_id && i.approvedQuantity === r.quantity,
            ),
          ),
        409,
        "INVALID_TRANSITION",
        "حجوزات الطلب غير مطابقة",
      );
    for (const r of reservations) {
      const b = await balance(tx, String(r.product_id));
      await movement(
        tx,
        u,
        b,
        type === "dispatch" ? "DISPATCH" : "RELEASE",
        type === "dispatch" ? -Number(r.quantity) : 0,
        -Number(r.quantity),
        type === "dispatch" ? "صرف وخروج الطلب" : String(p.reason),
        operation,
        id,
      );
      await write(
        tx,
        "UPDATE reservations SET state=$2 WHERE id=$1::uuid",
        r.id,
        type === "dispatch" ? "CONSUMED" : "RELEASED",
      );
    }
    status = type === "dispatch" ? "IN_TRANSIT" : "CANCELLED";
    await write(
      tx,
      `UPDATE orders SET ${type === "dispatch" ? "dispatched_at" : "cancelled_at"}=now(),fulfillment_issue=NULL WHERE id=$1::uuid`,
      id,
    );
    eventType = type === "dispatch" ? "DISPATCH" : "CANCEL";
    summary =
      type === "dispatch" ? "بدء التوصيل وصرف الكميات" : String(p.reason);
  } else if (type === "deliver" || type === "delivery-attempts") {
    await write(
      tx,
      `INSERT INTO delivery_attempts(id,order_id,actor_id,outcome,reason_code,reason,recipient_name,note) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`,
      randomUUID(),
      id,
      u.id,
      type === "deliver" ? "DELIVERED" : "FAILED",
      p.reasonCode || null,
      p.reason || null,
      p.recipientName || null,
      p.note || null,
    );
    if (type === "deliver") {
      status = "DELIVERED";
      await write(
        tx,
        "UPDATE orders SET delivered_at=now(),fulfillment_issue=NULL WHERE id=$1::uuid",
        id,
      );
      eventType = "DELIVER";
      summary = `تم التسليم إلى ${p.recipientName}`;
    } else {
      await write(
        tx,
        "UPDATE orders SET fulfillment_issue=$2::jsonb WHERE id=$1::uuid",
        id,
        JSON.stringify({ type: "DELIVERY", reason: p.reason || p.reasonCode }),
      );
      eventType = "FAILED";
      summary = "تعذر التسليم: " + (p.reason || p.reasonCode);
    }
  } else if (type === "delete") {
    // Events remain append-only and detached by FK only when deleting private drafts.
    await event(
      tx,
      u,
      "DELETE_DRAFT",
      "حذف مسودة",
      requestId,
      undefined,
      JSON.stringify({ draftId: id }),
    );
    await write(tx, "DELETE FROM orders WHERE id=$1::uuid", id);
    return o;
  }
  await write(
    tx,
    "UPDATE orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1::uuid",
    id,
    status,
  );
  const changes =
    type === "review"
      ? (p.decisions as { itemId: string; status: string; reason?: string }[])
          .map((d) => {
            const item = items.find((i) => i.id === d.itemId)!;
            return `${(item.productSnapshot as Row).name}: ${d.status === "APPROVED" ? "اعتماد" : "رفض"} ${item.requestedQuantity}${d.reason ? " — " + d.reason : ""}`;
          })
          .join("\n")
      : type === "assignment"
        ? `تعيين السائق: ${(await getOrder(tx, id, u)).assignment ? ((await getOrder(tx, id, u)).assignment as Row).driverNameSnapshot : ""}`
        : p.note
          ? String(p.note)
          : undefined;
  await event(tx, u, eventType, summary, requestId, id, changes);
  return getOrder(tx, id, u);
}
