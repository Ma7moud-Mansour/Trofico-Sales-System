import { describe, expect, it } from "vitest";
import veterinaryCatalog from "../src/data/veterinary-products.json";
import { createSeed } from "../src/services/mock/seed";

describe("Official veterinary catalog", () => {
  it("loads the 26 Trofico veterinary products with stable internal SKUs", () => {
    expect(veterinaryCatalog.source).toBe(
      "https://trofico.net/products/veterinary",
    );
    expect(veterinaryCatalog.products).toHaveLength(26);
    expect(veterinaryCatalog.products.map(({ sourceId }) => sourceId)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(new Set(veterinaryCatalog.products.map(({ sku }) => sku)).size).toBe(
      26,
    );
    expect(veterinaryCatalog.products[0]).toMatchObject({
      sku: "VET-001",
      name: "TRIJECT SOLVE",
      nameAr: "تراي جيكت سولف",
    });
    expect(veterinaryCatalog.products.at(-1)).toMatchObject({
      sku: "VET-026",
      name: "TROFIMAX D3",
      nameAr: "تروفيمكس دي3",
    });
  });

  it("uses the official catalog and package unit in demo data", () => {
    const products = createSeed("2026-09-24T10:00:00.000Z").products;

    expect(products).toHaveLength(26);
    expect(
      products.every(({ active, unit }) => active && unit === "عبوة"),
    ).toBe(true);
    expect(products.map(({ sku, name }) => ({ sku, name }))).toEqual(
      veterinaryCatalog.products.map(({ sku, name }) => ({ sku, name })),
    );
  });
});
