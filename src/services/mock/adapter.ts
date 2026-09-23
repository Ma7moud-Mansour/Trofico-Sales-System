import {
  DomainError,
  type Database,
  type ViewData,
  type User,
  type MutationMeta,
} from "@/domain/types";
import { executeCommand, type Command } from "@/domain/commands";
import { assert, canViewOrder, hasRole } from "@/domain/policies";
import { filterOrders } from "@/domain/selectors";
import type { Services, MasterKind, MasterRecord } from "../contracts";
import { createSeed } from "./seed";
const DB_KEY = "trofico-sales-v1",
  SESSION_KEY = "trofico-session";
export const mockEnabled =
  process.env.NEXT_PUBLIC_DATA_MODE === undefined ||
  process.env.NEXT_PUBLIC_DATA_MODE === "mock";
type Failure = "network" | "conflict" | "storage" | null;
let failure: Failure = null;
const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};
function notify() {
  listeners.forEach((fn) => fn());
}
function persist(db: Database) {
  try {
    if (failure === "storage") {
      failure = null;
      throw Error();
    }
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw new DomainError(
      "STORAGE_ERROR",
      "تعذر حفظ التجربة محليًا. تحقق من مساحة التخزين ثم أعد المحاولة.",
    );
  }
  notify();
}
function read(): Database {
  assert(mockEnabled, "لم يتم ربط خدمة API بعد", "NETWORK_ERROR");
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      assert(
        parsed.schemaVersion === 1,
        "إصدار بيانات التجربة غير متوافق. استخدم إعادة الضبط.",
        "STORAGE_ERROR",
      );
      parsed.stockReceipts ??= [];
      const defaults = createSeed();
      parsed.areas ??= defaults.areas;
      for (const [index, user] of (parsed.users ?? []).entries())
        user.areaIds ??= user.roles.includes("SALES_REP")
          ? [parsed.areas[index % parsed.areas.length].id]
          : [];
      for (const [index, customer] of (parsed.customers ?? []).entries())
        customer.areaId ??= parsed.areas[index % parsed.areas.length].id;
      for (const product of parsed.products ?? []) product.unit = "عبوة";
      for (const order of parsed.orders ?? [])
        if (order.status === "PENDING_APPROVAL")
          order.status = "PENDING_FINANCE";
      return parsed;
    }
    const db = createSeed();
    persist(db);
    return db;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      "STORAGE_ERROR",
      "تعذر قراءة بيانات التجربة. أعد المحاولة أو أعد الضبط.",
    );
  }
}
function actor(db: Database) {
  const id = sessionStorage.getItem(SESSION_KEY);
  const user = db.users.find((u) => u.id === id && u.active);
  assert(user, "يرجى تسجيل الدخول بحساب نشط", "FORBIDDEN");
  return user;
}
async function delay(mutation = false) {
  await new Promise((r) => setTimeout(r, 350));
  if (!navigator.onLine)
    throw new DomainError(
      "NETWORK_ERROR",
      "أنت غير متصل. أعد الاتصال ثم حاول مجددًا.",
    );
  if (failure === "network") {
    failure = null;
    throw new DomainError(
      "NETWORK_ERROR",
      "فشل الاتصال التجريبي. أعد المحاولة؛ بيانات النموذج محفوظة.",
    );
  }
  if (mutation && failure === "conflict") {
    failure = null;
    throw new DomainError(
      "VERSION_CONFLICT",
      "تم تعديل الطلب بواسطة مستخدم آخر. أعد تحميل البيانات.",
    );
  }
}
async function transaction<T>(fn: (db: Database, u: User) => T): Promise<T> {
  const sessionActorId = actor(read()).id;
  await delay(true);
  const run = () => {
    const db = read();
    const currentActor = actor(db);
    assert(
      currentActor.id === sessionActorId,
      "تغير الحساب أثناء التنفيذ. أعد المحاولة من الحساب الحالي.",
      "FORBIDDEN",
    );
    const result = fn(db, currentActor);
    persist(db);
    return result;
  };
  return navigator.locks ? navigator.locks.request(DB_KEY, run) : run();
}
const run = (command: Command, meta: MutationMeta) =>
  transaction((db) => executeCommand(db, actor(db), command, meta));
