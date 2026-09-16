import {
  DomainError,
  type User,
  type Order,
  type Role,
  type InventoryBalance,
} from "./types";
export const hasRole = (u: User, ...r: Role[]) =>
  u.active &&
  (u.roles.includes("SUPER_ADMIN") || r.some((role) => u.roles.includes(role)));
export function canViewOrder(u: User, o: Order) {
  return (
    u.active &&
    (o.status === "DRAFT"
      ? u.roles.includes("SUPER_ADMIN") ||
        (hasRole(u, "SALES_REP") && o.createdBy === u.id)
      : hasRole(
          u,
          "SALES_MANAGER",
          "WAREHOUSE_MANAGER",
          "FINANCE",
          "LOGISTICS",
          "DRIVER",
          "SUPER_ADMIN",
        ) || o.createdBy === u.id)
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
    ((hasRole(u, "SALES_MANAGER", "SUPER_ADMIN") && o.status !== "DRAFT") ||
      (hasRole(u, "SALES_REP") &&
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
        hasRole(u, "SALES_REP")
      );
    case "finance":
      return hasRole(u, "FINANCE") && o.status === "PENDING_FINANCE";
    case "review":
      return hasRole(u, "SALES_MANAGER") && o.status === "PENDING_MANAGER";
    case "stock":
    case "warehouse":
      return hasRole(u, "WAREHOUSE_MANAGER") && o.status === "MANAGER_APPROVED";
    case "assign":
      return (
        hasRole(u, "WAREHOUSE_MANAGER") && o.status === "WAREHOUSE_CONFIRMED"
      );
    case "dispatch":
      return (
        hasRole(u, "WAREHOUSE_MANAGER") && o.status === "WAREHOUSE_CONFIRMED"
      );
    case "deliver":
    case "failed":
      return (
        o.status === "IN_TRANSIT" &&
        (u.roles.includes("SUPER_ADMIN") ||
          (hasRole(u, "DRIVER") && o.assignment?.driverId === u.id))
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
export const routeRoles: Record<string, Role[]> = {
  "/orders/new": ["SALES_REP"],
  "/approvals": ["SALES_MANAGER"],
  "/warehouse": ["WAREHOUSE_MANAGER"],
  "/inventory": ["WAREHOUSE_MANAGER", "SALES_MANAGER", "FINANCE"],
  "/logistics": ["LOGISTICS"],
  "/my-deliveries": ["DRIVER"],
  "/finance": ["FINANCE"],
  "/customers": ["FINANCE"],
  "/products": ["FINANCE"],
  "/users": ["SUPER_ADMIN"],
  "/activity": ["SUPER_ADMIN"],
};
