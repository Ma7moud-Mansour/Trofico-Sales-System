import type {
  Order,
  OrderFilters,
  Page,
  SaveDraftInput,
  ReviewInput,
  FinanceRecommendationInput,
  AssignmentInput,
  DeliveryInput,
  FailedAttemptInput,
  CancelInput,
  MutationMeta,
  ViewData,
  User,
  Customer,
  Product,
  Area,
  RolePermissionSet,
  Role,
  Permission,
} from "@/domain/types";
export interface OrdersService {
  list(filters: OrderFilters): Promise<Page<Order>>;
  get(id: string): Promise<Order>;
  saveDraft(input: SaveDraftInput, meta: MutationMeta): Promise<Order>;
  submit(id: string, meta: MutationMeta): Promise<Order>;
  recommendFinance(
    id: string,
    input: FinanceRecommendationInput,
    meta: MutationMeta,
  ): Promise<Order>;
  finalizeReview(
    id: string,
    input: ReviewInput,
    meta: MutationMeta,
  ): Promise<Order>;
  confirmWarehouse(id: string, meta: MutationMeta): Promise<Order>;
  assignDriver(
    id: string,
    input: AssignmentInput,
    meta: MutationMeta,
  ): Promise<Order>;
  dispatch(id: string, meta: MutationMeta): Promise<Order>;
  deliver(id: string, input: DeliveryInput, meta: MutationMeta): Promise<Order>;
  reportFailedAttempt(
    id: string,
    input: FailedAttemptInput,
    meta: MutationMeta,
  ): Promise<Order>;
  cancel(id: string, input: CancelInput, meta: MutationMeta): Promise<Order>;
  recordStockIssue(
    id: string,
    input: FailedAttemptInput,
    meta: MutationMeta,
  ): Promise<Order>;
  deleteDraft(id: string, meta: MutationMeta): Promise<Order>;
}
export type MasterKind = "users" | "customers" | "products" | "areas";
export type MasterRecord = User | Customer | Product | Area;
export interface MasterService<T> {
  save(input: T): Promise<void>;
}
export interface Services {
  orders: OrdersService;
  dashboard: { get(): Promise<ViewData> };
  session: {
    current(): User | null;
    accounts(): User[];
    login(id: string): User;
    logout(): void;
  };
  users: MasterService<User>;
  customers: MasterService<Customer>;
  products: MasterService<Product>;
  areas: MasterService<Area>;
  permissions: {
    save(
      role: Role,
      permissions: Permission[],
      expectedVersion: number,
    ): Promise<RolePermissionSet>;
  };
  inventory: { list(): Promise<ViewData["inventory"]> };
  activity: { list(): Promise<ViewData["activity"]> };
}
