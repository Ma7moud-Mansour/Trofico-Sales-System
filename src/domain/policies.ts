import {
  DomainError,
  type User,
  type Order,
  type Role,
  type Permission,
  type InventoryBalance,
} from "./types";
export const hasRole = (u: User, ...r: Role[]) =>
  u.active &&
  (u.roles.includes("SUPER_ADMIN") || r.some((role) => u.roles.includes(role)));
export const can = (u: User, ...permissions: Permission[]) =>
  u.active &&
  (u.roles.includes("SUPER_ADMIN") ||
    permissions.some((permission) => u.permissions.includes(permission)));
export function canViewOrder(u: User, o: Order) {
  if (!can(u, "ORDERS_VIEW")) return false;
  return (
    u.active &&
    (o.status === "DRAFT"
      ? u.roles.includes("SUPER_ADMIN") ||
        ((u.roles.includes("SALES_REP") || can(u, "ORDERS_CREATE")) &&
          o.createdBy === u.id)
      : can(
          u,
          "FINANCE_RECOMMEND",
          "MANAGER_DECIDE",
          "WAREHOUSE_PREPARE",
          "LOGISTICS_VIEW",
        ) ||
        ((u.roles.includes("SALES_REP") || can(u, "ORDERS_CREATE")) &&
          o.createdBy === u.id) ||
        (can(u, "DELIVERY_CONFIRM") && o.assignment?.driverId === u.id))
  );
}
export function canCancel(u: User, o: Order) {
  return (
    [
      "DRAFT",
      "PENDING_FINANCE",
      "PENDING_MANAGER",
      "MANAGER_APPROVED",
      "WAREHOUSE_CONFIRMED",
    ].includes(o.status) &&
    ((can(u, "MANAGER_DECIDE") && o.status !== "DRAFT") ||
      (can(u, "ORDERS_CREATE") &&
        (u.roles.includes("SUPER_ADMIN") || u.id === o.createdBy) &&
        ["DRAFT", "PENDING_FINANCE", "PENDING_MANAGER"].includes(o.status)))
  );
}
export type Action =
  | "edit"
  | "finance"
  | "review"
  | "warehouse"
  | "assign"
  | "dispatch"
  | "deliver"
  | "failed"
  | "cancel"
  | "stock";
export function canActOnOrder(u: User, o: Order, a: Action) {
  if (!canViewOrder(u, o)) return false;
  switch (a) {
    case "edit":
      return (
        o.status === "DRAFT" &&
        (o.createdBy === u.id || u.roles.includes("SUPER_ADMIN")) &&
        can(u, "ORDERS_CREATE")
      );
    case "finance":
      return can(u, "FINANCE_RECOMMEND") && o.status === "PENDING_FINANCE";
    case "review":
      return can(u, "MANAGER_DECIDE") && o.status === "PENDING_MANAGER";
    case "stock":
    case "warehouse":
      return can(u, "WAREHOUSE_PREPARE") && o.status === "MANAGER_APPROVED";
    case "assign":
      return can(u, "WAREHOUSE_PREPARE") && o.status === "WAREHOUSE_CONFIRMED";
    case "dispatch":
      return can(u, "WAREHOUSE_PREPARE") && o.status === "WAREHOUSE_CONFIRMED";
    case "deliver":
    case "failed":
      return (
        o.status === "IN_TRANSIT" &&
        (u.roles.includes("SUPER_ADMIN") ||
          (can(u, "DELIVERY_CONFIRM") && o.assignment?.driverId === u.id))
      );
    case "cancel":
      return canCancel(u, o);
  }
}
export const needsAction = (u: User, o: Order) =>
  ["finance", "review", "warehouse", "assign", "dispatch", "deliver"].some(
    (a) => canActOnOrder(u, o, a as Action),
  );
export function shortages(o: Order, inventory: InventoryBalance[]) {
  return o.items
    .filter((i) => i.approvalStatus === "APPROVED")
    .map((i) => {
      const b = inventory.find((b) => b.productId === i.productId);
      return {
        item: i,
        onHand: b?.onHand ?? 0,
        reserved: b?.reserved ?? 0,
        available: (b?.onHand ?? 0) - (b?.reserved ?? 0),
        deficit: Math.max(
          0,
          (i.approvedQuantity ?? 0) - ((b?.onHand ?? 0) - (b?.reserved ?? 0)),
        ),
      };
    });
}
export function assert(
  condition: unknown,
  message: string,
  code: ConstructorParameters<typeof DomainError>[0] = "VALIDATION_ERROR",
): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
export const routePermissions: Record<string, Permission[]> = {
  "/orders": ["ORDERS_VIEW"],
  "/orders/new": ["ORDERS_CREATE"],
  "/approvals": ["MANAGER_DECIDE"],
  "/warehouse": ["WAREHOUSE_PREPARE"],
  "/inventory": [
    "INVENTORY_VIEW",
    "INVENTORY_RECEIVE",
    "RECEIPTS_APPROVE",
    "STOCK_ADJUST",
  ],
  "/logistics": ["LOGISTICS_VIEW"],
  "/my-deliveries": ["DELIVERY_CONFIRM"],
  "/finance": ["FINANCE_RECOMMEND"],
  "/customers": ["CUSTOMERS_MANAGE"],
  "/areas": ["AREAS_MANAGE"],
  "/products": ["PRODUCTS_MANAGE"],
  "/users": ["USERS_MANAGE"],
  "/activity": ["ACTIVITY_VIEW"],
};
