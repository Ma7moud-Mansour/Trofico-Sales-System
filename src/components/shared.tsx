"use client";
import {
  Check,
  Clock3,
  AlertCircle,
  Package,
  Truck,
  Send,
  ShieldCheck,
} from "lucide-react";
import type { Order, ActivityEvent } from "@/domain/types";
import {
  statusLabels,
  outcomeLabels,
  formatDate,
  roleLabels,
} from "@/messages/ar";
export function Badge({ order }: { order: Order }) {
  return (
    <span className="badges">
      <span className={`badge status-${order.status}`}>
        <span className="dot" />
        {statusLabels[order.status]}
      </span>
      {order.approvalOutcome === "PARTIAL" && (
        <span className="badge partial">{outcomeLabels.PARTIAL}</span>
      )}
      {order.fulfillmentIssue && (
        <span className="badge issue">
          <AlertCircle size={13} />
          {order.fulfillmentIssue.type === "STOCK"
            ? "نقص مخزون"
            : "تعثر التسليم"}
        </span>
      )}
    </span>
  );
}
export function Empty({
  text = "لا توجد نتائج مطابقة",
  children,
}: {
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Package size={36} />
      <h3>{text}</h3>
      <p>ستظهر البيانات هنا بمجرد توفرها.</p>
      {children}
    </div>
  );
}
export function Timeline({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="timeline">
      {[...events]
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((e) => (
          <li key={e.id}>
            <span className="timeline-dot">
              <Check size={12} />
            </span>
            <div>
              <strong>{e.summary}</strong>
              <p>
                {e.actorNameSnapshot} · {roleLabels[e.actorRole]}
              </p>
              <small>{formatDate(e.occurredAt)}</small>
              {e.changes && <p>{e.changes}</p>}
            </div>
          </li>
        ))}
    </ol>
  );
}
export function Stepper({
  order,
  events,
}: {
  order: Order;
  events: ActivityEvent[];
}) {
  const steps = [
    ["SUBMIT", "إرسال الطلب", Send],
    ["REVIEW", "اعتماد الإدارة", ShieldCheck],
    ["WAREHOUSE", "تأكيد المخزن", Package],
    ["DISPATCH", "الخروج للتوصيل", Truck],
    ["DELIVER", "التسليم", Check],
  ] as const;
  const terminal = ["REJECTED", "CANCELLED"].includes(order.status);
  const current = steps.findIndex(
    ([type]) => !events.some((e) => e.type === type),
  );
  return (
    <div className="stepper">
      {steps.map(([type, title, Icon], i) => {
        const e = events.find((e) => e.type === type);
        const done = !!e;
        return (
          <div
            className={`step ${done ? "done" : !terminal && i === current ? "current" : ""}`}
            key={type}
          >
            <span className="step-icon">
              {done ? <Check size={18} /> : <Icon size={18} />}
            </span>
            <strong>{title}</strong>
            <small>
              {done
                ? e.actorNameSnapshot
                : terminal
                  ? "لم تنفذ"
                  : i === current
                    ? "الخطوة الحالية"
                    : "بانتظار المرحلة السابقة"}
            </small>
            {e && <small>{formatDate(e.occurredAt)}</small>}
          </div>
        );
      })}
    </div>
  );
}
export function Loading() {
  return (
    <div aria-busy="true" aria-label="جارٍ تحميل البيانات">
      <div className="skeleton heading-skeleton" />
      <div className="stats">
        {[1, 2, 3, 4].map((x) => (
          <div key={x} className="skeleton stat" />
        ))}
      </div>
      <div className="skeleton table-skeleton" />
    </div>
  );
}
export function Waiting() {
  return (
    <span className="muted">
      <Clock3 size={15} /> بانتظار إجراء الجهة المسؤولة
    </span>
  );
}
