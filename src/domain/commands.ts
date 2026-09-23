import {
  type Database,
  type User,
  type Order,
  type MutationMeta,
  type SaveDraftInput,
  type ReviewInput,
  type FinanceRecommendationInput,
  type AssignmentInput,
  type DeliveryInput,
  type FailedAttemptInput,
  type CancelInput,
} from "./types";
import { assert, canActOnOrder, hasRole, shortages } from "./policies";
import { normalizeDigits, orderSchema } from "@/features/orders/schemas";
export type Command =
  | { type: "saveDraft"; input: SaveDraftInput }
  | { type: "submit"; id: string }
  | { type: "recommendFinance"; id: string; input: FinanceRecommendationInput }
  | { type: "finalizeReview"; id: string; input: ReviewInput }
  | { type: "confirmWarehouse"; id: string }
  | { type: "assignDriver"; id: string; input: AssignmentInput }
  | { type: "dispatch"; id: string }
  | { type: "deliver"; id: string; input: DeliveryInput }
  | { type: "reportFailedAttempt"; id: string; input: FailedAttemptInput }
  | { type: "cancel"; id: string; input: CancelInput }
  | { type: "recordStockIssue"; id: string; input: FailedAttemptInput }
  | { type: "deleteDraft"; id: string };
export function executeCommand(
  db: Database,
  actor: User,
  command: Command,
  meta: MutationMeta,
  now = new Date().toISOString(),
): Order {
  assert(actor.active, "هذا الحساب غير نشط", "FORBIDDEN");
  assert(meta.idempotencyKey, "مفتاح العملية مطلوب");
  const operation = JSON.stringify(command);
  const key = `${actor.id}:${meta.idempotencyKey}`;
  const previous = db.receipts[key];
  if (previous) {
    assert(previous.operation === operation, "مفتاح العملية مستخدم لطلب مختلف");
    return structuredClone(previous.result as Order);
  }
  const id = command.type === "saveDraft" ? command.input.id : command.id;
  let o = db.orders.find((o) => o.id === id);
  if (id) assert(o, "الطلب غير موجود", "NOT_FOUND");
  if (o)
    assert(
      o.version === meta.expectedVersion,
      "تم تعديل الطلب بواسطة مستخدم آخر. أعد تحميل البيانات.",
      "VERSION_CONFLICT",
    );
  const event = (type: string, summary: string, changes?: string) =>
    db.activity.push({
      id: crypto.randomUUID(),
      orderId: o!.id,
      actorId: actor.id,
      actorNameSnapshot: actor.name,
      actorRole: actor.roles[0],
      type,
      occurredAt: now,
      summary,
      changes,
    });
  if (command.type === "saveDraft") {
    assert(
      hasRole(actor, "SALES_REP") && (!o || canActOnOrder(actor, o, "edit")),
      "لا يمكنك تعديل هذا الطلب",
      "FORBIDDEN",
    );
    const input = command.input;
    assert((input.notes?.length ?? 0) <= 1000, "الملاحظات بحد أقصى 1000 حرف");
    const selected = input.items.filter((i) => i.productId);
    assert(
      new Set(selected.map((i) => i.productId)).size === selected.length,
      "الصنف موجود بالفعل",
    );
    const customer = db.customers.find((c) => c.id === input.customerId);
    if (input.customerId)
      assert(
        customer?.active &&
          (actor.roles.includes("SUPER_ADMIN") ||
            actor.areaIds.includes(customer.areaId)),
        "اختر عميلًا نشطًا من المناطق المخصصة لك",
      );
    const items = selected.map((i) => {
      const product = db.products.find((p) => p.id === i.productId);
      assert(product?.active, "اختر صنفًا نشطًا");
      assert((i.note?.length ?? 0) <= 300, "ملاحظة الصنف بحد أقصى 300 حرف");
      const q = Number(normalizeDigits(i.quantity));
      assert(Number.isSafeInteger(q) && q >= 0, "كمية غير صالحة");
      return {
        id: i.id,
        productId: product.id,
        productSnapshot: { ...product },
        requestedQuantity: q,
        approvalStatus: "PENDING" as const,
        approvedQuantity: null,
        note: i.note,
      };
    });
    if (!o) {
      db.orderSequence =
        (db.orderSequence ??
          db.orders.reduce(
            (max, x) => Math.max(max, Number(x.orderNumber.split("-").at(-1))),
            0,
          )) + 1;
      o = {
        id: crypto.randomUUID(),
        orderNumber: `SO-${new Date(now).getFullYear()}-${String(db.orderSequence).padStart(5, "0")}`,
        createdBy: actor.id,
        creatorNameSnapshot: actor.name,
        customerId: "",
        customerSnapshot: null,
        deliveryAddress: "",
        status: "DRAFT",
        items: [],
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      db.orders.push(o);
    }
    Object.assign(o, {
      customerId: input.customerId,
      customerSnapshot: customer ? { ...customer } : null,
      deliveryAddress: input.deliveryAddress,
      requestedDeliveryDate: input.requestedDeliveryDate,
      notes: input.notes,
      items,
    });
    event("DRAFT", "حفظ المسودة");
  } else {
    assert(o, "الطلب غير موجود", "NOT_FOUND");
    switch (command.type) {
      case "submit": {
        assert(
          canActOnOrder(actor, o, "edit"),
          "لا يمكنك إرسال هذا الطلب",
          "FORBIDDEN",
        );
        const validation = orderSchema.safeParse({
          customerId: o.customerId,
          deliveryAddress: o.deliveryAddress,
          notes: o.notes ?? "",
          items: o.items.map((i) => ({
            id: i.id,
            productId: i.productId,
            quantity: String(i.requestedQuantity),
            note: i.note,
          })),
        });
        assert(validation.success, "راجع العميل والعنوان وكميات الأصناف");
        assert(
          db.customers.some(
            (c) =>
              c.id === o!.customerId &&
              c.active &&
              (actor.roles.includes("SUPER_ADMIN") ||
                actor.areaIds.includes(c.areaId)),
          ) &&
            o.items.every((i) =>
              db.products.some((p) => p.id === i.productId && p.active),
            ),
          "العميل أو أحد الأصناف غير نشط",
        );
        o.status = "PENDING_FINANCE";
        o.submittedAt = now;
        event("SUBMIT", "تم إرسال الطلب إلى الحسابات");
        break;
      }
      case "recommendFinance": {
        assert(
          canActOnOrder(actor, o, "finance"),
          "لا يمكنك تسجيل توصية الحسابات لهذا الطلب",
          "FORBIDDEN",
        );
        assert(
          command.input.recommendation !== "REJECT" ||
            command.input.note.trim(),
          "سبب توصية الرفض مطلوب",
        );
        o.financeRecommendation = command.input.recommendation;
        o.financeNote = command.input.note.trim() || undefined;
        o.financeReviewedBy = actor.id;
        o.financeReviewedAt = now;
        o.status = "PENDING_MANAGER";
        event(
          "FINANCE_RECOMMENDATION",
          command.input.recommendation === "APPROVE"
            ? "الحسابات توصي بالموافقة"
            : "الحسابات توصي بعدم الموافقة",
          command.input.note,
        );
        break;
      }
      case "finalizeReview": {
        assert(
          canActOnOrder(actor, o, "review"),
          "لا يمكنك اعتماد هذا الطلب",
          "FORBIDDEN",
        );
        const decisions = command.input.decisions;
        assert(
          decisions.length === o.items.length &&
            new Set(decisions.map((d) => d.itemId)).size === o.items.length,
          "يجب مراجعة جميع البنود",
        );
        for (const i of o.items) {
          const d = decisions.find((d) => d.itemId === i.id);
          assert(
            d && ["APPROVED", "REJECTED"].includes(d.status),
            "توجد بنود لم تراجع",
          );
          assert(
            d.status !== "REJECTED" || d.reason?.trim(),
            "سبب رفض كل صنف مطلوب",
          );
          i.approvalStatus = d.status;
          i.approvedQuantity =
            d.status === "APPROVED" ? i.requestedQuantity : 0;
          i.rejectionReason =
            d.status === "REJECTED" ? d.reason?.trim() : undefined;
        }
        const count = o.items.filter(
          (i) => i.approvalStatus === "APPROVED",
        ).length;
        o.approvalOutcome =
          count === 0 ? "NONE" : count === o.items.length ? "FULL" : "PARTIAL";
        o.status = count ? "MANAGER_APPROVED" : "REJECTED";
        event(
          "REVIEW",
          `إنهاء المراجعة: ${count} معتمد، ${o.items.length - count} مرفوض`,
        );
        break;
      }
      case "confirmWarehouse": {
        assert(
          canActOnOrder(actor, o, "warehouse"),
          "لا يمكنك تأكيد المخزن",
          "FORBIDDEN",
        );
        const missing = shortages(o, db.inventory).filter((s) => s.deficit > 0);
        assert(
          !missing.length,
          missing
            .map((s) => `${s.item.productSnapshot.name}: عجز ${s.deficit}`)
            .join("، "),
          "INSUFFICIENT_STOCK",
        );
        for (const i of o.items.filter(
          (i) => i.approvalStatus === "APPROVED",
        )) {
          const b = db.inventory.find((b) => b.productId === i.productId)!;
          b.reserved += i.approvedQuantity!;
          b.version++;
          db.reservations.push({
            id: crypto.randomUUID(),
            orderId: o.id,
            itemId: i.id,
            productId: i.productId,
            quantity: i.approvedQuantity!,
            status: "ACTIVE",
          });
        }
        o.status = "WAREHOUSE_CONFIRMED";
        o.fulfillmentIssue = undefined;
        event("WAREHOUSE", "تأكيد الجاهزية وحجز الكميات المعتمدة");
        break;
      }
      case "assignDriver": {
        assert(
          canActOnOrder(actor, o, "assign"),
          "لا يمكنك تعيين سائق",
          "FORBIDDEN",
        );
        const driver = db.users.find((u) => u.id === command.input.driverId);
        assert(driver && hasRole(driver, "DRIVER"), "اختر سائقًا نشطًا");
        o.assignment = {
          ...command.input,
          driverNameSnapshot: driver.name,
          assignedBy: actor.id,
          assignedAt: now,
        };
        event("ASSIGN", `تعيين السائق ${driver.name}`);
        break;
      }
      case "dispatch": {
        assert(
          canActOnOrder(actor, o, "dispatch"),
          "لا يمكنك بدء التوصيل",
          "FORBIDDEN",
        );
        assert(
          o.assignment &&
            db.users.some(
              (u) => u.id === o!.assignment!.driverId && hasRole(u, "DRIVER"),
            ),
          "يجب تعيين سائق نشط قبل الخروج",
        );
        for (const r of db.reservations.filter(
          (r) => r.orderId === o!.id && r.status === "ACTIVE",
        )) {
          const b = db.inventory.find((b) => b.productId === r.productId)!;
          assert(
            b.onHand >= r.quantity && b.reserved >= r.quantity,
            "الحجز غير صالح",
            "INSUFFICIENT_STOCK",
          );
          b.onHand -= r.quantity;
          b.reserved -= r.quantity;
          b.version++;
          r.status = "CONSUMED";
        }
        o.status = "IN_TRANSIT";
        event("DISPATCH", "تأكيد الخروج وصرف جميع الكميات المحجوزة");
        break;
      }
      case "deliver":
      case "reportFailedAttempt": {
        const delivered = command.type === "deliver";
        assert(
          canActOnOrder(actor, o, delivered ? "deliver" : "failed"),
          "لا يمكنك تنفيذ هذا التوصيل",
          "FORBIDDEN",
        );
        if (command.type === "deliver") {
          assert(command.input.recipientName.trim(), "اسم المستلم مطلوب");
          db.attempts.push({
            id: crypto.randomUUID(),
            orderId: o.id,
            actorId: actor.id,
            outcome: "DELIVERED",
            ...command.input,
            occurredAt: now,
          });
          o.status = "DELIVERED";
          o.deliveredAt = now;
          o.fulfillmentIssue = undefined;
          event(
            "DELIVER",
            `تم التسليم إلى ${command.input.recipientName}`,
            command.input.note,
          );
        } else {
          assert(command.input.reason.trim(), "سبب تعذر التسليم مطلوب");
          db.attempts.push({
            id: crypto.randomUUID(),
            orderId: o.id,
            actorId: actor.id,
            outcome: "FAILED",
            reason: command.input.reason,
            occurredAt: now,
          });
          o.fulfillmentIssue = {
            type: "DELIVERY",
            reason: command.input.reason,
          };
          event("FAILED", `تعذر التسليم: ${command.input.reason}`);
        }
        break;
      }
      case "recordStockIssue":
        assert(
          canActOnOrder(actor, o, "stock"),
          "لا يمكنك تسجيل ملاحظة مخزن",
          "FORBIDDEN",
        );
        assert(command.input.reason.trim(), "سبب النقص مطلوب");
        o.fulfillmentIssue = { type: "STOCK", reason: command.input.reason };
        event("STOCK", command.input.reason);
        break;
      case "cancel":
        assert(
          canActOnOrder(actor, o, "cancel"),
          "الإلغاء غير مسموح في هذه المرحلة",
          "FORBIDDEN",
        );
        assert(command.input.reason.trim(), "سبب الإلغاء مطلوب");
        for (const r of db.reservations.filter(
          (r) => r.orderId === o!.id && r.status === "ACTIVE",
        )) {
          const b = db.inventory.find((b) => b.productId === r.productId)!;
          b.reserved -= r.quantity;
          b.version++;
          r.status = "RELEASED";
        }
        o.status = "CANCELLED";
        o.fulfillmentIssue = undefined;
        event("CANCEL", `إلغاء الطلب: ${command.input.reason}`);
        break;
      case "deleteDraft":
        assert(
          canActOnOrder(actor, o, "edit"),
          "لا يمكنك حذف المسودة",
          "FORBIDDEN",
        );
        db.orders = db.orders.filter((x) => x.id !== o!.id);
        event("DRAFT", "حذف المسودة");
        break;
    }
  }
  o.version++;
  o.updatedAt = now;
  db.receipts[key] = {
    actorId: actor.id,
    operation,
    result: structuredClone(o),
  };
  return o;
}
