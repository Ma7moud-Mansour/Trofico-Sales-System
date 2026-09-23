"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Printer,
  Copy,
  Check,
  Truck,
  ShieldCheck,
  MapPin,
  Phone,
  Package,
  AlertTriangle,
  Send,
} from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Badge, Stepper, Timeline, Waiting } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { can, canActOnOrder, shortages } from "@/domain/policies";
import { type Order, type ReviewInput } from "@/domain/types";
import {
  decisionLabels,
  nextOwner,
  formatDate,
  outcomeLabels,
} from "@/messages/ar";
import { services } from "@/services";
import { useCommand } from "./hooks";
import { useUnsaved } from "@/lib/use-unsaved";
export function OrderDetail({ id }: { id: string }) {
  const { data } = useApp();
  const order = data.orders.find((o) => o.id === id);
  const missing = useQuery({
    queryKey: ["order", data.user.id, id],
    queryFn: () => services.orders.get(id),
    enabled: !order,
    retry: false,
  });
  if (!order)
    return (
      <div className="panel empty">
        <h1>{missing.error?.message ?? "جارٍ التحقق من الطلب…"}</h1>
        <p>راجع رقم الطلب وصلاحية الوصول.</p>
        <Link href="/orders">العودة للطلبات</Link>
      </div>
    );
  return <Detail key={order.id} order={order} />;
}
function Detail({ order: o }: { order: Order }) {
  const { data, toast } = useApp(),
    router = useRouter(),
    mutation = useCommand();
  const [dialog, setDialog] = useState(""),
    [reason, setReason] = useState(""),
    [recipient, setRecipient] = useState(""),
    [driver, setDriver] = useState(o.assignment?.driverId ?? ""),
    [scheduled, setScheduled] = useState(o.assignment?.scheduledDate ?? ""),
    [note, setNote] = useState(""),
    [financeNote, setFinanceNote] = useState(""),
    [failureType, setFailureType] = useState("العميل غير متاح");
  const [review, setReview] = useState<ReviewInput["decisions"]>(
    o.items.map((i) => ({ itemId: i.id, status: "PENDING", reason: "" })),
  );
  const [reviewVersion, setReviewVersion] = useState(o.version),
    [dirty, setDirty] = useState(false);
  const key = useRef(crypto.randomUUID());
  useUnsaved(dirty);
  const user = data.user,
    events = data.activity.filter((e) => e.orderId === o.id),
    isReview = canActOnOrder(user, o, "review"),
    stock = shortages(o, data.inventory),
    missing = stock.filter((s) => s.deficit > 0),
    approved = review.filter((d) => d.status === "APPROVED").length,
    rejected = review.filter((d) => d.status === "REJECTED").length,
    pending = review.length - approved - rejected;
  const stale = dirty && reviewVersion !== o.version;
  function open(name: string) {
    setDialog(name);
    setReason("");
    setNote("");
    key.current = crypto.randomUUID();
    mutation.reset();
  }
  function setAll(status: "APPROVED" | "REJECTED", text = "") {
    setReview(o.items.map((i) => ({ itemId: i.id, status, reason: text })));
    setDirty(true);
  }
  async function execute() {
    const meta = {
      expectedVersion: dialog === "review" ? reviewVersion : o.version,
      idempotencyKey: key.current,
    };
    await mutation
      .mutateAsync(async () => {
        switch (dialog) {
          case "financeApprove":
          case "financeReject":
            await services.orders.recommendFinance(
              o.id,
              {
                recommendation:
                  dialog === "financeApprove" ? "APPROVE" : "REJECT",
                note: financeNote,
              },
              meta,
            );
            break;
          case "applyFinance": {
            const approved = o.financeRecommendation === "APPROVE";
            await services.orders.finalizeReview(
              o.id,
              {
                source: "FINANCE_RECOMMENDATION",
                decisions: o.items.map((item) => ({
                  itemId: item.id,
                  status: approved ? "APPROVED" : "REJECTED",
                  reason: approved
                    ? undefined
                    : o.financeNote || "تنفيذ توصية الحسابات بعدم الموافقة",
                })),
              },
              meta,
            );
            break;
          }
          case "review":
            await services.orders.finalizeReview(
              o.id,
              { source: "MANUAL", decisions: review },
              meta,
            );
            setDirty(false);
            break;
          case "warehouse":
            await services.orders.confirmWarehouse(o.id, meta);
            break;
          case "assign":
            await services.orders.assignDriver(
              o.id,
              { driverId: driver, scheduledDate: scheduled, loadingNote: note },
              meta,
            );
            break;
          case "dispatch":
            await services.orders.dispatch(o.id, meta);
            break;
          case "deliver":
            await services.orders.deliver(
              o.id,
              { recipientName: recipient, note },
              meta,
            );
            break;
          case "failed":
            await services.orders.reportFailedAttempt(
              o.id,
              {
                reason:
                  failureType === "أخرى"
                    ? reason
                    : failureType + (reason ? ` — ${reason}` : ""),
              },
              meta,
            );
            break;
          case "cancel":
            await services.orders.cancel(o.id, { reason }, meta);
            break;
          case "stock":
            await services.orders.recordStockIssue(o.id, { reason }, meta);
            break;
          case "delete":
            await services.orders.deleteDraft(o.id, meta);
            router.push("/orders");
            break;
        }
        setDialog("");
        toast("تم حفظ الإجراء بنجاح");
      })
      .catch(() => {});
  }
  const dialogTitles: Record<string, string> = {
    financeApprove: "توصية الحسابات بالموافقة",
    financeReject: "توصية الحسابات بعدم الموافقة",
    applyFinance: "تنفيذ توصية الحسابات",
    review: "تأكيد إنهاء المراجعة",
    warehouse: "تأكيد الجاهزية وحجز الكميات",
    assign: "تعيين سائق",
    dispatch: "تأكيد خروج جميع الأصناف المعتمدة",
    deliver: "تأكيد التسليم الكامل",
    failed: "تسجيل محاولة تعذر التسليم",
    cancel: "إلغاء الطلب",
    stock: "تسجيل ملاحظة نقص المخزون",
    delete: "حذف المسودة",
    rejectAll: "رفض جميع الأصناف",
    approveAll: "استبدال القرارات باعتماد الكل",
  };
  const actions = (
    <section className="panel padded action-panel no-print">
      <span className="eyebrow">الإجراء التالي</span>
      <h2>{isReview ? "ملخص المراجعة" : nextOwner[o.status]}</h2>
      <p className="muted">كل إجراء يُحفظ باسم منفذه ووقته.</p>
      {stale && (
        <div className="alert warning">
          تم تحديث الطلب. قراراتك لم تُمسح؛ أعد بدء المراجعة من النسخة الجديدة.
          <Button
            variant="outline"
            onClick={() => {
              setReview(
                o.items.map((i) => ({
                  itemId: i.id,
                  status: "PENDING",
                  reason: "",
                })),
              );
              setReviewVersion(o.version);
              setDirty(false);
            }}
          >
            إعادة تحميل المراجعة
          </Button>
        </div>
      )}
      <div className="form-stack">
        {canActOnOrder(user, o, "edit") && (
          <>
            <Button asChild>
              <Link href={`/orders/${o.id}/edit`}>تعديل وإرسال المسودة</Link>
            </Button>
            <Button variant="destructive" onClick={() => open("delete")}>
              حذف المسودة
            </Button>
          </>
        )}
        {canActOnOrder(user, o, "finance") && (
          <>
            <div className="alert info">
              توصية الحسابات رأي استشاري. القرار النهائي يصدر من المدير.
            </div>
            <Button
              onClick={() => {
                setFinanceNote("");
                open("financeApprove");
              }}
            >
              <Check size={17} /> أوصي بالموافقة
            </Button>
            <Button
              variant="outline"
              className="danger-text"
              onClick={() => {
                setFinanceNote("");
                open("financeReject");
              }}
            >
              أوصي بعدم الموافقة
            </Button>
          </>
        )}
        {isReview && (
          <>
            {o.financeRecommendation && (
              <div
                className={`alert ${o.financeRecommendation === "APPROVE" ? "info" : "warning"}`}
              >
                <strong>
                  توصية الحسابات:{" "}
                  {o.financeRecommendation === "APPROVE"
                    ? "موافقة"
                    : "عدم موافقة"}
                </strong>
                {o.financeNote && <p>{o.financeNote}</p>}
              </div>
            )}
            {o.financeRecommendation && (
              <Button onClick={() => open("applyFinance")}>
                تنفيذ توصية الحسابات
              </Button>
            )}
            <div className="review-counts">
              <span>
                معتمد <b>{approved}</b>
              </span>
              <span>
                مرفوض <b>{rejected}</b>
              </span>
              <span>
                متبقٍ <b>{pending}</b>
              </span>
            </div>
            <Button
              onClick={() =>
                rejected ? open("approveAll") : setAll("APPROVED")
              }
              variant="outline"
            >
              اعتماد الكل
            </Button>
            <Button variant="outline" onClick={() => open("rejectAll")}>
              رفض الكل
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setReview(
                  o.items.map((i) => ({
                    itemId: i.id,
                    status: "PENDING",
                    reason: "",
                  })),
                );
                setDirty(false);
                setReviewVersion(o.version);
              }}
            >
              إعادة ضبط المراجعة
            </Button>
            <Button
              disabled={
                pending > 0 ||
                review.some(
                  (d) => d.status === "REJECTED" && !d.reason?.trim(),
                ) ||
                stale
              }
              onClick={() => open("review")}
            >
              <ShieldCheck size={17} /> إنهاء المراجعة
            </Button>
            {pending > 0 && (
              <small className="muted">
                راجع {pending} أصناف متبقية لإتاحة الإنهاء.
              </small>
            )}
          </>
        )}
        {canActOnOrder(user, o, "warehouse") && (
          <>
            <Button
              disabled={missing.length > 0}
              onClick={() => open("warehouse")}
            >
              <Package size={17} /> تأكيد الجاهزية وحجز الكميات
            </Button>
            {missing.length > 0 && (
              <div className="alert warning">
                يوجد عجز في {missing.length} صنف. لا يمكن حجز الطلب جزئيًا.
              </div>
            )}
            <Button variant="outline" onClick={() => open("stock")}>
              تسجيل ملاحظة نقص
            </Button>
          </>
        )}
        {canActOnOrder(user, o, "assign") && (
          <Button variant="outline" onClick={() => open("assign")}>
            تعيين سائق
          </Button>
        )}
        {canActOnOrder(user, o, "dispatch") && (
          <>
            <Button disabled={!o.assignment} onClick={() => open("dispatch")}>
              <Truck size={18} /> تسليم الطلب للسائق
            </Button>
            {!o.assignment && <small>يجب تعيين سائق أولًا.</small>}
          </>
        )}
        {canActOnOrder(user, o, "deliver") && (
          <>
            <Button onClick={() => open("deliver")}>
              <Check size={18} /> تم التسليم
            </Button>
            <Button variant="outline" onClick={() => open("failed")}>
              تعذر التسليم
            </Button>
          </>
        )}
        {canActOnOrder(user, o, "cancel") && (
          <Button
            variant="ghost"
            className="danger-text"
            onClick={() => open("cancel")}
          >
            إلغاء الطلب
          </Button>
        )}
        {![
          "edit",
          "finance",
          "review",
          "warehouse",
          "assign",
          "dispatch",
          "deliver",
          "cancel",
        ].some((a) =>
          canActOnOrder(user, o, a as Parameters<typeof canActOnOrder>[2]),
        ) && <Waiting />}
      </div>
      {o.assignment && (
        <div className="assignment">
          <Truck size={19} />
          <div>
            <small>السائق المسند إليه</small>
            <strong>{o.assignment.driverNameSnapshot}</strong>
            {o.assignment.scheduledDate && (
              <small>{o.assignment.scheduledDate}</small>
            )}
            {o.assignment.loadingNote && <p>{o.assignment.loadingNote}</p>}
          </div>
        </div>
      )}
    </section>
  );
  return (
    <>
      <Link
        href="/orders"
        onClick={(e) => {
          if (window.history.length > 1) {
            e.preventDefault();
            router.back();
          }
        }}
        className="back-link no-print"
      >
        <ArrowRight size={16} /> العودة إلى القائمة
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">تفاصيل طلب المبيعات</span>
          <h1>
            {can(user, "WAREHOUSE_PREPARE") && o.status === "MANAGER_APPROVED"
              ? "تجهيز الطلب "
              : "طلب "}
            <bdi>{o.orderNumber}</bdi>
          </h1>
          <Badge order={o} />
        </div>
        <div className="button-row no-print">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(o.orderNumber);
                toast("تم نسخ رقم الطلب");
              } catch {
                toast("تعذر النسخ. يمكنك تحديد رقم الطلب ونسخه.");
              }
            }}
          >
            <Copy size={16} /> نسخ الرقم
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={16} /> طباعة
          </Button>
        </div>
      </div>
      <div className="order-meta-strip">
        <span>
          <Package size={17} />
          {o.customerSnapshot?.name ?? "عميل غير محدد"}
        </span>
        <span>
          {o.creatorNameSnapshot}
          <small>مندوب المبيعات</small>
        </span>
        <span>
          {formatDate(o.submittedAt)}
          <small>تاريخ تقديم الطلب</small>
        </span>
        <span>
          <MapPin size={16} />
          {o.deliveryAddress}
        </span>
      </div>
      <section className="panel progress-panel">
        <Stepper order={o} events={events} />
      </section>
      {o.financeRecommendation && (
        <div
          className={`alert ${o.financeRecommendation === "APPROVE" ? "info" : "warning"}`}
        >
          <div>
            <strong>
              توصية الحسابات:{" "}
              {o.financeRecommendation === "APPROVE"
                ? "الموافقة"
                : "عدم الموافقة"}
            </strong>
            <p>{o.financeNote || "لا توجد ملاحظات إضافية."}</p>
            <small>التوصية استشارية، وقرار الإدارة هو القرار النهائي.</small>
          </div>
        </div>
      )}
      {o.fulfillmentIssue && (
        <div className="alert warning">
          <AlertTriangle size={20} />
          <div>
            <strong>
              {o.fulfillmentIssue.type === "STOCK"
                ? "نقص مخزون"
                : "تعثر التسليم"}
            </strong>
            <p>{o.fulfillmentIssue.reason}</p>
          </div>
        </div>
      )}
      <div className="detail-layout">
        <div className="detail-content">
          <details
            className="panel padded customer-disclosure"
            open={o.status === "DRAFT" || can(user, "DELIVERY_CONFIRM")}
          >
            <summary className="section-title">
              <span className="section-icon">
                <MapPin size={20} />
              </span>
              <h2>بيانات العميل والتسليم</h2>
            </summary>
            <div className="customer-details">
              <div className="customer-summary">
                <div>
                  <small>العميل</small>
                  <h3>{o.customerSnapshot?.name ?? "غير محدد"}</h3>
                  <bdi>{o.customerSnapshot?.code}</bdi>
                </div>
                <div>
                  <small>مندوب المبيعات</small>
                  <strong>{o.creatorNameSnapshot}</strong>
                  <small>{formatDate(o.submittedAt)}</small>
                </div>
              </div>
              <p className="address">
                <MapPin size={17} />
                {o.deliveryAddress || "لم يحدد العنوان"}
              </p>
              {o.customerSnapshot?.phone && (
                <a className="phone" href={`tel:${o.customerSnapshot.phone}`}>
                  <Phone size={16} />
                  <bdi>{o.customerSnapshot.phone}</bdi>
                </a>
              )}
              <div className="summary-meta">
                <span>
                  التاريخ المطلوب:{" "}
                  <bdi>{o.requestedDeliveryDate || "غير محدد"}</bdi>
                </span>
                <span>إصدار الطلب: {o.version}</span>
              </div>
              {o.notes && (
                <div className="note">
                  <strong>ملاحظات الطلب</strong>
                  <p>{o.notes}</p>
                </div>
              )}
            </div>
          </details>
          {!(
            can(user, "DELIVERY_CONFIRM") && canActOnOrder(user, o, "deliver")
          ) && <div className="mobile-action">{actions}</div>}
          {can(user, "DELIVERY_CONFIRM") &&
            canActOnOrder(user, o, "deliver") && (
              <section className="panel padded mobile-delivery-form">
                <h2>تأكيد التسليم</h2>
                <label>
                  اسم المستلم
                  <input
                    aria-label="المستلم في نموذج الهاتف"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="أدخل اسم المستلم"
                  />
                </label>
                <label>
                  ملاحظات (اختياري)
                  <textarea
                    aria-label="ملاحظات التسليم في الهاتف"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="اكتب ملاحظات حول عملية التسليم…"
                    maxLength={500}
                  />
                </label>
                <div className="button-row">
                  <Button
                    disabled={!recipient.trim() || !navigator.onLine}
                    onClick={() => {
                      key.current = crypto.randomUUID();
                      mutation.reset();
                      setDialog("deliver");
                    }}
                  >
                    تأكيد التسليم
                  </Button>
                  <Button
                    variant="outline"
                    className="danger-text"
                    onClick={() => open("failed")}
                  >
                    تسجيل تعذر التسليم
                  </Button>
                </div>
              </section>
            )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  أصناف الطلب{" "}
                  <span className="count-badge">{o.items.length}</span>
                </h2>
                <p>الكميات الأصلية وقرارات الإدارة محفوظة كما هي</p>
              </div>
              {o.approvalOutcome && (
                <span className="badge partial">
                  {outcomeLabels[o.approvalOutcome]}
                </span>
              )}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>المطلوبة</th>
                    <th>قرار الإدارة</th>
                    <th>المعتمدة</th>
                    <th>سبب الرفض / الملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => {
                    const d = review.find((d) => d.itemId === i.id)!;
                    return (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.productSnapshot.name}</strong>
                          <small>
                            <bdi>{i.productSnapshot.sku}</bdi> ·{" "}
                            {i.productSnapshot.unit}
                          </small>
                        </td>
                        <td>{i.requestedQuantity}</td>
                        <td>
                          {isReview ? (
                            <>
                              <span className="print-only">
                                {decisionLabels[i.approvalStatus]}
                              </span>
                              <fieldset
                                className="review-radios no-print"
                                disabled={stale}
                              >
                                <legend className="sr-only">
                                  قرار {i.productSnapshot.name}
                                </legend>
                                {(["APPROVED", "REJECTED"] as const).map(
                                  (status) => (
                                    <label key={status}>
                                      <input
                                        type="radio"
                                        name={`decision-${i.id}`}
                                        checked={d.status === status}
                                        onChange={() => {
                                          setDirty(true);
                                          setReview(
                                            review.map((x) =>
                                              x.itemId === i.id
                                                ? { ...x, status }
                                                : x,
                                            ),
                                          );
                                        }}
                                      />
                                      {status === "APPROVED"
                                        ? "اعتماد الصنف"
                                        : "رفض الصنف"}
                                    </label>
                                  ),
                                )}
                              </fieldset>
                            </>
                          ) : (
                            <span className={`decision-${i.approvalStatus}`}>
                              {decisionLabels[i.approvalStatus]}
                            </span>
                          )}
                        </td>
                        <td>{i.approvedQuantity ?? "—"}</td>
                        <td>
                          {isReview && d.status === "REJECTED" ? (
                            <label>
                              سبب الرفض *
                              <input
                                value={d.reason ?? ""}
                                onChange={(e) => {
                                  setDirty(true);
                                  setReview(
                                    review.map((x) =>
                                      x.itemId === i.id
                                        ? { ...x, reason: e.target.value }
                                        : x,
                                    ),
                                  );
                                }}
                                aria-label={`سبب رفض ${i.productSnapshot.name}`}
                              />
                            </label>
                          ) : (
                            i.rejectionReason || i.note || "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {o.approvalOutcome && o.approvalOutcome !== "NONE" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>التجهيز والتنفيذ</h2>
                  <p>
                    الأصناف المعتمدة فقط · استُبعد{" "}
                    {
                      o.items.filter((i) => i.approvalStatus === "REJECTED")
                        .length
                    }{" "}
                    صنف مرفوض
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>كمية التنفيذ</th>
                      {data.inventory.length > 0 && (
                        <>
                          <th>الفعلي</th>
                          <th>المحجوز</th>
                          <th>المتاح</th>
                          <th>العجز</th>
                        </>
                      )}
                      <th>حجز هذا الطلب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((s) => (
                      <tr key={s.item.id}>
                        <td>{s.item.productSnapshot.name}</td>
                        <td>
                          {s.item.approvedQuantity}{" "}
                          {s.item.productSnapshot.unit}
                        </td>
                        {data.inventory.length > 0 && (
                          <>
                            <td>{s.onHand}</td>
                            <td>{s.reserved}</td>
                            <td>{s.available}</td>
                            <td
                              className={
                                s.deficit && o.status === "MANAGER_APPROVED"
                                  ? "danger-text"
                                  : ""
                              }
                            >
                              {o.status === "MANAGER_APPROVED"
                                ? s.deficit
                                : "—"}
                            </td>
                          </>
                        )}
                        <td>
                          {data.reservations
                            .filter(
                              (r) =>
                                r.orderId === o.id &&
                                r.itemId === s.item.id &&
                                r.status === "ACTIVE",
                            )
                            .reduce((sum, r) => sum + r.quantity, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="panel padded">
            <div className="section-title">
              <Send size={20} />
              <h2>سجل رحلة الطلب</h2>
            </div>
            <Timeline events={events} />
            {data.attempts
              .filter((a) => a.orderId === o.id)
              .map((a) => (
                <div className="note" key={a.id}>
                  <strong>
                    {a.outcome === "DELIVERED"
                      ? `تم الاستلام بواسطة ${a.recipientName}`
                      : `محاولة متعثرة: ${a.reason}`}
                  </strong>
                  <p>{a.note}</p>
                  <small>{formatDate(a.occurredAt)}</small>
                </div>
              ))}
          </section>
        </div>
        <aside className="desktop-action">{actions}</aside>
      </div>
      <Dialog
        variant={dialog === "assign" ? "drawer" : "dialog"}
        open={!!dialog}
        onOpenChange={(v) => !v && setDialog("")}
        title={dialogTitles[dialog] ?? "تأكيد الإجراء"}
      >
        <div className="form-stack">
          {dialog === "review" && (
            <div className="alert info">
              {approved} صنف معتمد، {rejected} مرفوض.{" "}
              {approved === 0
                ? "سيُرفض الطلب بالكامل."
                : "سينتقل الطلب إلى المخزن."}
            </div>
          )}
          {["financeApprove", "financeReject"].includes(dialog) && (
            <>
              <div className="alert info">
                سيتم إرسال التوصية إلى المدير التجاري، ويمكنه تنفيذها أو اتخاذ
                قرار كامل أو جزئي مختلف.
              </div>
              <label>
                ملاحظة الحسابات {dialog === "financeReject" ? "*" : "(اختياري)"}
                <textarea
                  value={financeNote}
                  onChange={(e) => setFinanceNote(e.target.value)}
                  rows={4}
                  maxLength={1000}
                />
              </label>
            </>
          )}
          {dialog === "applyFinance" && (
            <div className="alert info">
              سيصدر قرار الإدارة النهائي بتطبيق توصية الحسابات على كل أصناف
              الطلب:{" "}
              {o.financeRecommendation === "APPROVE"
                ? "اعتماد كامل"
                : "رفض كامل"}
              .
            </div>
          )}
          {dialog === "warehouse" && (
            <p>
              سيتم حجز جميع الكميات المعتمدة مرة واحدة بعد إعادة فحص الرصيد.
            </p>
          )}
          {dialog === "dispatch" && (
            <p>
              أؤكد أن المخزن سلّم جميع الأصناف المعتمدة إلى{" "}
              {o.assignment?.driverNameSnapshot}. سيُصرف المخزون المحجوز وتبدأ
              مهمة السائق.
            </p>
          )}
          {dialog === "assign" && (
            <>
              <label>
                السائق
                <select
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                >
                  <option value="">اختر السائق</option>
                  {data.users
                    .filter((u) => u.active && u.roles.includes("DRIVER"))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                تاريخ التوصيل
                <input
                  type="date"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                />
              </label>
              <label>
                ملاحظة التحميل
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
          {dialog === "deliver" && (
            <>
              <label>
                اسم المستلم *
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              <label>
                ملاحظة التسليم
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>أؤكد تسليم جميع الأصناف المعتمدة بالكامل.</p>
            </>
          )}
          {dialog === "failed" && (
            <label>
              سبب تعذر التسليم
              <select
                value={failureType}
                onChange={(e) => setFailureType(e.target.value)}
              >
                {[
                  "العميل غير متاح",
                  "عنوان غير صحيح",
                  "رفض الاستلام",
                  "أخرى",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          {["cancel", "stock", "rejectAll", "failed"].includes(dialog) && (
            <label>
              {dialog === "failed" ? "توضيح إضافي" : "السبب"}{" "}
              {dialog !== "failed" || failureType === "أخرى"
                ? "*"
                : "(اختياري)"}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </label>
          )}
          {dialog === "approveAll" && (
            <p>توجد قرارات رفض حالية. هل تريد استبدالها باعتماد كل الأصناف؟</p>
          )}
          {dialog === "delete" && <p>ستُحذف هذه المسودة من قائمة طلباتك.</p>}
          {mutation.error && (
            <div role="alert" className="alert error">
              {mutation.error.message}
              {mutation.error.message.includes("مستخدم آخر") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialog("");
                    router.refresh();
                  }}
                >
                  إغلاق ومراجعة أحدث بيانات
                </Button>
              )}
            </div>
          )}
          <div className="button-row">
            <Button
              disabled={
                mutation.isPending ||
                !navigator.onLine ||
                (["cancel", "stock", "rejectAll"].includes(dialog) &&
                  !reason.trim()) ||
                (dialog === "deliver" && !recipient.trim()) ||
                (dialog === "failed" &&
                  failureType === "أخرى" &&
                  !reason.trim()) ||
                (dialog === "assign" && !driver) ||
                (dialog === "financeReject" && !financeNote.trim())
              }
              onClick={() => {
                if (dialog === "rejectAll") {
                  setAll("REJECTED", reason);
                  setDialog("");
                } else if (dialog === "approveAll") {
                  setAll("APPROVED");
                  setDialog("");
                } else execute();
              }}
            >
              {mutation.isPending ? "جارٍ التنفيذ…" : "تأكيد"}
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setDialog("")}
            >
              رجوع
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
