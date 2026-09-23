export const roles = [
  "SALES_REP",
  "SALES_MANAGER",
  "WAREHOUSE_MANAGER",
  "FINANCE",
  "LOGISTICS",
  "DRIVER",
  "SUPER_ADMIN",
] as const;
export type Role = (typeof roles)[number];
export const permissions = [
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
export type Permission = (typeof permissions)[number];
export interface RolePermissionSet {
  role: Role;
  permissions: Permission[];
  version: number;
}
export const statuses = [
  "DRAFT",
  "PENDING_FINANCE",
  "PENDING_MANAGER",
  "MANAGER_APPROVED",
  "WAREHOUSE_CONFIRMED",
  "IN_TRANSIT",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
] as const;
export type Status = (typeof statuses)[number];
export type Outcome = "FULL" | "PARTIAL" | "NONE";
export type Decision = "PENDING" | "APPROVED" | "REJECTED";
export interface User {
  version?: number;
  mustChangePassword?: boolean;
  id: string;
  name: string;
  username: string;
  roles: Role[];
  permissions: Permission[];
  areaIds: string[];
  active: boolean;
}
export interface Area {
  version?: number;
  id: string;
  name: string;
  active: boolean;
}
export interface Customer {
  version?: number;
  id: string;
  code: string;
  name: string;
  phone: string;
  defaultAddress: string;
  areaId: string;
  active: boolean;
}
export interface Product {
  version?: number;
  id: string;
  sku: string;
  name: string;
  unit: string;
  active: boolean;
}
export interface OrderItem {
  id: string;
  productId: string;
  productSnapshot: Product;
  requestedQuantity: number;
  approvalStatus: Decision;
  approvedQuantity: number | null;
  rejectionReason?: string;
  note?: string;
}
export interface Assignment {
  driverId: string;
  driverNameSnapshot: string;
  assignedBy: string;
  assignedAt: string;
  scheduledDate?: string;
  loadingNote?: string;
}
export interface Order {
  id: string;
  orderNumber: string;
  createdBy: string;
  creatorNameSnapshot: string;
  customerId: string;
  customerSnapshot: Customer | null;
  deliveryAddress: string;
  requestedDeliveryDate?: string;
  notes?: string;
  status: Status;
  approvalOutcome?: Outcome;
  financeRecommendation?: "APPROVE" | "REJECT";
  financeNote?: string;
  financeReviewedBy?: string;
  financeReviewedAt?: string;
  items: OrderItem[];
  assignment?: Assignment;
  fulfillmentIssue?: { type: "STOCK" | "DELIVERY"; reason: string };
  createdAt: string;
  submittedAt?: string;
  deliveredAt?: string;
  updatedAt: string;
  version: number;
}
export interface InventoryBalance {
  productId: string;
  onHand: number;
  reserved: number;
  version: number;
}
export interface StockReceipt {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  reason: string;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  createdBy: string;
  createdByNameSnapshot: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  financeNote?: string;
  version: number;
}
export interface Reservation {
  id: string;
  orderId: string;
  itemId: string;
  productId: string;
  quantity: number;
  status: "ACTIVE" | "RELEASED" | "CONSUMED";
}
export interface DeliveryAttempt {
  id: string;
  orderId: string;
  actorId: string;
  outcome: "FAILED" | "DELIVERED";
  reason?: string;
  recipientName?: string;
  note?: string;
  occurredAt: string;
}
export interface ActivityEvent {
  id: string;
  orderId?: string;
  actorId: string;
  actorNameSnapshot: string;
  actorRole: Role;
  type: string;
  occurredAt: string;
  summary: string;
  changes?: string;
}
export interface Database {
  schemaVersion: number;
  orderSequence: number;
  referenceTime: string;
  users: User[];
  rolePermissions: RolePermissionSet[];
  areas: Area[];
  customers: Customer[];
  products: Product[];
  orders: Order[];
  inventory: InventoryBalance[];
  stockReceipts: StockReceipt[];
  reservations: Reservation[];
  attempts: DeliveryAttempt[];
  activity: ActivityEvent[];
  receipts: Record<
    string,
    { actorId: string; operation: string; result: unknown }
  >;
}
export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "NETWORK_ERROR"
  | "STORAGE_ERROR";
export class DomainError extends Error {
  fieldErrors?: Record<string, string[]>;
  constructor(
    public code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
export type MutationMeta = { expectedVersion: number; idempotencyKey: string };
export interface SaveDraftInput {
  id?: string;
  customerId: string;
  deliveryAddress: string;
  requestedDeliveryDate?: string;
  notes?: string;
  items: { id: string; productId: string; quantity: string; note?: string }[];
}
export interface ReviewInput {
  source?: "MANUAL" | "FINANCE_RECOMMENDATION";
  decisions: { itemId: string; status: Decision; reason?: string }[];
}
export interface FinanceRecommendationInput {
  recommendation: "APPROVE" | "REJECT";
  note: string;
}
export interface AssignmentInput {
  driverId: string;
  scheduledDate?: string;
  loadingNote?: string;
}
export interface DeliveryInput {
  recipientName: string;
  note?: string;
}
export interface FailedAttemptInput {
  reason: string;
}
export interface CancelInput {
  reason: string;
}
export interface OrderFilters {
  search?: string;
  status?: string;
  outcome?: string;
  rep?: string;
  customer?: string;
  from?: string;
  to?: string;
  issue?: string;
  tab?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  scope?: string;
}
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export interface ViewData {
  user: User;
  users: User[];
  rolePermissions: RolePermissionSet[];
  areas: Area[];
  customers: Customer[];
  products: Product[];
  orders: Order[];
  inventory: InventoryBalance[];
  stockReceipts: StockReceipt[];
  reservations: Reservation[];
  attempts: DeliveryAttempt[];
  activity: ActivityEvent[];
}
