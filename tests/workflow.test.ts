import { describe, it, expect, beforeEach } from "vitest";
import { createSeed } from "../src/services/mock/seed";
import { executeCommand, type Command } from "../src/domain/commands";
import { canViewOrder, canActOnOrder } from "../src/domain/policies";
import { filterOrders } from "../src/domain/selectors";
import { quantitySchema } from "../src/features/orders/schemas";
import type { Database, Order, User } from "../src/domain/types";
let db: Database;
let rep: User, manager: User, warehouse: User, logistics: User;
beforeEach(() => {
  db = createSeed("2026-09-10T10:00:00.000Z");
  [rep, , manager, warehouse, , logistics] = db.users;
});
const meta = (o?: Order) => ({
  expectedVersion: o?.version ?? 0,
  idempotencyKey: crypto.randomUUID(),
});
function cmd(actor: User, c: Command, o?: Order) {
  return executeCommand(db, actor, c, meta(o));
}
function draft() {
  return cmd(rep, {
    type: "saveDraft",
    input: {
      customerId: "c1",
      deliveryAddress: "القاهرة",
      notes: "تجربة",
      items: [
        { id: "new1", productId: "p1", quantity: "١٠" },
        { id: "new2", productId: "p2", quantity: "5" },
      ],
    },
  });
}
function pending() {
  const o = draft();
  return cmd(rep, { type: "submit", id: o.id }, o);
}
function approved(partial = false) {
  const o = pending();
  return cmd(
    manager,
    {
      type: "finalizeReview",
      id: o.id,
      input: {
        decisions: o.items.map((i, n) => ({
          itemId: i.id,
          status: partial && n === 1 ? "REJECTED" : "APPROVED",
          reason: partial && n === 1 ? "لا يتوفر" : "",
        })),
      },
    },
    o,
  );
}
function ready() {
  const o = approved();
  return cmd(warehouse, { type: "confirmWarehouse", id: o.id }, o);
}
function assigned() {
  const o = ready();
  return cmd(
    logistics,
    { type: "assignDriver", id: o.id, input: { driverId: "u7" } },
    o,
  );
}
describe("Workflow and permissions", () => {
  it("Deleted draft numbers are never reused", () => {
    const first = draft();
    cmd(rep, { type: "deleteDraft", id: first.id }, first);
    const next = draft();
    expect(next.orderNumber).not.toBe(first.orderNumber);
  });
  it("AC01/02: drafts private; submission visible to departments, not another rep", () => {
    const o = draft();
    expect(canViewOrder(manager, o)).toBe(false);
    expect(canViewOrder(rep, o)).toBe(true);
    cmd(rep, { type: "submit", id: o.id }, o);
    expect(o.status).toBe("PENDING_APPROVAL");
    for (const u of db.users.slice(2)) expect(canViewOrder(u, o)).toBe(true);
    expect(canViewOrder(db.users[1], o)).toBe(false);
  });
  it("AC03: complete approval produces FULL without reserving", () => {
    const before = structuredClone(db.inventory);
    const o = approved();
    expect(o.approvalOutcome).toBe("FULL");
    expect(o.status).toBe("MANAGER_APPROVED");
    expect(db.inventory).toEqual(before);
  });
  it("AC04: partial approval preserves requested quantities and rejection reason", () => {
    const o = approved(true);
    expect(o.approvalOutcome).toBe("PARTIAL");
    expect(o.items[1].requestedQuantity).toBe(5);
    expect(o.items[1].approvedQuantity).toBe(0);
    expect(o.items[1].rejectionReason).toBe("لا يتوفر");
  });
  it("AC05: reject all prevents warehouse actions", () => {
    const o = pending();
    cmd(
      manager,
      {
        type: "finalizeReview",
        id: o.id,
        input: {
          decisions: o.items.map((i) => ({
            itemId: i.id,
            status: "REJECTED",
            reason: "سبب",
          })),
        },
      },
      o,
    );
    expect(o.status).toBe("REJECTED");
    expect(canActOnOrder(warehouse, o, "warehouse")).toBe(false);
  });
  it("AC06: incomplete review rejected", () => {
    const o = pending();
    expect(() =>
      cmd(
        manager,
        { type: "finalizeReview", id: o.id, input: { decisions: [] } },
        o,
      ),
    ).toThrow("جميع");
  });
  it("AC07: finance cannot approve even via command", () => {
    const o = pending();
    expect(() =>
      cmd(
        db.users[4],
        {
          type: "finalizeReview",
          id: o.id,
          input: {
            decisions: o.items.map((i) => ({
              itemId: i.id,
              status: "APPROVED",
            })),
          },
        },
        o,
      ),
    ).toThrow("لا يمكنك");
  });
  it("AC08: shortage makes no partial reservations", () => {
    const o = approved();
    db.inventory.find((b) => b.productId === "p2")!.onHand = 0;
    const before = structuredClone(db.reservations);
    expect(() =>
      cmd(warehouse, { type: "confirmWarehouse", id: o.id }, o),
    ).toThrow("عجز");
    expect(db.reservations).toEqual(before);
    expect(o.status).toBe("MANAGER_APPROVED");
  });
  it("AC09/14: reserve and dispatch once, delivery does not debit", () => {
    const before = structuredClone(db.inventory);
    const o = assigned();
    const key = meta(o);
    executeCommand(db, logistics, { type: "dispatch", id: o.id }, key);
    const after = structuredClone(db.inventory);
    const eventCount = db.activity.length;
    executeCommand(db, logistics, { type: "dispatch", id: o.id }, key);
    expect(db.inventory).toEqual(after);
    expect(db.activity.length).toBe(eventCount);
    cmd(
      logistics,
      { type: "deliver", id: o.id, input: { recipientName: "مستلم" } },
      o,
    );
    expect(db.inventory).toEqual(after);
    expect(o.status).toBe("DELIVERED");
    expect(after[0].onHand).toBe(before[0].onHand - 10);
    expect(after[0].reserved).toBe(before[0].reserved);
  });
  it("AC10: cancellation releases reservation without debit", () => {
    const o = ready();
    const before = db.inventory[0].onHand;
    cmd(
      manager,
      { type: "cancel", id: o.id, input: { reason: "طلب العميل" } },
      o,
    );
    expect(db.inventory[0].onHand).toBe(before);
    expect(
      db.reservations
        .filter((r) => r.orderId === o.id)
        .every((r) => r.status === "RELEASED"),
    ).toBe(true);
  });
  it("AC11: dispatch requires driver", () => {
    const o = ready();
    expect(() => cmd(logistics, { type: "dispatch", id: o.id }, o)).toThrow(
      "سائق",
    );
  });
  it("AC12: driver cannot execute another assignment", () => {
    const o = assigned();
    expect(() => cmd(db.users[7], { type: "dispatch", id: o.id }, o)).toThrow(
      "لا يمكنك",
    );
    cmd(db.users[6], { type: "dispatch", id: o.id }, o);
    expect(o.status).toBe("IN_TRANSIT");
  });
  it("AC13: failed then successful delivery keeps both attempts and clears exception", () => {
    const o = assigned();
    cmd(logistics, { type: "dispatch", id: o.id }, o);
    cmd(
      logistics,
      { type: "reportFailedAttempt", id: o.id, input: { reason: "غير متاح" } },
      o,
    );
    expect(o.status).toBe("IN_TRANSIT");
    cmd(
      logistics,
      { type: "deliver", id: o.id, input: { recipientName: "أحمد" } },
      o,
    );
    expect(db.attempts.filter((a) => a.orderId === o.id)).toHaveLength(2);
    expect(o.fulfillmentIssue).toBeUndefined();
  });
  it("AC14: create retry returns same draft and event", () => {
    const input: Command = {
      type: "saveDraft",
      input: { customerId: "", deliveryAddress: "", items: [] },
    };
    const key = meta();
    const o = executeCommand(db, rep, input, key);
    const count = db.orders.length;
    expect(executeCommand(db, rep, input, key).id).toBe(o.id);
    expect(db.orders.length).toBe(count);
  });
  it("AC15: stale version leaves data intact", () => {
    const o = pending();
    const before = structuredClone(db);
    expect(() =>
      executeCommand(
        db,
        manager,
        { type: "finalizeReview", id: o.id, input: { decisions: [] } },
        { ...meta(o), expectedVersion: 0 },
      ),
    ).toThrow("مستخدم آخر");
    expect(db).toEqual(before);
  });
  it("AC16/24: composed filters and totals are derived from same orders", () => {
    const result = filterOrders(
      db.orders,
      { status: "PENDING_APPROVAL", rep: "u1", search: "SO" },
      manager,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (o) => o.status === "PENDING_APPROVAL" && o.createdBy === "u1",
      ),
    ).toBe(true);
  });
  it("AC17: historic snapshots survive master edits", () => {
    const o = pending();
    db.customers[0].name = "اسم جديد";
    db.products[0].name = "منتج جديد";
    expect(o.customerSnapshot?.name).not.toBe("اسم جديد");
    expect(o.items[0].productSnapshot.name).not.toBe("منتج جديد");
  });
  it("AC18: inactive customer cannot be submitted", () => {
    const o = draft();
    db.customers[0].active = false;
    expect(() => cmd(rep, { type: "submit", id: o.id }, o)).toThrow("غير نشط");
  });
  it("Arabic digits accepted; negative, fractional and invalid quantities rejected", () => {
    expect(quantitySchema.parse("١٢")).toBe("12");
    for (const q of ["0", "-1", "1.5", "abc", "١٫٥"])
      expect(quantitySchema.safeParse(q).success).toBe(false);
  });
  it("Super admin cannot skip approval and rep cannot cancel after final review", () => {
    const o = approved();
    expect(canActOnOrder(db.users[8], o, "warehouse")).toBe(false);
    expect(canActOnOrder(rep, o, "cancel")).toBe(false);
  });
});
