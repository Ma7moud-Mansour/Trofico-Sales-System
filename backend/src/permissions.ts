import { check } from "./db.js";

export const permissionValues = [
  "ORDERS_VIEW",
  "ORDERS_CREATE",
  "FINANCE_RECOMMEND",
  "MANAGER_DECIDE",
  "WAREHOUSE_PREPARE",
  "LOGISTICS_VIEW",
  "DELIVERY_CONFIRM",
  "INVENTORY_VIEW",
  "INVENTORY_RECEIVE",
  "RECEIPTS_APPROVE",
  "CUSTOMERS_MANAGE",
  "PRODUCTS_MANAGE",
  "STOCK_ADJUST",
  "USERS_MANAGE",
  "AREAS_MANAGE",
  "ACTIVITY_VIEW",
] as const;

export type Permission = (typeof permissionValues)[number];
type PermissionActor = {
  active: boolean;
  roles: string[];
  permissions: string[];
};

export const hasPermission = (u: PermissionActor, ...values: Permission[]) =>
  u.active &&
  (u.roles.includes("SUPER_ADMIN") ||
    values.some((value) => u.permissions.includes(value)));

export function requirePermission(u: PermissionActor, ...values: Permission[]) {
  check(
    hasPermission(u, ...values),
    403,
    "FORBIDDEN",
    "ليس لديك صلاحية لهذا الإجراء",
  );
}

export function requireSuperAdmin(u: PermissionActor) {
  check(
    u.active && u.roles.includes("SUPER_ADMIN"),
    403,
    "FORBIDDEN",
    "هذا الإجراء متاح لمدير النظام فقط",
  );
}

const orderActions = new Set<Permission>([
  "ORDERS_CREATE",
  "FINANCE_RECOMMEND",
  "MANAGER_DECIDE",
  "WAREHOUSE_PREPARE",
  "LOGISTICS_VIEW",
  "DELIVERY_CONFIRM",
]);
const inventoryActions = new Set<Permission>([
  "INVENTORY_RECEIVE",
  "RECEIPTS_APPROVE",
  "STOCK_ADJUST",
]);

export function normalizePermissions(values: Permission[]) {
  const unique = [...new Set(values)];
  if (unique.some((value) => orderActions.has(value)))
    unique.push("ORDERS_VIEW");
  if (unique.some((value) => inventoryActions.has(value)))
    unique.push("INVENTORY_VIEW");
  return [...new Set(unique)].sort();
}
