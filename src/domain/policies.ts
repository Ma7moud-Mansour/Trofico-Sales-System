import {
  DomainError,
  type User,
  type Order,
  type Role,
  type InventoryBalance,
} from "./types";
export const hasRole = (u: User, ...r: Role[]) =>
  u.active && r.some((role) => u.roles.includes(role));
export function canViewOrder(u: User, o: Order) {
  return (
    u.active &&
    (o.status === "DRAFT"
      ? hasRole(u, "SALES_REP") && o.createdBy === u.id
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
      "PENDING_APPROVAL",
      "MANAGER_APPROVED",
      "WAREHOUSE_CONFIRMED",
    ].includes(o.status) &&
    ((hasRole(u, "SALES_MANAGER", "SUPER_ADMIN") && o.status !== "DRAFT") ||
      (hasRole(u, "SALES_REP") &&
        u.id === o.createdBy &&
        ["DRAFT", "PENDING_APPROVAL"].includes(o.status)))
  );
}
export type Action =
  | "edit"
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
        o.status === "DRAFT" && o.createdBy === u.id && hasRole(u, "SALES_REP")
      );
    case "review":
      return hasRole(u, "SALES_MANAGER") && o.status === "PENDING_APPROVAL";
    case "stock":
    case "warehouse":
      return hasRole(u, "WAREHOUSE_MANAGER") && o.status === "MANAGER_APPROVED";
    case "assign":
      return hasRole(u, "LOGISTICS") && o.status === "WAREHOUSE_CONFIRMED";
    case "dispatch":
      return (
        o.status === "WAREHOUSE_CONFIRMED" &&
        (hasRole(u, "LOGISTICS") ||
          (hasRole(u, "DRIVER") && o.assignment?.driverId === u.id))
      );
    case "deliver":
    case "failed":
      return (
        o.status === "IN_TRANSIT" &&
        (hasRole(u, "LOGISTICS") ||
          (hasRole(u, "DRIVER") && o.assignment?.driverId === u.id))
      );
    case "cancel":
      return canCancel(u, o);
  }
}
export const needsAction = (u: User, o: Order) =>
  ["review", "warehouse", "dispatch", "deliver"].some((a) =>
    canActOnOrder(u, o, a as Action),
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
  "/inventory": ["WAREHOUSE_MANAGER", "SALES_MANAGER", "SUPER_ADMIN"],
  "/logistics": ["LOGISTICS"],
  "/my-deliveries": ["DRIVER"],
  "/finance": ["FINANCE"],
  "/customers": ["SUPER_ADMIN"],
  "/products": ["SUPER_ADMIN"],
  "/users": ["SUPER_ADMIN"],
  "/activity": ["SUPER_ADMIN"],
};
