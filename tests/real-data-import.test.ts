import { describe, expect, it } from "vitest";
import { buildImportPlan } from "../backend/scripts/import-real-data.mjs";
import {
  customerSchema,
  productSchema,
  userSchema,
} from "../backend/src/schemas";
import { createSeed } from "../src/services/mock/seed";
import { executeCommand } from "../src/domain/commands";

const source = {
  sourceSha256: "a".repeat(64),
  customers: [
    { sourceRow: 2, code: "51", name: "عميل أول", representative: "مندوب أول" },
    { sourceRow: 3, code: "51", name: "عميل ثان", representative: "مندوب ثان" },
  ],
  products: [
    { sourceRow: 2, name: "صنف نصف لتر", weight: 0.5, weightUnit: "لتر" },
    { sourceRow: 3, name: "صنف بدون وزن", weight: null, weightUnit: "" },
  ],
};
describe("Real data replacement", () => {
  it("keeps customers with repeated source codes separate and generates stable unique codes", () => {
    const plan = buildImportPlan(source);
    expect(plan.customers.map((c: { code: string }) => c.code)).toEqual([
      "C-00001",
      "C-00002",
    ]);
    expect(plan.customers[0].representativeId).not.toBe(
      plan.customers[1].representativeId,
    );
    expect(
      plan.customers.every((c: { areaId: null }) => c.areaId === null),
    ).toBe(true);
    expect(buildImportPlan(source)).toEqual(plan);
    expect(
      plan.products.map((p: { weight: number | null }) => p.weight),
    ).toEqual([0.5, null]);
  });
  it("rejects repeated source rows and invalid weights before any database mutation", () => {
    expect(() =>
      buildImportPlan({
        ...source,
        customers: [source.customers[0], source.customers[0]],
      }),
    ).toThrow("Duplicate source rows");
    expect(() =>
      buildImportPlan({
        ...source,
        products: [{ ...source.products[0], weight: -1 }],
      }),
    ).toThrow("Invalid product");
  });
  it("allows pending area assignment without accepting malformed IDs or invalid weights", () => {
    expect(
      userSchema.parse({
        name: "مندوب",
        username: "rep.001",
        roles: ["SALES_REP"],
        active: true,
      }).areaIds,
    ).toEqual([]);
    expect(
      customerSchema.parse({
        name: "عميل",
        code: "C-00001",
        phone: "",
        defaultAddress: "",
        active: true,
      }).areaId,
    ).toBe("");
    expect(
      customerSchema.safeParse({
        name: "عميل",
        code: "C-00001",
        phone: "",
        defaultAddress: "",
        active: true,
        representativeId: "invalid",
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        name: "صنف",
        sku: "P-0001",
        active: true,
        weight: Infinity,
      }).success,
    ).toBe(false);
  });
  it("keeps an unassigned representative blocked until an active area is assigned and prevents other representatives' customer access", () => {
    const db = createSeed("2026-10-15T10:00:00.000Z");
    const rep = db.users[0];
    const customer = db.customers[0];
    customer.areaId = "";
    customer.representativeId = rep.id;
    rep.areaIds = [];
    const draft = () =>
      executeCommand(
        db,
        rep,
        {
          type: "saveDraft",
          input: {
            customerId: customer.id,
            deliveryAddress: "عنوان فعلي",
            items: [{ id: "new", productId: db.products[0].id, quantity: "1" }],
          },
        },
        { expectedVersion: 0, idempotencyKey: crypto.randomUUID() },
      );
    expect(draft).toThrow("المناطق المخصصة");
    rep.areaIds = [db.areas[0].id];
    expect(draft().customerId).toBe(customer.id);
    customer.representativeId = db.users[1].id;
    expect(draft).toThrow("المناطق المخصصة");
    customer.representativeId = rep.id;
    db.areas[0].active = false;
    expect(draft).toThrow("المناطق المخصصة");
  });
});
