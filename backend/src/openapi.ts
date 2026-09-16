import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import {
  loginSchema,
  changeSchema,
  draftSchema,
  commandSchemas,
  customerSchema,
  productSchema,
  userSchema,
  stockSchema,
  stockReceiptReviewSchema,
  version,
} from "./schemas.js";
const paths: Record<string, unknown> = {};
function add(path: string, method: string, schema?: z.ZodTypeAny) {
  const p = (paths["/api/v1/" + path] || {}) as Record<string, unknown>;
  p[method] = {
    summary: path,
    security: path.startsWith("auth/login") ? [] : [{ session: [] }],
    parameters:
      method === "get"
        ? []
        : [
            {
              in: "header",
              name: "X-CSRF-Token",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "header",
              name: "Idempotency-Key",
              required: !path.startsWith("auth/"),
              schema: { type: "string" },
            },
          ],
    ...(schema
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
              },
            },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "{data: DTO}; orders: {data:{items,total,page,pageSize}}",
      },
      "400": { description: "VALIDATION_ERROR + fieldErrors" },
      "401": { description: "UNAUTHENTICATED" },
      "403": { description: "FORBIDDEN / CSRF_INVALID" },
      "409": {
        description:
          "VERSION_CONFLICT / INVALID_TRANSITION / INSUFFICIENT_STOCK / IDEMPOTENCY_KEY_REUSED",
      },
    },
  };
  paths["/api/v1/" + path] = p;
}
for (const p of [
  "auth/csrf",
  "auth/me",
  "workspace",
  "orders",
  "orders/{id}",
  "orders/{id}/activity",
  "users",
  "customers",
  "products",
  "lookups/customers",
  "lookups/products",
  "lookups/drivers",
  "inventory/balances",
  "inventory/movements",
  "inventory/receipts",
  "dashboard",
  "activity",
  "health/live",
  "health/ready",
])
  add(p, "get");
add("auth/login", "post", loginSchema);
add("auth/change-password", "post", changeSchema);
add("auth/logout", "post", z.object({}).strict());
add("orders", "post", draftSchema);
add("orders/{id}", "patch", draftSchema);
add("orders/{id}", "delete", commandSchemas.delete);
for (const [k, s] of Object.entries(commandSchemas))
  if (k !== "delete") add("orders/{id}/" + k, "post", s);
for (const [k, s] of Object.entries({
  users: userSchema,
  customers: customerSchema,
  products: productSchema,
})) {
  add(k, "post", s);
  add(k + "/{id}", "patch", s);
}
add(
  "users/{id}/reset-password",
  "post",
  z.object({ expectedVersion: version }).strict(),
);
for (const k of ["openings", "receipts", "adjustments"])
  add("inventory/" + k, "post", stockSchema);
for (const decision of ["approve", "reject"])
  add(`inventory/receipts/{id}/${decision}`, "post", stockReceiptReviewSchema);
export const openApi = {
  openapi: "3.0.3",
  info: { title: "Trofico Sales API", version: "2.0.0" },
  paths,
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "__Host-session" },
    },
  },
};
