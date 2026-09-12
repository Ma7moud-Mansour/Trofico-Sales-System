# المرحلة الثانية: عقد الربط

Baseline: 28 unit/adapter tests passed. Existing Next.js UI remains the presentation layer. Default deployment is two Node processes behind one origin; provider capabilities are unknown. No deployment is authorized or performed.

| Screen / hook | Existing service | HTTP API / payload | Response / invalidation |
|---|---|---|---|
| Shell | session.current/login/logout | auth/me, login {username,password}, logout | Safe User, clear entire user-scoped cache |
| All workspaces / useWorkspace | dashboard.get | GET workspace (scoped aggregate compatibility DTO) | ViewData; 15s visible polling |
| Orders / details | orders.list/get | GET orders with filters; GET orders/:id | Page<Order> / Order |
| Order editor | saveDraft | POST orders / PATCH orders/:id + expectedVersion | Order; invalidate workspace/lists/details |
| Send | submit | POST orders/:id/submit | Order, snapshots captured by server |
| Approval | finalizeReview | POST orders/:id/review {decisions,expectedVersion} | Order; atomic full review |
| Warehouse | confirmWarehouse, recordStockIssue | warehouse-confirmation / warehouse-notes | Order; invalidate inventory/activity |
| Dispatch | assignDriver / dispatch | assignment / dispatch | Order |
| Driver/mobile | deliver / reportFailedAttempt | deliver / delivery-attempts | Order and persisted attempts |
| Cancellation | cancel/deleteDraft | cancel / DELETE orders/:id | Order |
| Admin | users/customers/products.save | POST/PATCH master routes | versioned record; generated password returned once |
| Stock | inventory.list | inventory/balances, movements, openings/receipts/adjustments | Ledger and balances |
| Timeline / audit | activity.list | orders/:id/activity / activity | scoped events |

Business mutations require CSRF, allowed Origin, JSON, and Idempotency-Key. Authentication mutations require CSRF, allowed Origin, and JSON. Existing UI names `status` in review decisions, `loadingNote` in assignments and `itemId` in reservations are retained and documented in generated OpenAPI. UUIDs replace demo IDs. Draft numbers are displayed as «مسودة» until submission. Master versions are added to the existing DTOs. No localStorage migration or fallback.

Replacement points: imports from services/mock/adapter in Shell, order hooks, forms/details/operational table and admin pages. Mock remains available only when explicitly enabled outside production. Auth becomes asynchronous. Backend policies are authoritative; presentation policies remain hints.

Concurrency design: shared PostgreSQL advisory transaction lock for authorization/master coordination, then order row, then inventory rows sorted by product UUID. This conservative v1 coordination serializes writes across replicas; it trades throughput for a simple provable ordering. No external calls in business transactions. Retry only PostgreSQL serialization/deadlock failures. Measure before narrowing lock scope.

Inventory source assumption: local movement ledger (opening, receipt, counted adjustment), pending owner confirmation before real balances. Runtime DB role cannot mutate/delete audit or ledger history; migration owner separate.
