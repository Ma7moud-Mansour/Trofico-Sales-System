import { z } from "zod";
import { permissionValues } from "./permissions.js";
export const roles = [
  "SALES_REP",
  "SALES_MANAGER",
  "WAREHOUSE_MANAGER",
  "FINANCE",
  "LOGISTICS",
  "DRIVER",
  "SUPER_ADMIN",
] as const;
const text = z.string().trim().min(1).max(200),
  note = z.string().trim().max(1000),
  id = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  )
  .or(z.literal(""))
  .optional();
export const version = z.number().int().min(1);
export const password = z.string().min(12).max(128);
export const loginSchema = z
  .object({ username: text, password: z.string().min(1).max(128) })
  .strict();
export const changeSchema = z
  .object({ currentPassword: z.string().max(128), newPassword: password })
  .strict();
export const draftSchema = z
  .object({
    customerId: id.or(z.literal("")),
    deliveryAddress: z.string().trim().max(500),
    requestedDeliveryDate: date,
    notes: note.optional(),
    items: z
      .array(
        z
          .object({
            id: id.optional(),
            productId: id,
            quantity: z
              .string()
              .regex(/^[0-9]+$/)
              .transform(Number)
              .pipe(z.number().int().min(1).max(2147483647)),
            note: z.string().max(300).optional(),
          })
          .strict(),
      )
      .max(100),
    expectedVersion: version.optional(),
  })
  .strict();
export const commandSchemas = {
  submit: z.object({ expectedVersion: version }).strict(),
  "finance-recommendation": z
    .object({
      expectedVersion: version,
      recommendation: z.enum(["APPROVE", "REJECT"]),
      note,
    })
    .strict()
    .refine((x) => x.recommendation !== "REJECT" || x.note.length > 0, {
      message: "سبب توصية الرفض مطلوب",
      path: ["note"],
    }),
  review: z
    .object({
      expectedVersion: version,
      source: z.enum(["MANUAL", "FINANCE_RECOMMENDATION"]).optional(),
      decisions: z
        .array(
          z
            .object({
              itemId: id,
              status: z.enum(["APPROVED", "REJECTED"]),
              reason: note.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  "warehouse-confirmation": z.object({ expectedVersion: version }).strict(),
  "warehouse-notes": z
    .object({
      expectedVersion: version,
      reason: note.refine((x) => x.length > 0),
    })
    .strict(),
  assignment: z
    .object({
      expectedVersion: version,
      driverId: id,
      scheduledDate: date,
      loadingNote: note.optional(),
    })
    .strict(),
  dispatch: z.object({ expectedVersion: version }).strict(),
  deliver: z
    .object({
      expectedVersion: version,
      recipientName: text,
      note: note.optional(),
    })
    .strict(),
  "delivery-attempts": z
    .object({
      expectedVersion: version,
      reasonCode: z.enum(["ABSENT", "REFUSED", "ADDRESS", "OTHER"]),
      reason: note.optional(),
    })
    .strict()
    .refine((x) => x.reasonCode !== "OTHER" || !!x.reason?.trim(), {
      message: "سبب التعذر مطلوب",
      path: ["reason"],
    }),
  cancel: z
    .object({
      expectedVersion: version,
      reason: note.refine((x) => x.length > 0),
    })
    .strict(),
  delete: z.object({ expectedVersion: version }).strict(),
};
export const customerSchema = z
  .object({
    name: text,
    code: text,
    phone: z.string().trim().max(30),
    defaultAddress: z.string().trim().max(500),
    areaId: id,
    active: z.boolean(),
    expectedVersion: version.optional(),
  })
  .strict();
export const productSchema = z
  .object({
    name: text,
    sku: text,
    unit: z.literal("عبوة").default("عبوة"),
    active: z.boolean(),
    expectedVersion: version.optional(),
  })
  .strict();
export const userSchema = z
  .object({
    name: text,
    username: text,
    roles: z
      .array(z.enum(roles))
      .min(1)
      .max(7)
      .refine((x) => new Set(x).size === x.length),
    areaIds: z
      .array(id)
      .max(50)
      .refine((x) => new Set(x).size === x.length)
      .default([]),
    active: z.boolean(),
    expectedVersion: version.optional(),
  })
  .strict()
  .refine((x) => !x.roles.includes("SALES_REP") || x.areaIds.length > 0, {
    message: "اختر منطقة واحدة على الأقل لمندوب المبيعات",
    path: ["areaIds"],
  });
export const areaSchema = z
  .object({
    name: text,
    active: z.boolean(),
    expectedVersion: version.optional(),
  })
  .strict();
export const rolePermissionSchema = z
  .object({
    permissions: z
      .array(z.enum(permissionValues))
      .max(permissionValues.length)
      .refine((x) => new Set(x).size === x.length),
    expectedVersion: version,
  })
  .strict();
export const stockSchema = z
  .object({
    productId: id,
    quantity: z.number().int().min(1).max(2147483647).optional(),
    countedOnHand: z.number().int().min(0).max(2147483647).optional(),
    reason: note.refine((x) => x.length > 0),
    expectedVersion: version,
  })
  .strict();
export const stockReceiptReviewSchema = z
  .object({
    expectedVersion: version,
    note,
  })
  .strict();
export const querySchema = z
  .object({
    search: z.string().max(200).optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING_FINANCE",
        "PENDING_MANAGER",
        "MANAGER_APPROVED",
        "WAREHOUSE_CONFIRMED",
        "IN_TRANSIT",
        "DELIVERED",
        "REJECTED",
        "CANCELLED",
      ])
      .optional(),
    outcome: z.enum(["FULL", "PARTIAL", "NONE"]).optional(),
    rep: id.optional(),
    customer: id.optional(),
    from: date,
    to: date,
    issue: z.enum(["STOCK", "DELIVERY", "unassigned", "today"]).optional(),
    tab: z.enum(["mine", "drafts", "submitted", "all"]).optional(),
    scope: z
      .enum([
        "/orders",
        "/approvals",
        "/warehouse",
        "/logistics",
        "/my-deliveries",
        "/finance",
      ])
      .optional(),
    sort: z.enum(["number", "oldest", "newest"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();
