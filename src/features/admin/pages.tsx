"use client";
import { useState, useRef } from "react";
import { Plus, Search, UserRound, Boxes, MapPin } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Empty } from "@/components/shared";
import {
  permissions,
  roles,
  type Permission,
  type Role,
  type User,
  type Product,
  type Customer,
  type Area,
} from "@/domain/types";
import { roleLabels, formatDate, eventLabels, cairoDay } from "@/messages/ar";
import { services, mockEnabled } from "@/services";
import { request } from "@/services/http";
import { StockOperations } from "./stock-operations";
import { PasswordForm } from "@/components/auth-forms";
import { useCommand } from "@/features/orders/hooks";
import type { MasterKind, MasterRecord } from "@/services/contracts";
const kindNames = {
  users: "المستخدمون",
  customers: "العملاء",
  products: "المنتجات",
  areas: "المناطق",
};
const permissionLabels: Record<Permission, string> = {
  ORDERS_VIEW: "عرض الطلبات",
  ORDERS_CREATE: "إنشاء الطلبات وإدارة المسودات",
  FINANCE_RECOMMEND: "تسجيل توصية الحسابات",
  MANAGER_DECIDE: "اتخاذ قرار الاعتماد النهائي",
  WAREHOUSE_PREPARE: "تجهيز الطلب وتعيين السائق وخروجه",
  LOGISTICS_VIEW: "متابعة الحركة والتوصيل",
  DELIVERY_CONFIRM: "تأكيد التسليم أو تعذره",
  INVENTORY_VIEW: "عرض أرصدة المخزون",
  INVENTORY_RECEIVE: "تسجيل الوارد إلى المخزن",
  RECEIPTS_APPROVE: "اعتماد أو رفض الوارد",
  CUSTOMERS_MANAGE: "إضافة العملاء وتعديلهم",
  PRODUCTS_MANAGE: "تكويد المنتجات وتعديلها",
  STOCK_ADJUST: "تسوية وافتتاح أرصدة المخزون",
  USERS_MANAGE: "إدارة المستخدمين وأدوارهم",
  AREAS_MANAGE: "إدارة المناطق",
  ACTIVITY_VIEW: "عرض سجل كل العمليات",
};
const orderActionPermissions: Permission[] = [
  "ORDERS_CREATE",
  "FINANCE_RECOMMEND",
  "MANAGER_DECIDE",
  "WAREHOUSE_PREPARE",
  "LOGISTICS_VIEW",
  "DELIVERY_CONFIRM",
];
const inventoryActionPermissions: Permission[] = [
  "INVENTORY_RECEIVE",
  "RECEIPTS_APPROVE",
  "STOCK_ADJUST",
];
export function MasterPage({ kind }: { kind: MasterKind }) {
  const { data, toast } = useApp(),
    mutation = useCommand(),
    permissionMutation = useCommand();
  const [search, setSearch] = useState(""),
    [active, setActive] = useState(""),
    [record, setRecord] = useState<MasterRecord | null>(null);
  const [permissionRole, setPermissionRole] = useState<Role>("SALES_MANAGER");
  const [permissionDraft, setPermissionDraft] = useState<Permission[] | null>(
    null,
  );
  const [resetUser, setResetUser] = useState<User | null>(null);
  const resetKey = useRef({ signature: "", key: "" });
  const records = data[kind].filter(
    (r) =>
      (
        r.name +
        " " +
        ("username" in r
          ? r.username
          : "sku" in r
            ? r.sku
            : "code" in r
              ? r.code
              : r.name)
      ).includes(search) &&
      (!active || (active === "active") === r.active),
  );
  function create() {
    setRecord(
      kind === "users"
        ? {
            id: "",
            name: "",
            username: "",
            roles: ["SALES_REP"],
            permissions: [],
            areaIds: data.areas
              .filter((area) => area.active)
              .slice(0, 1)
              .map((area) => area.id),
            active: true,
          }
        : kind === "products"
          ? { id: "", name: "", sku: "", unit: "عبوة", active: true }
          : kind === "customers"
            ? {
                id: "",
                name: "",
                code: "",
                phone: "",
                defaultAddress: "",
                areaId: data.areas.find((area) => area.active)?.id ?? "",
                active: true,
              }
            : { id: "", name: "", active: true },
    );
    mutation.reset();
  }
  async function save() {
    if (!record) return;
    await mutation
      .mutateAsync(() =>
        kind === "users"
          ? services.users.save(record as User)
          : kind === "products"
            ? services.products.save(record as Product)
            : kind === "customers"
              ? services.customers.save(record as Customer)
              : services.areas.save(record as Area),
      )
      .then(() => {
        setRecord(null);
        toast("تم حفظ البيانات الأساسية");
      })
      .catch(() => {});
  }
  const selectedPermissionSet = data.rolePermissions.find(
    (set) => set.role === permissionRole,
  );
  const selectedPermissions =
    permissionRole === "SUPER_ADMIN"
      ? [...permissions]
      : (permissionDraft ?? selectedPermissionSet?.permissions ?? []);
  function togglePermission(permission: Permission, checked: boolean) {
    let next = checked
      ? [...new Set([...selectedPermissions, permission])]
      : selectedPermissions.filter((item) => item !== permission);
    if (checked && orderActionPermissions.includes(permission))
      next = [...new Set([...next, "ORDERS_VIEW" as Permission])];
    if (checked && inventoryActionPermissions.includes(permission))
      next = [...new Set([...next, "INVENTORY_VIEW" as Permission])];
    if (!checked && permission === "ORDERS_VIEW")
      next = next.filter((item) => !orderActionPermissions.includes(item));
    if (!checked && permission === "INVENTORY_VIEW")
      next = next.filter((item) => !inventoryActionPermissions.includes(item));
    setPermissionDraft(next);
  }
  async function savePermissions() {
    if (!selectedPermissionSet || permissionRole === "SUPER_ADMIN") return;
    try {
      await permissionMutation.mutateAsync(() =>
        services.permissions.save(
          permissionRole,
          selectedPermissions,
          selectedPermissionSet.version,
        ),
      );
      setPermissionDraft(null);
      toast(`تم حفظ صلاحيات دور ${roleLabels[permissionRole]}`);
    } catch {}
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">إدارة البيانات الأساسية</span>
          <h1>{kindNames[kind]}</h1>
          <p>إضافة وتحديث وتعطيل السجلات مع الحفاظ على تاريخ الطلبات.</p>
        </div>
        <Button onClick={create}>
          <Plus size={18} /> إضافة سجل
        </Button>
      </div>
      <section className="panel">
        <div className="filters">
          <label className="search-field">
            <Search size={18} />
            <input
              placeholder="البحث بالاسم أو الكود"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            الحالة
            <select value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="">الكل</option>
              <option value="active">نشط</option>
              <option value="inactive">معطل</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>{kind === "areas" ? "النطاق" : "الكود / اسم الدخول"}</th>
                <th>
                  {kind === "users"
                    ? "الأدوار"
                    : kind === "products"
                      ? "الوحدة"
                      : kind === "customers"
                        ? "التواصل والمنطقة"
                        : "العملاء والمندوبون"}
                </th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>
                    <bdi>
                      {kind === "users"
                        ? (r as User).username
                        : kind === "products"
                          ? (r as Product).sku
                          : kind === "customers"
                            ? (r as Customer).code
                            : "—"}
                    </bdi>
                  </td>
                  <td>
                    {kind === "users" ? (
                      <>
                        {(r as User).roles
                          .map((role) => roleLabels[role])
                          .join("، ")}
                        {(r as User).roles.includes("SALES_REP") && (
                          <small>
                            <MapPin size={13} />{" "}
                            {(r as User).areaIds
                              .map(
                                (areaId) =>
                                  data.areas.find((area) => area.id === areaId)
                                    ?.name,
                              )
                              .filter(Boolean)
                              .join("، ") || "لا توجد مناطق"}
                          </small>
                        )}
                      </>
                    ) : kind === "products" ? (
                      (r as Product).unit
                    ) : kind === "customers" ? (
                      <>
                        <bdi>{(r as Customer).phone}</bdi>
                        <small>
                          {data.areas.find(
                            (area) => area.id === (r as Customer).areaId,
                          )?.name ?? "منطقة غير معروفة"}
                          {" · "}
                          {(r as Customer).defaultAddress}
                        </small>
                      </>
                    ) : (
                      <>
                        {
                          data.customers.filter(
                            (customer) => customer.areaId === r.id,
                          ).length
                        }{" "}
                        عميل
                        <small>
                          {
                            data.users.filter((user) =>
                              user.areaIds.includes(r.id),
                            ).length
                          }{" "}
                          مندوب
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.active ? "status-DELIVERED" : "status-CANCELLED"}`}
                    >
                      {r.active ? "نشط" : "معطل"}
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRecord(structuredClone(r));
                        mutation.reset();
                      }}
                    >
                      تعديل
                    </Button>
                    {kind === "users" && !mockEnabled && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          mutation.reset();
                          setResetUser(r as User);
                        }}
                      >
                        إعادة ضبط كلمة المرور
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!records.length && <Empty />}
        <div className="panel-note">
          {records.length} سجل · يُستخدم التعطيل للحفاظ على السجلات التاريخية
        </div>
      </section>
      <Dialog
        open={!!resetUser}
        onOpenChange={() => setResetUser(null)}
        title="إعادة ضبط كلمة المرور"
      >
        <p>ستُلغى جلسات المستخدم ويُطلب منه تغيير كلمة المرور الجديدة.</p>
        {mutation.error && (
          <p className="alert error">{mutation.error.message}</p>
        )}
        <Button
          disabled={mutation.isPending}
          onClick={async () => {
            if (!resetUser) return;
            const signature = resetUser.id + ":" + resetUser.version;
            if (resetKey.current.signature !== signature)
              resetKey.current = { signature, key: crypto.randomUUID() };
            try {
              const r = await mutation.mutateAsync(() =>
                request<{ temporaryPassword?: string }>(
                  "users/" + resetUser.id + "/reset-password",
                  "POST",
                  { expectedVersion: resetUser.version },
                  resetKey.current.key,
                ),
              );
              setResetUser(null);
              if ((r as { temporaryPassword?: string }).temporaryPassword)
                window.dispatchEvent(
                  new CustomEvent("sales-temporary-password", {
                    detail: (r as { temporaryPassword: string })
                      .temporaryPassword,
                  }),
                );
            } catch {}
          }}
        >
          تأكيد إعادة الضبط
        </Button>
      </Dialog>
      {kind === "products" && (
        <section className="panel padded permission-panel">
          <h2>أرصدة المخزون</h2>
          <p className="muted">الكميات الفعلية والمحجوزة والمتاحة</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الفعلي</th>
                  <th>المحجوز</th>
                  <th>المتاح</th>
                </tr>
              </thead>
              <tbody>
                {data.inventory.map((b) => (
                  <tr key={b.productId}>
                    <td>
                      {data.products.find((p) => p.id === b.productId)?.name}
                    </td>
                    <td>{b.onHand}</td>
                    <td>{b.reserved}</td>
                    <td>{b.onHand - b.reserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {kind === "users" && data.user.roles.includes("SUPER_ADMIN") && (
        <section className="panel padded permission-panel">
          <h2>تعديل صلاحيات الأدوار</h2>
          <p className="muted">
            اختر دورًا وحدد ما يستطيع مستخدموه تنفيذه. يطبق التغيير على كل
            حسابات الدور فورًا.
          </p>
          <label>
            الدور
            <select
              value={permissionRole}
              onChange={(e) => {
                setPermissionRole(e.target.value as Role);
                setPermissionDraft(null);
                permissionMutation.reset();
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="permission-grid">
            {permissions.map((permission) => (
              <label
                key={permission}
                className={
                  selectedPermissions.includes(permission)
                    ? "allowed"
                    : "blocked"
                }
              >
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(permission)}
                  disabled={permissionRole === "SUPER_ADMIN"}
                  onChange={(event) =>
                    togglePermission(permission, event.target.checked)
                  }
                />
                <span>{permissionLabels[permission]}</span>
              </label>
            ))}
          </div>
          {permissionRole === "SUPER_ADMIN" ? (
            <div className="alert info">
              صلاحيات الإدارة العليا كاملة وثابتة لحماية حساب د. محمد صبري.
            </div>
          ) : (
            <div className="form-actions">
              <Button
                disabled={
                  permissionMutation.isPending ||
                  !selectedPermissionSet ||
                  permissionDraft === null
                }
                onClick={savePermissions}
              >
                {permissionMutation.isPending
                  ? "جارٍ حفظ الصلاحيات…"
                  : "حفظ صلاحيات الدور"}
              </Button>
              {permissionDraft !== null && (
                <Button
                  variant="outline"
                  onClick={() => setPermissionDraft(null)}
                >
                  إلغاء التعديلات
                </Button>
              )}
            </div>
          )}
          {permissionMutation.error && (
            <div role="alert" className="alert error">
              {permissionMutation.error.message}
            </div>
          )}
        </section>
      )}
      <Dialog
        variant="drawer"
        open={!!record}
        onOpenChange={(v) => !v && setRecord(null)}
        title={`${record?.id ? "تعديل" : "إضافة"} · ${kindNames[kind]}`}
      >
        {record && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              الاسم *
              <input
                required
                value={record.name}
                onChange={(e) => setRecord({ ...record, name: e.target.value })}
              />
            </label>
            {"username" in record && (
              <>
                <label>
                  اسم الدخول *
                  <input
                    required
                    dir="ltr"
                    value={record.username}
                    onChange={(e) =>
                      setRecord({ ...record, username: e.target.value })
                    }
                  />
                </label>
                <fieldset className="roles">
                  <legend>الأدوار *</legend>
                  {roles.map((r) => (
                    <label key={r}>
                      <input
                        type="checkbox"
                        checked={record.roles.includes(r)}
                        onChange={(e) =>
                          setRecord({
                            ...record,
                            roles: e.target.checked
                              ? [...record.roles, r]
                              : record.roles.filter((role) => role !== r),
                            areaIds:
                              r === "SALES_REP"
                                ? e.target.checked
                                  ? record.areaIds.length
                                    ? record.areaIds
                                    : data.areas
                                        .filter((area) => area.active)
                                        .slice(0, 1)
                                        .map((area) => area.id)
                                  : []
                                : record.areaIds,
                          })
                        }
                      />
                      {roleLabels[r]}
                    </label>
                  ))}
                </fieldset>
                {record.roles.includes("SUPER_ADMIN") && (
                  <div className="alert info">
                    مدير النظام يمتلك جميع الصلاحيات تلقائيًا، ويمكنه تعديل
                    المستخدمين والمناطق وسجل العمليات.
                  </div>
                )}
                {record.roles.includes("SALES_REP") && (
                  <fieldset className="roles">
                    <legend>مناطق المندوب *</legend>
                    {data.areas
                      .filter(
                        (area) =>
                          area.active || record.areaIds.includes(area.id),
                      )
                      .map((area) => (
                        <label key={area.id}>
                          <input
                            type="checkbox"
                            checked={record.areaIds.includes(area.id)}
                            onChange={(event) =>
                              setRecord({
                                ...record,
                                areaIds: event.target.checked
                                  ? [...record.areaIds, area.id]
                                  : record.areaIds.filter(
                                      (id) => id !== area.id,
                                    ),
                              })
                            }
                          />
                          {area.name}
                        </label>
                      ))}
                  </fieldset>
                )}
              </>
            )}
            {"sku" in record && (
              <>
                <label>
                  SKU *
                  <input
                    required
                    dir="ltr"
                    value={record.sku}
                    onChange={(e) =>
                      setRecord({ ...record, sku: e.target.value })
                    }
                  />
                </label>
                <label>
                  الوحدة
                  <input value={record.unit} readOnly />
                </label>
              </>
            )}
            {"code" in record && (
              <>
                <label>
                  كود العميل *
                  <input
                    required
                    dir="ltr"
                    value={record.code}
                    onChange={(e) =>
                      setRecord({ ...record, code: e.target.value })
                    }
                  />
                </label>
                <label>
                  المنطقة *
                  <select
                    required
                    value={record.areaId}
                    onChange={(e) =>
                      setRecord({ ...record, areaId: e.target.value })
                    }
                  >
                    <option value="">اختر المنطقة</option>
                    {data.areas
                      .filter(
                        (area) => area.active || area.id === record.areaId,
                      )
                      .map((area) => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  الهاتف
                  <input
                    dir="ltr"
                    value={record.phone}
                    onChange={(e) =>
                      setRecord({ ...record, phone: e.target.value })
                    }
                  />
                </label>
                <label>
                  العنوان الافتراضي
                  <textarea
                    value={record.defaultAddress}
                    onChange={(e) =>
                      setRecord({ ...record, defaultAddress: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={record.active}
                onChange={(e) =>
                  setRecord({ ...record, active: e.target.checked })
                }
              />{" "}
              {kind === "users"
                ? "الحساب نشط (إلغاء التحديد يعطّل الحساب مع حفظ سجله)"
                : "سجل نشط"}
            </label>
            {mutation.error && (
              <div role="alert" className="alert error">
                {mutation.error.message}
              </div>
            )}
            <Button
              disabled={mutation.isPending || !navigator.onLine}
              type="submit"
            >
              {mutation.isPending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
export function InventoryPage() {
  const { data } = useApp();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("");
  const products = new Map(
    data.orders.flatMap((o) =>
      o.items.map((i) => [i.productId, i.productSnapshot] as const),
    ),
  );
  data.products.forEach((p) => products.set(p.id, p));
  const rows = data.inventory.filter((b) => {
    const p = products.get(b.productId);
    return (
      (!search || [p?.name, p?.sku].join(" ").includes(search)) &&
      (!filter ||
        (filter === "available"
          ? b.onHand - b.reserved > 0
          : b.onHand - b.reserved === 0))
    );
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">المخزن الرئيسي / مخزن واحد</span>
          <h1>أرصدة المخزون</h1>
          <p>المتاح = الرصيد الفعلي − الكميات المحجوزة.</p>
        </div>
        <span className="badge partial">
          <Boxes size={16} /> أرصدة وحركات مخزون
        </span>
      </div>
      {!mockEnabled && <StockOperations />}
      <section className="panel">
        <div className="filters">
          <label className="search-field">
            <Search size={18} />
            <input
              placeholder="بحث بالصنف أو SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            التوفر
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">كل الأرصدة</option>
              <option value="available">متاح</option>
              <option value="empty">نفد المخزون</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>SKU</th>
                <th>الوحدة</th>
                <th>الفعلي</th>
                <th>المحجوز</th>
                <th>المتاح</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.productId}>
                  <td>
                    <strong>{products.get(b.productId)?.name}</strong>
                  </td>
                  <td>
                    <bdi>{products.get(b.productId)?.sku}</bdi>
                  </td>
                  <td>{products.get(b.productId)?.unit}</td>
                  <td>{b.onHand}</td>
                  <td>{b.reserved}</td>
                  <td>
                    <span
                      className={`badge ${b.onHand - b.reserved ? "status-DELIVERED" : "status-REJECTED"}`}
                    >
                      {b.onHand - b.reserved}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty />}
        <div className="panel-note">
          الحجز عند تأكيد المخزن، والصرف عند الخروج؛ التسليم لا يخصم مرة ثانية.
        </div>
      </section>
    </>
  );
}
export function ActivityPage() {
  const { data } = useApp();
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const event = data.activity.find((e) => e.id === selectedEvent);
  const [search, setSearch] = useState(""),
    [actor, setActor] = useState(""),
    [type, setType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const rows = data.activity
    .filter((e) => {
      const number =
        data.orders.find((o) => o.id === e.orderId)?.orderNumber ?? "";
      return (
        (!search || (number + e.summary).includes(search)) &&
        (!actor || e.actorId === actor) &&
        (!type || e.type === type) &&
        (!from || cairoDay(e.occurredAt) >= from) &&
        (!to || cairoDay(e.occurredAt) <= to)
      );
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const pageCount = Math.max(1, Math.ceil(rows.length / 20));
  const current = Math.min(page, pageCount);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">الرقابة والمتابعة</span>
          <h1>سجل العمليات</h1>
          <p>
            {mockEnabled
              ? "سجل محاكاة محلي قابل لإعادة الضبط."
              : "سجل تدقيق لجميع إجراءات الحسابات والمستخدمين مع المنفذ والوقت والتغييرات."}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="filters">
          <label>
            بحث بالطلب أو الحدث
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            المنفذ
            <select
              value={actor}
              onChange={(e) => {
                setActor(e.target.value);
                setPage(1);
              }}
            >
              <option value="">الكل</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            نوع الحدث
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">الكل</option>
              {Object.entries(eventLabels).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            من
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            إلى
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الحدث / التفاصيل</th>
                <th>المنفذ</th>
                <th>الطلب</th>
                <th>الوقت</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * 20, current * 20).map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.summary}</strong>
                    {e.changes && <small>{e.changes}</small>}
                  </td>
                  <td>
                    {e.actorNameSnapshot}
                    <small>{roleLabels[e.actorRole]}</small>
                  </td>
                  <td>
                    {e.orderId ? (
                      <a href={`/orders/${e.orderId}`}>
                        <bdi>
                          {data.orders.find((o) => o.id === e.orderId)
                            ?.orderNumber ?? "مسودة محذوفة"}
                        </bdi>
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{formatDate(e.occurredAt)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedEvent(e.id)}
                    >
                      عرض التفاصيل
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty />}
        <div className="pagination">
          <span>
            {rows.length} حدث · صفحة {current} من {pageCount}
          </span>
          <div className="button-row">
            <Button
              variant="outline"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              السابق
            </Button>
            <Button
              variant="outline"
              disabled={current === pageCount}
              onClick={() => setPage(current + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      </section>
      <Dialog
        open={!!event}
        onOpenChange={(v) => !v && setSelectedEvent(null)}
        title="تفاصيل العملية"
        description={
          event ? (eventLabels[event.type] ?? event.type) : undefined
        }
      >
        {event && (
          <div className="form-stack">
            <dl>
              <dt>الطلب</dt>
              <dd>
                <bdi>
                  {data.orders.find((o) => o.id === event.orderId)
                    ?.orderNumber ?? "بيانات أساسية"}
                </bdi>
              </dd>
              <dt>المستخدم</dt>
              <dd>
                {event.actorNameSnapshot} · {roleLabels[event.actorRole]}
              </dd>
              <dt>الوقت</dt>
              <dd>{formatDate(event.occurredAt)}</dd>
            </dl>
            <div className="activity-detail">
              <strong>{event.summary}</strong>
              {event.changes && <p>{event.changes}</p>}
            </div>
            <Button variant="outline" onClick={() => setSelectedEvent(null)}>
              إغلاق التفاصيل
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
export function ProfilePage() {
  const { data } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">حسابي</span>
          <h1>الملف الشخصي</h1>
          <p>بيانات حسابك وصلاحياتك في النظام.</p>
        </div>
      </div>
      <section className="panel padded profile">
        <div className="profile-avatar">
          <UserRound size={35} />
        </div>
        <h2>{data.user.name}</h2>
        <p>
          <bdi>{data.user.username}</bdi>
        </p>
        <div className="button-row">
          {data.user.roles.map((r) => (
            <span className="badge partial" key={r}>
              {roleLabels[r]}
            </span>
          ))}
        </div>
        <div className="alert info">
          لتعديل بيانات الحساب تواصل مع مدير النظام.
        </div>
      </section>
      {!mockEnabled && (
        <PasswordForm
          onDone={() =>
            window.dispatchEvent(new Event("sales-session-expired"))
          }
        />
      )}
    </>
  );
}
