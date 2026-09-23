import {
  DomainError,
  type User,
  type Order,
  type ViewData,
  type DomainErrorCode,
} from "@/domain/types";
import type { Services, MasterKind, MasterRecord } from "./contracts";
let csrf: string | undefined;
let authEpoch = 0;
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const epoch = authEpoch;
  try {
    if (method !== "GET" && !csrf) {
      const bootstrap = await fetch("/api/v1/auth/csrf", {
        credentials: "include",
        cache: "no-store",
      });
      if (!bootstrap.ok) throw new Error("تعذر الاتصال بالخدمة");
      csrf = (await bootstrap.json()).data.token;
    }
    const wireKey = key
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(key),
            ),
          ),
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : undefined;
    const response = await fetch("/api/v1/" + path, {
      method,
      credentials: "include",
      cache: "no-store",
      headers:
        method === "GET"
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf || "",
              ...(wireKey ? { "Idempotency-Key": wireKey } : {}),
            },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json();
    if (!response.ok) {
      if (
        response.status === 401 &&
        epoch === authEpoch &&
        path !== "auth/login" &&
        path !== "auth/me"
      )
        window.dispatchEvent(new Event("sales-session-expired"));
      if (json.error?.code === "CSRF_INVALID") csrf = undefined;
      const error = new DomainError(
        (json.error?.code || "NETWORK_ERROR") as DomainErrorCode,
        json.error?.message || "تعذر الاتصال بالخدمة",
      );
      error.fieldErrors = json.error?.fieldErrors;
      throw error;
    }
    return json.data as T;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      "NETWORK_ERROR",
      "تعذر الاتصال بخدمة المبيعات. بيانات النموذج لم تُحذف.",
    );
  }
}
export const auth = {
  me: () => request<User>("auth/me"),
  async login(username: string, password: string) {
    authEpoch++;
    const u = await request<User>("auth/login", "POST", { username, password });
    csrf = undefined;
    return u;
  },
  async logout() {
    authEpoch++;
    await request("auth/logout", "POST", {});
    csrf = undefined;
  },
  async changePassword(currentPassword: string, newPassword: string) {
    await request("auth/change-password", "POST", {
      currentPassword,
      newPassword,
    });
    csrf = undefined;
  },
};
const command = (
  id: string,
  path: string,
  input: unknown,
  meta: { expectedVersion: number; idempotencyKey: string },
) =>
  request<Order>(
    `orders/${id}/${path}`,
    "POST",
    { ...(input as object), expectedVersion: meta.expectedVersion },
    meta.idempotencyKey,
  );
const keys = new Map<string, string>();
export async function saveMaster(kind: MasterKind, r: MasterRecord) {
  const { id, version, ...fields } = r;
  delete (fields as Partial<User>).mustChangePassword;
  const body = { ...fields, ...(id ? { expectedVersion: version } : {}) };
  const signature = JSON.stringify([kind, id, body]);
  const key = keys.get(signature) || crypto.randomUUID();
  keys.set(signature, key);
  const result = await request<MasterRecord & { temporaryPassword?: string }>(
    kind + (id ? "/" + id : ""),
    id ? "PATCH" : "POST",
    body,
    key,
  );
  keys.delete(signature);
  if (result.temporaryPassword)
    window.dispatchEvent(
      new CustomEvent("sales-temporary-password", {
        detail: result.temporaryPassword,
      }),
    );
}
export const httpServices: Omit<Services, "session"> = {
  dashboard: { get: () => request<ViewData>("workspace") },
  orders: {
    list: (f) =>
      request(
        "orders?" +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries(f)
                .filter(([, v]) => v !== undefined && v !== "")
                .map(([k, v]) => [k, String(v)]),
            ),
          ).toString(),
      ),
    get: (id) => request("orders/" + id),
    saveDraft: (input, meta) => {
      const { id, ...body } = input;
      const items = body.items
        .filter((i) => i.productId)
        .map((i) => ({
          ...i,
          quantity: i.quantity.replace(/[٠-٩]/g, (c) =>
            String("٠١٢٣٤٥٦٧٨٩".indexOf(c)),
          ),
        }));
      return request(
        "orders" + (id ? "/" + id : ""),
        id ? "PATCH" : "POST",
        {
          ...body,
          items,
          ...(id ? { expectedVersion: meta.expectedVersion } : {}),
        },
        meta.idempotencyKey,
      );
    },
    submit: (id, m) => command(id, "submit", {}, m),
    recommendFinance: (id, p, m) => command(id, "finance-recommendation", p, m),
    finalizeReview: (id, p, m) => command(id, "review", p, m),
    confirmWarehouse: (id, m) => command(id, "warehouse-confirmation", {}, m),
    assignDriver: (id, p, m) => command(id, "assignment", p, m),
    dispatch: (id, m) => command(id, "dispatch", {}, m),
    deliver: (id, p, m) => command(id, "deliver", p, m),
    reportFailedAttempt: (id, p, m) =>
      command(id, "delivery-attempts", { reasonCode: "OTHER", ...p }, m),
    cancel: (id, p, m) => command(id, "cancel", p, m),
    recordStockIssue: (id, p, m) => command(id, "warehouse-notes", p, m),
    deleteDraft: (id, m) =>
      request(
        "orders/" + id,
        "DELETE",
        { expectedVersion: m.expectedVersion },
        m.idempotencyKey,
      ),
  },
  users: { save: (r) => saveMaster("users", r) },
  customers: { save: (r) => saveMaster("customers", r) },
  products: { save: (r) => saveMaster("products", r) },
  areas: { save: (r) => saveMaster("areas", r) },
  inventory: { list: () => request("inventory/balances") },
  activity: { list: () => request("activity") },
};
