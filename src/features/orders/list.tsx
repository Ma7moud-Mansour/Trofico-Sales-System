"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { services, mockEnabled } from "@/services";
import {
  Plus,
  Search,
  ArrowUpLeft,
  ClipboardList,
  Clock3,
  Truck,
  CheckCheck,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useApp, titles } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Timeline } from "@/components/shared";
import {
  statusLabels,
  outcomeLabels,
  nextOwner,
  formatDate,
  ar,
} from "@/messages/ar";
import { hasRole, needsAction } from "@/domain/policies";
import { filterOrders } from "@/domain/selectors";
import { statuses, type Order, type OrderFilters } from "@/domain/types";
import { OperationalTable, ScopeSummary } from "./operational-table";
export function OrderTable({ orders }: { orders: Order[] }) {
  return (
    <div className="order-table">
      <div className="order-table-head">
        <span>الطلب / تاريخ الإرسال</span>
        <span>العميل / المندوب</span>
        <span>الأصناف</span>
        <span>المرحلة الحالية</span>
        <span>المسؤول التالي</span>
        <span>الإجراء</span>
      </div>
      {orders.map((o) => (
        <Link className="order-row" href={`/orders/${o.id}`} key={o.id}>
          <div>
            <b className="order-number">
              <bdi>{o.orderNumber}</bdi>
            </b>
            <small>{formatDate(o.submittedAt)}</small>
          </div>
          <div>
            <strong>{o.customerSnapshot?.name ?? "عميل غير محدد"}</strong>
            <small>{o.creatorNameSnapshot}</small>
          </div>
          <div className="item-count">
            <b>{o.items.length}</b>
            <small>صنف</small>
          </div>
          <div>
            <Badge order={o} />
            {o.approvalOutcome === "FULL" && <small>اعتماد كامل</small>}
          </div>
          <div className="next-owner">
            <span>{nextOwner[o.status]}</span>
            <small>تحديث: {formatDate(o.updatedAt)}</small>
          </div>
          <span className="row-action">عرض الطلب</span>
        </Link>
      ))}
    </div>
  );
}
export function Dashboard() {
  const { data } = useApp();
  const [mode, setMode] = useState("mine"),
    [term, setTerm] = useState(""),
    [stage, setStage] = useState("");
  const { user, orders } = data;
  const tasks = orders
    .filter((o) => needsAction(user, o))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const dashboardOrders = filterOrders(
    mode === "mine" ? tasks : orders,
    {
      search: term,
      status: stage,
      sort: mode === "mine" ? "oldest" : "newest",
    },
    user,
    data.inventory,
  );
  let cards = [
    {
      label: "الطلبات المرسلة",
      value: orders.filter((o) => o.status !== "DRAFT").length,
      query: "tab=submitted",
      icon: ClipboardList,
      color: "blue",
    },
    {
      label: "بانتظار الاعتماد",
      value: orders.filter((o) => o.status === "PENDING_APPROVAL").length,
      query: "status=PENDING_APPROVAL",
      icon: Clock3,
      color: "amber",
    },
    {
      label: "قيد التوصيل",
      value: orders.filter((o) => o.status === "IN_TRANSIT").length,
      query: "status=IN_TRANSIT",
      icon: Truck,
      color: "purple",
    },
    {
      label: "تم التسليم",
      value: orders.filter((o) => o.status === "DELIVERED").length,
      query: "status=DELIVERED",
      icon: CheckCheck,
      color: "green",
    },
  ];
  if (hasRole(user, "SALES_MANAGER"))
    cards = cards.map((c, i) =>
      i === 2
        ? {
            ...c,
            label: "اعتماد جزئي",
            value: orders.filter((o) => o.approvalOutcome === "PARTIAL").length,
            query: "outcome=PARTIAL",
          }
        : i === 3
          ? {
              ...c,
              label: "مرفوض",
              value: orders.filter((o) => o.status === "REJECTED").length,
              query: "status=REJECTED",
            }
          : c,
    );
  if (hasRole(user, "WAREHOUSE_MANAGER"))
    cards = [
      {
        ...cards[0],
        label: "بانتظار التجهيز",
        query: "status=MANAGER_APPROVED",
        value: orders.filter((o) => o.status === "MANAGER_APPROVED").length,
      },
      {
        ...cards[1],
        label: "نقص مخزون",
        query: "issue=STOCK",
        value: filterOrders(orders, { issue: "STOCK" }, user, data.inventory)
          .length,
      },
      {
        ...cards[2],
        label: "جاهز للصرف",
        query: "status=WAREHOUSE_CONFIRMED",
        value: orders.filter((o) => o.status === "WAREHOUSE_CONFIRMED").length,
      },
      cards[3],
    ];
  if (hasRole(user, "LOGISTICS"))
    cards = [
      {
        ...cards[0],
        label: "جاهز للتوزيع",
        query: "status=WAREHOUSE_CONFIRMED",
        value: orders.filter((o) => o.status === "WAREHOUSE_CONFIRMED").length,
      },
      {
        ...cards[1],
        label: "بدون سائق",
        query: "status=WAREHOUSE_CONFIRMED&issue=unassigned",
        value: orders.filter(
          (o) => o.status === "WAREHOUSE_CONFIRMED" && !o.assignment,
        ).length,
      },
      cards[2],
      {
        ...cards[3],
        label: "محاولات متعثرة",
        query: "issue=DELIVERY",
        value: orders.filter((o) => o.fulfillmentIssue?.type === "DELIVERY")
          .length,
      },
    ];
  if (hasRole(user, "DRIVER")) {
    const assigned = orders.filter((o) => o.assignment?.driverId === user.id);
    cards = [
      { ...cards[0], label: "مسند إليّ", value: assigned.length, query: "" },
      {
        ...cards[1],
        label: "جاهز للخروج",
        query: "status=WAREHOUSE_CONFIRMED",
        value: assigned.filter((o) => o.status === "WAREHOUSE_CONFIRMED")
          .length,
      },
      {
        ...cards[2],
        value: assigned.filter((o) => o.status === "IN_TRANSIT").length,
      },
      {
        ...cards[3],
        label: "تم تسليمه اليوم",
        query: "status=DELIVERED&issue=today",
        value: filterOrders(assigned, { issue: "today" }, user).length,
      },
    ];
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">نظرة عامة على سير العمل</span>
          <h1>نظرة عامة</h1>
          <p>أهلًا، {user.name} · كل طلب واضح، وكل خطوة محسوبة.</p>
        </div>
        {hasRole(user, "SALES_REP") && (
          <Button asChild>
            <Link href="/orders/new">
              <Plus size={18} /> إنشاء طلب جديد
            </Link>
          </Button>
        )}
      </div>
      <div className="stats">
        {cards.map((c) => (
          <Link
            key={c.label}
            className="stat"
            href={`${hasRole(user, "DRIVER") ? "/my-deliveries" : "/orders"}?${c.query}`}
          >
            <div className="stat-top">
              <span>{c.label}</span>
              <span className={`stat-icon ${c.color}`}>
                <c.icon size={20} />
              </span>
            </div>
            <strong className="stat-value">
              {c.value.toLocaleString("ar-EG")}
            </strong>
            <div className="stat-bottom">
              <span>عرض الطلبات</span>
              <ArrowUpLeft size={16} />
            </div>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {mode === "mine"
                  ? "طلبات تحتاج مراجعتك"
                  : "متابعة جميع الطلبات"}{" "}
                <span className="count-badge">{dashboardOrders.length}</span>
              </h2>
              <p>طلبات تنتظر إجراءك، الأقدم أولًا</p>
            </div>
            <Link className="text-link" href="/orders?tab=mine">
              عرض الكل <ArrowUpLeft size={16} />
            </Link>
          </div>
          <div className="dashboard-tools">
            <div className="dashboard-mode">
              <button
                className={mode === "mine" ? "selected" : ""}
                onClick={() => setMode("mine")}
              >
                مطلوب مني
              </button>
              <button
                className={mode === "all" ? "selected" : ""}
                onClick={() => setMode("all")}
              >
                كل الطلبات
              </button>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="بحث لوحة المتابعة"
                placeholder="البحث برقم الطلب أو اسم العميل…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </label>
            <label>
              <select
                aria-label="حالة طلبات لوحة المتابعة"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                <option value="">كل الحالات</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dashboardOrders.length ? (
            <OrderTable orders={dashboardOrders.slice(0, 5)} />
          ) : (
            <Empty text="لا توجد إجراءات معلقة لديك">
              <Link href="/orders">متابعة جميع الطلبات</Link>
            </Empty>
          )}
          <div className="panel-note">
            <span className="online-dot" /> تحديث موحد بين الإدارات داخل هذه
            التجربة
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>آخر التحديثات</h2>
              <p>أحدث خطوات الفريق</p>
            </div>
            <HistoryIcon />
          </div>
          <div className="activity-preview">
            <Timeline
              events={[...data.activity]
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .slice(0, 5)
                .reverse()}
            />
          </div>
        </section>
      </div>
      <section className="panel stages-panel">
        <div>
          <h2>رحلة الطلب</h2>
          <p>رؤية مشتركة من الإرسال حتى التسليم</p>
        </div>
        <div className="stage-summary">
          {(
            [
              "PENDING_APPROVAL",
              "MANAGER_APPROVED",
              "WAREHOUSE_CONFIRMED",
              "IN_TRANSIT",
              "DELIVERED",
            ] as const
          ).map((s) => (
            <Link href={`/orders?status=${s}`} key={s}>
              <span>{statusLabels[s]}</span>
              <b>{orders.filter((o) => o.status === s).length}</b>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
function HistoryIcon() {
  return <Clock3 size={20} className="muted" />;
}
export function OrdersList() {
  const { data } = useApp(),
    path = usePathname(),
    params = useSearchParams(),
    router = useRouter();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const update = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    p.set("page", "1");
    for (const [key, value] of Object.entries(changes))
      if (value) p.set(key, value);
      else p.delete(key);
    router.push(`${path}?${p}`);
  };
  useEffect(() => {
    setSearch(params.get("search") ?? "");
  }, [params]);
  useEffect(() => {
    if (search === (params.get("search") ?? "")) return;
    const timer = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      p.set("page", "1");
      if (search) p.set("search", search);
      else p.delete("search");
      router.replace(`${path}?${p}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, params, path, router]);
  const f: OrderFilters = { ...Object.fromEntries(params), scope: path };
  const filtered = filterOrders(data.orders, f, data.user, data.inventory);
  const remote = useQuery({
    queryKey: ["orders", data.user.id, path, params.toString()],
    queryFn: () => services.orders.list(f),
    enabled: !mockEnabled,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const total = mockEnabled ? filtered.length : (remote.data?.total ?? 0);
  const size = [10, 25, 50].includes(Number(params.get("pageSize")))
    ? Number(params.get("pageSize"))
    : 10;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const displayed = mockEnabled
    ? filtered.slice((page - 1) * size, page * size)
    : (remote.data?.items ?? []);
  const filtersActive = [
    "search",
    "status",
    "outcome",
    "rep",
    "customer",
    "from",
    "to",
    "issue",
  ].some((k) => params.get(k));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">متابعة مشتركة، إجراءات حسب الدور</span>
          <h1>{titles[path]}</h1>
          <p>اعرف كل طلب عند مَن، وما الخطوة التالية.</p>
        </div>
        {hasRole(data.user, "SALES_REP") && (
          <Button asChild>
            <Link href="/orders/new">
              <Plus size={18} /> إنشاء طلب جديد
            </Link>
          </Button>
        )}
      </div>
      {["/logistics", "/my-deliveries", "/finance"].includes(path) && (
        <ScopeSummary path={path} />
      )}
      {["/logistics", "/my-deliveries", "/warehouse"].includes(path) && (
        <div className="scope-tabs">
          <button
            className={!f.status && !f.issue ? "selected" : ""}
            onClick={() => update({ status: "", issue: "" })}
          >
            الكل
          </button>
          {(path === "/warehouse"
            ? ["MANAGER_APPROVED", "WAREHOUSE_CONFIRMED"]
            : ["WAREHOUSE_CONFIRMED", "IN_TRANSIT", "DELIVERED"]
          ).map((s) => (
            <button
              key={s}
              className={f.status === s ? "selected" : ""}
              onClick={() => update({ status: s, issue: "" })}
            >
              {statusLabels[s as keyof typeof statusLabels]}
            </button>
          ))}
        </div>
      )}
      <section className="panel">
        <div className="tabs">
          <button
            className={!f.tab ? "selected" : ""}
            onClick={() => update({ tab: "" })}
          >
            كل الطلبات{" "}
            <span>
              {
                filterOrders(
                  data.orders,
                  { scope: path },
                  data.user,
                  data.inventory,
                ).length
              }
            </span>
          </button>
          <button
            className={f.tab === "mine" ? "selected" : ""}
            onClick={() => update({ tab: "mine" })}
          >
            مطلوب مني
          </button>
          {hasRole(data.user, "SALES_REP") && (
            <button
              className={f.tab === "drafts" ? "selected" : ""}
              onClick={() => update({ tab: "drafts" })}
            >
              مسوداتي
            </button>
          )}
        </div>
        <div className="filters">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="بحث الطلبات"
              placeholder={ar.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span>المرحلة</span>
            <select
              value={f.status ?? ""}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">كل المراحل</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الاعتماد</span>
            <select
              value={f.outcome ?? ""}
              onChange={(e) => update({ outcome: e.target.value })}
            >
              <option value="">كل أنواع الاعتماد</option>
              {Object.entries(outcomeLabels).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الترتيب</span>
            <select
              value={f.sort ?? (f.tab === "mine" ? "oldest" : "newest")}
              onChange={(e) => update({ sort: e.target.value })}
            >
              <option value="newest">الأحدث تحديثًا</option>
              <option value="oldest">الأقدم تحديثًا</option>
              <option value="number">رقم الطلب</option>
            </select>
          </label>
        </div>
        <details className="advanced-filters">
          <summary>
            <Filter size={15} /> فلاتر إضافية {filtersActive && "• مفعلة"}
          </summary>
          <div className="form-grid">
            <label>
              المندوب
              <select
                value={f.rep ?? ""}
                onChange={(e) => update({ rep: e.target.value })}
              >
                <option value="">الكل</option>
                {Array.from(
                  new Map(
                    data.orders.map((o) => [
                      o.createdBy,
                      { id: o.createdBy, name: o.creatorNameSnapshot },
                    ]),
                  ).values(),
                ).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              العميل
              <select
                value={f.customer ?? ""}
                onChange={(e) => update({ customer: e.target.value })}
              >
                <option value="">الكل</option>
                {Array.from(
                  new Map(
                    data.orders
                      .filter((o) => o.customerSnapshot)
                      .map((o) => [o.customerId, o.customerSnapshot!]),
                  ).values(),
                ).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              من تاريخ الإرسال
              <input
                type="date"
                value={f.from ?? ""}
                onChange={(e) => update({ from: e.target.value })}
              />
            </label>
            <label>
              إلى تاريخ الإرسال
              <input
                type="date"
                value={f.to ?? ""}
                onChange={(e) => update({ to: e.target.value })}
              />
            </label>
            <label>
              الاستثناء
              <select
                value={f.issue ?? ""}
                onChange={(e) => update({ issue: e.target.value })}
              >
                <option value="">كل الطلبات</option>
                <option value="STOCK">نقص مخزون</option>
                <option value="DELIVERY">تعثر توصيل</option>
                <option value="unassigned">دون سائق</option>
              </select>
            </label>
          </div>
        </details>
        <div className="list-summary">
          <span>
            <b>{total}</b> طلب مطابق
          </span>
          {filtersActive && (
            <button
              className="text-link"
              onClick={() => {
                setSearch("");
                router.push(path);
              }}
            >
              مسح الفلاتر
            </button>
          )}
        </div>
        {remote.error && !mockEnabled ? (
          <p role="alert" className="alert error">
            {remote.error.message}
            <Button onClick={() => remote.refetch()}>إعادة المحاولة</Button>
          </p>
        ) : !mockEnabled && remote.isPending ? (
          <p className="panel-note">جارٍ تحميل الطلبات…</p>
        ) : displayed.length ? (
          ["/logistics", "/my-deliveries", "/finance"].includes(path) ? (
            <OperationalTable
              orders={displayed}
              finance={path === "/finance"}
            />
          ) : (
            <OrderTable orders={displayed} />
          )
        ) : (
          <Empty
            text={
              filtersActive
                ? "لا توجد نتائج مطابقة للفلاتر"
                : "لا توجد طلبات في هذه القائمة"
            }
          >
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                router.push(path);
              }}
            >
              مسح الفلاتر
            </Button>
          </Empty>
        )}
        <div className="pagination">
          <label>
            عدد الصفوف
            <select
              value={size}
              onChange={(e) => update({ pageSize: e.target.value })}
            >
              {[10, 25, 50].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <span>
            صفحة {page} من {pages} · {total} طلب
          </span>
          <div className="button-row">
            <Button
              variant="outline"
              aria-label="الصفحة السابقة"
              disabled={page === 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              <ChevronRight size={16} />
            </Button>
            <Button
              variant="outline"
              aria-label="الصفحة التالية"
              disabled={page === pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              <ChevronLeft size={16} />
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
