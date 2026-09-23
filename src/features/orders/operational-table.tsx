"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { MapPin, Package, Truck, ClipboardCheck } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Badge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { type Order } from "@/domain/types";
import { canActOnOrder } from "@/domain/policies";
import { services } from "@/services";
import { useCommand } from "./hooks";
export function OperationalTable({
  orders,
  finance = false,
}: {
  orders: Order[];
  finance?: boolean;
}) {
  const { data, toast } = useApp(),
    mutation = useCommand();
  const [selection, setSelection] = useState<{
      order: Order;
      action: "assign" | "dispatch";
    } | null>(null),
    [driver, setDriver] = useState(""),
    [date, setDate] = useState(""),
    [note, setNote] = useState("");
  const key = useRef("");
  function open(order: Order, action: "assign" | "dispatch") {
    setSelection({ order, action });
    setDriver(order.assignment?.driverId ?? "");
    setDate(order.assignment?.scheduledDate ?? "");
    setNote("");
    key.current = crypto.randomUUID();
    mutation.reset();
  }
  async function save() {
    if (!selection) return;
    const { order, action } = selection;
    await mutation
      .mutateAsync(() =>
        action === "assign"
          ? services.orders.assignDriver(
              order.id,
              { driverId: driver, scheduledDate: date, loadingNote: note },
              { expectedVersion: order.version, idempotencyKey: key.current },
            )
          : services.orders.dispatch(order.id, {
              expectedVersion: order.version,
              idempotencyKey: key.current,
            }),
      )
      .then(() => {
        setSelection(null);
        toast(
          action === "assign"
            ? "تم حفظ تعيين السائق"
            : "بدأ التوصيل وصُرفت الكميات المحجوزة",
        );
      })
      .catch(() => {});
  }
  function action(o: Order) {
    if (!finance && canActOnOrder(data.user, o, "assign") && !o.assignment)
      return <Button onClick={() => open(o, "assign")}>تعيين سائق</Button>;
    if (!finance && canActOnOrder(data.user, o, "dispatch") && o.assignment)
      return <Button onClick={() => open(o, "dispatch")}>بدء التوصيل</Button>;
    return (
      <Button asChild variant="outline">
        <Link href={`/orders/${o.id}`}>عرض التفاصيل</Link>
      </Button>
    );
  }
  return (
    <>
      <div className="table-scroll delivery-table-wrap">
        <table className="logistics-table">
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>العميل</th>
              {finance ? (
                <>
                  <th>مندوب المبيعات</th>
                  <th>المطلوبة</th>
                  <th>المعتمدة</th>
                </>
              ) : (
                <>
                  <th>العنوان</th>
                  <th>السائق</th>
                </>
              )}
              <th>الحالة</th>
              <th>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>
                    <bdi>{o.orderNumber}</bdi>
                  </Link>
                </td>
                <td>
                  <strong>{o.customerSnapshot?.name}</strong>
                </td>
                {finance ? (
                  <>
                    <td>{o.creatorNameSnapshot}</td>
                    <td>
                      {o.items.reduce((n, i) => n + i.requestedQuantity, 0)}
                    </td>
                    <td>
                      {o.items.reduce(
                        (n, i) => n + (i.approvedQuantity ?? 0),
                        0,
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td>{o.deliveryAddress}</td>
                    <td>{o.assignment?.driverNameSnapshot ?? "لم يُعين"}</td>
                  </>
                )}
                <td>
                  <Badge order={o} />
                </td>
                <td>
                  {action(o)}
                  {!finance &&
                    canActOnOrder(data.user, o, "assign") &&
                    o.assignment && (
                      <button
                        className="text-link"
                        onClick={() => open(o, "assign")}
                      >
                        تغيير السائق
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="delivery-cards">
        {orders.map((o) => (
          <article className="delivery-card" key={o.id}>
            <header>
              <bdi>{o.orderNumber}</bdi>
              <Badge order={o} />
            </header>
            <h3>{o.customerSnapshot?.name}</h3>
            <p>
              <MapPin size={15} />
              {o.deliveryAddress}
            </p>
            <p>
              <Package size={15} />
              {o.items
                .filter((i) => i.approvalStatus === "APPROVED")
                .reduce((n, i) => n + (i.approvedQuantity ?? 0), 0)}{" "}
              عبوة معتمدة
            </p>
            {o.assignment && (
              <p>
                <Truck size={15} />
                {o.assignment.driverNameSnapshot}
              </p>
            )}
            {action(o)}
          </article>
        ))}
      </div>
      <Dialog
        variant={selection?.action === "assign" ? "drawer" : "dialog"}
        open={!!selection}
        onOpenChange={(v) => !v && setSelection(null)}
        title={selection?.action === "assign" ? "تعيين سائق" : "بدء التوصيل"}
        description={selection?.order.orderNumber}
      >
        <div className="form-stack">
          {selection?.action === "assign" ? (
            <>
              <label>
                السائق المحدد
                <select
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                >
                  <option value="">اختر السائق</option>
                  {data.users
                    .filter((u) => u.active && u.roles.includes("DRIVER"))
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                تاريخ التوصيل المخطط له
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                ملاحظات التحميل (اختياري)
                <textarea
                  rows={5}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <small>{note.length}/500</small>
              </label>
            </>
          ) : (
            <div className="alert info">
              <Truck size={22} /> تأكيد خروج كل الأصناف المعتمدة مع{" "}
              {selection?.order.assignment?.driverNameSnapshot}.
            </div>
          )}
          {mutation.error && (
            <div className="alert error" role="alert">
              {mutation.error.message}
            </div>
          )}
          <Button
            disabled={
              mutation.isPending ||
              !navigator.onLine ||
              (selection?.action === "assign" && !driver)
            }
            onClick={save}
          >
            {mutation.isPending
              ? "جارٍ الحفظ…"
              : selection?.action === "assign"
                ? "حفظ التعيين"
                : "تأكيد الخروج"}
          </Button>
          <Button variant="outline" onClick={() => setSelection(null)}>
            إلغاء
          </Button>
        </div>
      </Dialog>
    </>
  );
}
export function ScopeSummary({ path }: { path: string }) {
  const { data } = useApp();
  const orders = data.orders.filter(
    (o) => path !== "/my-deliveries" || o.assignment?.driverId === data.user.id,
  );
  const finance = path === "/finance";
  const cards = finance
    ? [
        [
          "بانتظار توصية الحسابات",
          orders.filter((o) => o.status === "PENDING_FINANCE").length,
          "blue",
          "status=PENDING_FINANCE",
        ],
        [
          "أوصت بالموافقة",
          orders.filter((o) => o.financeRecommendation === "APPROVE").length,
          "green",
          "",
        ],
        [
          "أوصت بعدم الموافقة",
          orders.filter((o) => o.financeRecommendation === "REJECT").length,
          "amber",
          "",
        ],
      ]
    : [
        [
          "جاهز للتوزيع",
          orders.filter((o) => o.status === "WAREHOUSE_CONFIRMED").length,
          "green",
          "status=WAREHOUSE_CONFIRMED",
        ],
        [
          "قيد التوصيل",
          orders.filter((o) => o.status === "IN_TRANSIT").length,
          "amber",
          "status=IN_TRANSIT",
        ],
        [
          "تعذر التسليم",
          orders.filter((o) => o.fulfillmentIssue?.type === "DELIVERY").length,
          "purple",
          "issue=DELIVERY",
        ],
      ];
  return (
    <>
      {finance && (
        <p className="readonly-note">
          <ClipboardCheck size={15} /> راجع الطلب وسجّل توصية الحسابات؛ القرار
          النهائي للمدير التجاري
        </p>
      )}
      <div className="stats scope-stats">
        {cards.map(([label, value, color, query]) => (
          <Link key={label} className="stat" href={`${path}?${query}`}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${color}`}>
                <Package size={23} />
              </span>
            </div>
            <strong className="stat-value">{value}</strong>
          </Link>
        ))}
      </div>
    </>
  );
}
