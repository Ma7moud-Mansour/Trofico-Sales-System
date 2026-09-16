import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { services, demo } from "../src/services/mock/adapter";
import type { Database } from "../src/domain/types";
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}
beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", new EventTarget());
  demo.failNext(null);
  services.session.accounts();
});
afterEach(() => vi.unstubAllGlobals());
function database(): Database {
  return JSON.parse(localStorage.getItem("trofico-sales-v1")!);
}
describe("Mock transaction and admin invariants", () => {
  it("Changing session mid-flight cannot attribute an action to a different user", async () => {
    services.session.login("u1");
    const request = services.orders.saveDraft(
      { customerId: "", deliveryAddress: "", items: [] },
      { expectedVersion: 0, idempotencyKey: "session-change" },
    );
    services.session.login("u2");
    await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database().orders).toHaveLength(24);
  });
  it("AC20: persistence failure rolls back stock, events, order and receipts", async () => {
    services.session.login("u4");
    const before = localStorage.getItem("trofico-sales-v1");
    const o = database().orders.find((o) => o.id === "o3")!;
    demo.failNext("storage");
    await expect(
      services.orders.confirmWarehouse(o.id, {
        expectedVersion: o.version,
        idempotencyKey: "retry",
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(localStorage.getItem("trofico-sales-v1")).toBe(before);
    await services.orders.confirmWarehouse(o.id, {
      expectedVersion: o.version,
      idempotencyKey: "retry",
    });
    expect(database().orders.find((x) => x.id === o.id)?.status).toBe(
      "WAREHOUSE_CONFIRMED",
    );
  });
  it("review validation failure cannot persist partially changed decisions", async () => {
    services.session.login("u3");
    const before = localStorage.getItem("trofico-sales-v1");
    const o = database().orders.find(
      (order) => order.status === "PENDING_MANAGER",
    )!;
    await expect(
      services.orders.finalizeReview(
        o.id,
        {
          decisions: [
            { itemId: o.items[0].id, status: "APPROVED" },
            { itemId: o.items[1].id, status: "REJECTED", reason: "" },
          ],
        },
        { expectedVersion: o.version, idempotencyKey: "invalid" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(localStorage.getItem("trofico-sales-v1")).toBe(before);
  });
  it("last Admin role, current account, and assigned in-transit driver cannot be disabled", async () => {
    const admin = services.session.login("u9");
    await expect(
      services.users.save({ ...admin, active: false }),
    ).rejects.toThrow("حسابك");
    await expect(
      services.users.save({ ...admin, roles: ["FINANCE"] }),
    ).rejects.toThrow("آخر مدير");
    const driver = database().users.find((u) => u.id === "u7")!;
    await expect(
      services.users.save({ ...driver, active: false }),
    ).rejects.toThrow("قيد التوصيل");
  });
  it("AC17/18: master edit preserves order snapshot and deactivation persists", async () => {
    services.session.login("u9");
    const before = database().orders[0].customerSnapshot;
    const customer = database().customers[0];
    await services.customers.save({
      ...customer,
      name: "اسم العميل الجديد",
      active: false,
    });
    expect(database().orders[0].customerSnapshot).toEqual(before);
    expect(database().customers[0].active).toBe(false);
  });
  it("master uniqueness and role checks are enforced in service", async () => {
    services.session.login("u9");
    const customer = database().customers[0];
    await expect(
      services.customers.save({ ...customer, id: "", name: "نسخة" }),
    ).rejects.toThrow("مستخدم بالفعل");
    services.session.login("u1");
    await expect(
      services.customers.save({ ...customer, name: "تغيير" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("AC19: logout retains database and login changes visible scope", async () => {
    services.session.login("u1");
    const rep = await services.dashboard.get();
    expect(rep.orders.every((o) => o.createdBy === "u1")).toBe(true);
    const before = localStorage.getItem("trofico-sales-v1");
    services.session.logout();
    expect(services.session.current()).toBeNull();
    expect(localStorage.getItem("trofico-sales-v1")).toBe(before);
    services.session.login("u5");
    const finance = await services.dashboard.get();
    expect(finance.orders.every((o) => o.status !== "DRAFT")).toBe(true);
    expect(finance.orders).toHaveLength(22);
    expect(finance.inventory.length).toBeGreaterThan(0);
  });
  it("offline and simulated network errors cannot write", async () => {
    services.session.login("u1");
    const before = localStorage.getItem("trofico-sales-v1");
    demo.failNext("network");
    await expect(
      services.orders.saveDraft(
        { customerId: "", deliveryAddress: "", items: [] },
        { expectedVersion: 0, idempotencyKey: "network" },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(localStorage.getItem("trofico-sales-v1")).toBe(before);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(
      services.orders.saveDraft(
        { customerId: "", deliveryAddress: "", items: [] },
        { expectedVersion: 0, idempotencyKey: "offline" },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(localStorage.getItem("trofico-sales-v1")).toBe(before);
  });
});
