import type { Order, OrderFilters, User, InventoryBalance } from "./types";
import { needsAction, shortages } from "./policies";
import { cairoDay } from "@/messages/ar";
export function filterOrders(
  orders: Order[],
  f: OrderFilters,
  user: User,
  inventory: InventoryBalance[] = [],
) {
  const search = f.search?.trim().toLocaleLowerCase();
  const items = orders.filter((o) => {
    if (f.scope === "/approvals" && o.status !== "PENDING_APPROVAL")
      return false;
    if (
      f.scope === "/warehouse" &&
      !["MANAGER_APPROVED", "WAREHOUSE_CONFIRMED"].includes(o.status)
    )
      return false;
    if (
      f.scope === "/logistics" &&
      !["WAREHOUSE_CONFIRMED", "IN_TRANSIT", "DELIVERED"].includes(o.status)
    )
      return false;
    if (f.scope === "/my-deliveries" && o.assignment?.driverId !== user.id)
      return false;
    if (f.tab === "submitted" && o.status === "DRAFT") return false;
    if (f.tab === "mine" && !needsAction(user, o)) return false;
    if (f.tab === "drafts" && o.status !== "DRAFT") return false;
    if (
      search &&
      ![
        o.orderNumber,
        o.customerSnapshot?.name,
        o.customerSnapshot?.code,
        o.creatorNameSnapshot,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search)
    )
      return false;
    if (
      (f.status && o.status !== f.status) ||
      (f.outcome && o.approvalOutcome !== f.outcome) ||
      (f.rep && o.createdBy !== f.rep) ||
      (f.customer && o.customerId !== f.customer)
    )
      return false;
    if (
      (f.from && (!o.submittedAt || cairoDay(o.submittedAt) < f.from)) ||
      (f.to && (!o.submittedAt || cairoDay(o.submittedAt) > f.to))
    )
      return false;
    if (
      f.issue === "STOCK" &&
      !(
        (o.status === "MANAGER_APPROVED" &&
          shortages(o, inventory).some((s) => s.deficit > 0)) ||
        o.fulfillmentIssue?.type === "STOCK"
      )
    )
      return false;
    if (f.issue === "DELIVERY" && o.fulfillmentIssue?.type !== "DELIVERY")
      return false;
    if (f.issue === "unassigned" && o.assignment) return false;
    if (
      f.issue === "today" &&
      (!o.deliveredAt ||
        cairoDay(o.deliveredAt) !== cairoDay(new Date().toISOString()))
    )
      return false;
    return true;
  });
  return items.sort((a, b) =>
    f.sort === "number"
      ? a.orderNumber.localeCompare(b.orderNumber)
      : f.sort === "oldest" || (!f.sort && f.tab === "mine")
        ? a.updatedAt.localeCompare(b.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
}