function view(db: Database, u: User): ViewData {
  const orders = db.orders.filter((o) => canViewOrder(u, o));
  const ids = new Set(orders.map((o) => o.id));
  return {
    user: u,
    orders,
    users: db.users,
    areas:
      u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
        ? db.areas
        : u.roles.includes("SALES_REP")
          ? db.areas.filter(
              (area) => area.active && u.areaIds.includes(area.id),
            )
          : [],
    customers:
      u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
        ? db.customers
        : u.roles.includes("SALES_REP")
          ? db.customers.filter((customer) =>
              u.areaIds.includes(customer.areaId),
            )
          : [],
    products: hasRole(
      u,
      "SALES_REP",
      "FINANCE",
      "SALES_MANAGER",
      "WAREHOUSE_MANAGER",
    )
      ? db.products
      : [],
    inventory: hasRole(u, "WAREHOUSE_MANAGER", "SALES_MANAGER", "FINANCE")
      ? db.inventory
      : [],
    stockReceipts: hasRole(u, "WAREHOUSE_MANAGER", "FINANCE")
      ? db.stockReceipts
      : [],
    reservations: db.reservations.filter((r) => ids.has(r.orderId)),
    attempts: db.attempts.filter((a) => ids.has(a.orderId)),
    activity: db.activity.filter(
      (e) => hasRole(u, "SUPER_ADMIN") || (!!e.orderId && ids.has(e.orderId)),
    ),
  };
}
async function getView() {
  await delay();
  const db = read();
  return view(db, actor(db));
}
async function saveMaster(kind: MasterKind, input: MasterRecord) {
  return transaction((db, u) => {
    assert(
      kind === "users" || kind === "areas"
        ? hasRole(u, "SUPER_ADMIN")
        : hasRole(u, "FINANCE"),
      kind === "users" || kind === "areas"
        ? "هذه العملية متاحة للإدارة العليا فقط"
        : "هذه العملية متاحة للحسابات فقط",
      "FORBIDDEN",
    );
    assert(input.name.trim(), "الاسم مطلوب");
    const records = db[kind] as MasterRecord[];
    const old = records.find((r) => r.id === input.id);
    const unique =
      "username" in input
        ? "username"
        : "sku" in input
          ? "sku"
          : "code" in input
            ? "code"
            : "name";
    const value = Reflect.get(input, unique) as string;
    assert(value?.trim(), "الكود أو اسم الدخول مطلوب");
    assert(
      !records.some(
        (r) =>
          r.id !== input.id &&
          String(Reflect.get(r, unique)).toLowerCase() === value.toLowerCase(),
      ),
      "الكود أو اسم الدخول مستخدم بالفعل",
    );
    if (kind === "users" && "roles" in input) {
      assert(input.roles.length > 0, "اختر دورًا واحدًا على الأقل");
      input.areaIds ??= [];
      if (!input.roles.includes("SALES_REP")) input.areaIds = [];
      assert(
        !input.roles.includes("SALES_REP") || input.areaIds.length > 0,
        "اختر منطقة واحدة على الأقل لمندوب المبيعات",
      );
      assert(
        input.areaIds.every((id) =>
          db.areas.some((area) => area.id === id && area.active),
        ),
        "اختر مناطق نشطة وصحيحة للمندوب",
      );
      assert(input.id !== u.id || input.active, "لا يمكنك تعطيل حسابك الحالي");
      const prior = old as User | undefined;
      if (
        prior?.roles.includes("SUPER_ADMIN") &&
        (!input.active || !input.roles.includes("SUPER_ADMIN"))
      )
        assert(
          db.users.some((x) => x.id !== input.id && hasRole(x, "SUPER_ADMIN")),
          "لا يمكن تعطيل أو إزالة دور آخر مدير نظام نشط",
        );
      if (!input.active || !input.roles.includes("DRIVER"))
        assert(
          !db.orders.some(
            (o) =>
              o.status === "IN_TRANSIT" && o.assignment?.driverId === input.id,
          ),
          "السائق لديه طلب قيد التوصيل؛ أكمل الطلب أولًا",
        );
    }
    if (kind === "customers" && "areaId" in input)
      assert(
        db.areas.some(
          (area) => area.id === input.areaId && (area.active || !input.active),
        ),
        "اختر منطقة نشطة للعميل",
      );
    if (kind === "areas" && !input.active)
      assert(
        !db.customers.some(
          (customer) => customer.active && customer.areaId === input.id,
        ) &&
          !db.users.some(
            (user) =>
              user.active &&
              user.roles.includes("SALES_REP") &&
              user.areaIds.includes(input.id),
          ),
        "انقل العملاء والمندوبين من المنطقة قبل تعطيلها",
      );
    const record = {
      ...input,
      ...(kind === "products" ? { unit: "عبوة" } : {}),
      id: input.id || crypto.randomUUID(),
    };
    const index = records.findIndex((r) => r.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    if (
      kind === "products" &&
      !db.inventory.some((b) => b.productId === record.id)
    )
      db.inventory.push({
        productId: record.id,
        onHand: 0,
        reserved: 0,
        version: 1,
      });
    db.activity.push({
      id: crypto.randomUUID(),
      actorId: u.id,
      actorNameSnapshot: u.name,
      actorRole: u.roles[0],
      type: "MASTER",
      occurredAt: new Date().toISOString(),
      summary: `${old ? "تعديل" : "إضافة"} ${input.name}`,
      changes: old
        ? `${old.name} ← ${input.name} · ${input.active ? "نشط" : "معطل"}`
        : "سجل جديد",
    });
  });
}
export const services: Services = {
  session: {
    current() {
      try {
        const db = read();
        return actor(db);
      } catch {
        return null;
      }
    },
    accounts() {
      return mockEnabled ? read().users.filter((u) => u.active) : [];
    },
    login(id) {
      const user = read().users.find((u) => u.id === id && u.active);
      assert(user, "الحساب غير متاح", "FORBIDDEN");
      sessionStorage.setItem(SESSION_KEY, id);
      return user;
    },
    logout() {
      sessionStorage.removeItem(SESSION_KEY);
    },
  },
  dashboard: { get: getView },
  orders: {
    async list(f) {
      const data = await getView();
      const items = filterOrders(data.orders, f, data.user, data.inventory);
      const page = f.page ?? 1,
        pageSize = f.pageSize ?? 10;
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      };
    },
    async get(id) {
      const data = await getView();
      const o = data.orders.find((o) => o.id === id);
      if (!o) {
        const exists = read().orders.some((o) => o.id === id);
        throw new DomainError(
          exists ? "FORBIDDEN" : "NOT_FOUND",
          exists ? "ليس لديك صلاحية لعرض هذا الطلب" : "الطلب غير موجود",
        );
      }
      return o;
    },
    saveDraft: (input, meta) => run({ type: "saveDraft", input }, meta),
    submit: (id, meta) => run({ type: "submit", id }, meta),
    recommendFinance: (id, input, meta) =>
      run({ type: "recommendFinance", id, input }, meta),
    finalizeReview: (id, input, meta) =>
      run({ type: "finalizeReview", id, input }, meta),
    confirmWarehouse: (id, meta) => run({ type: "confirmWarehouse", id }, meta),
    assignDriver: (id, input, meta) =>
      run({ type: "assignDriver", id, input }, meta),
    dispatch: (id, meta) => run({ type: "dispatch", id }, meta),
    deliver: (id, input, meta) => run({ type: "deliver", id, input }, meta),
    reportFailedAttempt: (id, input, meta) =>
      run({ type: "reportFailedAttempt", id, input }, meta),
    cancel: (id, input, meta) => run({ type: "cancel", id, input }, meta),
    recordStockIssue: (id, input, meta) =>
      run({ type: "recordStockIssue", id, input }, meta),
    deleteDraft: (id, meta) => run({ type: "deleteDraft", id }, meta),
  },
  users: { save: (input) => saveMaster("users", input) },
  customers: { save: (input) => saveMaster("customers", input) },
  products: { save: (input) => saveMaster("products", input) },
  areas: { save: (input) => saveMaster("areas", input) },
  inventory: {
    async list() {
      return (await getView()).inventory;
    },
  },
  activity: {
    async list() {
      return (await getView()).activity;
    },
  },
};
export const demo = {
  failNext(mode: Failure) {
    failure = mode;
  },
  async reset() {
    if (navigator.locks)
      await navigator.locks.request(DB_KEY, () => persist(createSeed()));
    else persist(createSeed());
  },
  async stock(productId: string, amount: number) {
    await transaction((db) => {
      const b = db.inventory.find((b) => b.productId === productId);
      assert(b, "الصنف غير موجود");
      b.onHand = amount === 0 ? b.reserved : b.onHand + amount;
      b.version++;
    });
  },
};
