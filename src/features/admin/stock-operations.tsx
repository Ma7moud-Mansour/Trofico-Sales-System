"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCommand } from "@/features/orders/hooks";
import { request } from "@/services/http";
import { hasRole } from "@/domain/policies";
import { type StockReceipt } from "@/domain/types";
import { formatDate } from "@/messages/ar";

type Movement = {
  id: string;
  productId: string;
  type: string;
  onHandDelta: number;
  reservedDelta: number;
  reason: string;
  occurredAt: string;
};

const receiptStatus = {
  PENDING_FINANCE: "بانتظار الحسابات",
  APPROVED: "معتمد ومضاف للرصيد",
  REJECTED: "مرفوض",
} as const;

export function StockOperations() {
  const { data, toast } = useApp();
  const mutation = useCommand();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{
    receipt: StockReceipt;
    decision: "approve" | "reject";
  } | null>(null);
  const [financeNote, setFinanceNote] = useState("");
  const signature = useRef("");
  const key = useRef("");
  const ledger = useQuery({
    queryKey: ["ledger", data.user.id],
    queryFn: () => request<Movement[]>("inventory/movements"),
    refetchInterval: 15000,
  });

  async function reviewReceipt() {
    if (!review) return;
    try {
      await mutation.mutateAsync(() =>
        request(
          `inventory/receipts/${review.receipt.id}/${review.decision}`,
          "POST",
          {
            expectedVersion: review.receipt.version,
            note: financeNote,
          },
          key.current,
        ),
      );
      toast(
        review.decision === "approve"
          ? "تم اعتماد الوارد وإضافته إلى الرصيد"
          : "تم رفض طلب الوارد",
      );
      setReview(null);
    } catch {}
  }

  return (
    <>
      <section className="panel padded">
        <div className="panel-heading">
          <div>
            <h2>طلبات الوارد</h2>
            <p>يسجل أمين المخزن الوارد، ولا يضاف للرصيد قبل موافقة الحسابات.</p>
          </div>
          {hasRole(data.user, "WAREHOUSE_MANAGER") && (
            <Button
              onClick={() => {
                mutation.reset();
                setOpen(true);
              }}
            >
              تسجيل وارد جديد
            </Button>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>المُسجل</th>
                <th>المرجع</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {data.stockReceipts.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.productName}</strong>
                    <small>{r.productSku}</small>
                  </td>
                  <td>{r.quantity}</td>
                  <td>
                    {r.createdByNameSnapshot}
                    <small>{formatDate(r.createdAt)}</small>
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    <span
                      className={`badge status-${r.status === "APPROVED" ? "DELIVERED" : r.status === "REJECTED" ? "REJECTED" : "PENDING_FINANCE"}`}
                    >
                      {receiptStatus[r.status]}
                    </span>
                    {r.financeNote && <small>{r.financeNote}</small>}
                  </td>
                  <td>
                    {r.status === "PENDING_FINANCE" &&
                    hasRole(data.user, "FINANCE") ? (
                      <div className="button-row">
                        <Button
                          onClick={() => {
                            mutation.reset();
                            key.current = crypto.randomUUID();
                            setFinanceNote("");
                            setReview({ receipt: r, decision: "approve" });
                          }}
                        >
                          اعتماد
                        </Button>
                        <Button
                          variant="outline"
                          className="danger-text"
                          onClick={() => {
                            mutation.reset();
                            key.current = crypto.randomUUID();
                            setFinanceNote("");
                            setReview({ receipt: r, decision: "reject" });
                          }}
                        >
                          رفض
                        </Button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.stockReceipts.length && (
          <p className="panel-note">لا توجد طلبات وارد مسجلة.</p>
        )}
      </section>

      <section className="panel padded">
        <div className="panel-heading">
          <div>
            <h2>دفتر حركات المخزون</h2>
            <p>الحركات المعتمدة التي أثرت فعليًا في الرصيد.</p>
          </div>
        </div>
        {ledger.error && <p className="alert error">{ledger.error.message}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الحركة</th>
                <th>تغير الفعلي</th>
                <th>تغير المحجوز</th>
                <th>السبب</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.map((m) => (
                <tr key={m.id}>
                  <td>
                    {data.products.find((p) => p.id === m.productId)?.name}
                  </td>
                  <td>
                    {{
                      OPENING: "رصيد افتتاحي",
                      RECEIPT: "وارد معتمد",
                      ADJUSTMENT: "تصحيح جرد",
                      RESERVE: "حجز",
                      RELEASE: "تحرير حجز",
                      DISPATCH: "صرف للسائق",
                    }[m.type] ?? m.type}
                  </td>
                  <td>{m.onHandDelta}</td>
                  <td>{m.reservedDelta}</td>
                  <td>{m.reason}</td>
                  <td>{formatDate(m.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        variant="drawer"
        open={open}
        onOpenChange={setOpen}
        title="تسجيل وارد للمخزن"
        description="سيُرسل إلى الحسابات للموافقة قبل تحديث الرصيد."
      >
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const b = data.inventory.find((b) => b.productId === product);
            const body = {
              productId: product,
              expectedVersion: b?.version,
              reason,
              quantity: Number(quantity),
            };
            const nextSignature = JSON.stringify(body);
            if (signature.current !== nextSignature) {
              signature.current = nextSignature;
              key.current = crypto.randomUUID();
            }
            try {
              await mutation.mutateAsync(() =>
                request("inventory/receipts", "POST", body, key.current),
              );
              setOpen(false);
              setQuantity("");
              setReason("");
              toast("تم إرسال الوارد إلى الحسابات للموافقة");
            } catch {}
          }}
        >
          <label>
            الصنف
            <select
              required
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">اختر الصنف</option>
              {data.products
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            الكمية الواردة
            <input
              required
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            رقم الإذن / المورد / المرجع
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {mutation.error && (
            <p role="alert" className="alert error">
              {mutation.error.message}
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            إرسال للموافقة
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!review}
        onOpenChange={(value) => !value && setReview(null)}
        title={review?.decision === "approve" ? "اعتماد الوارد" : "رفض الوارد"}
        description={review?.receipt.productName}
      >
        <div className="form-stack">
          <p>
            الكمية: <strong>{review?.receipt.quantity}</strong> · مسجل بواسطة{" "}
            {review?.receipt.createdByNameSnapshot}
          </p>
          <label>
            ملاحظة الحسابات {review?.decision === "reject" ? "*" : "(اختياري)"}
            <textarea
              value={financeNote}
              onChange={(e) => setFinanceNote(e.target.value)}
              maxLength={1000}
            />
          </label>
          {mutation.error && (
            <p role="alert" className="alert error">
              {mutation.error.message}
            </p>
          )}
          <div className="button-row">
            <Button
              disabled={
                mutation.isPending ||
                (review?.decision === "reject" && !financeNote.trim())
              }
              onClick={reviewReceipt}
            >
              تأكيد {review?.decision === "approve" ? "الاعتماد" : "الرفض"}
            </Button>
            <Button variant="outline" onClick={() => setReview(null)}>
              رجوع
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
