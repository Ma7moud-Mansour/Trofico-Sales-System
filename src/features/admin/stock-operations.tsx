"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCommand } from "@/features/orders/hooks";
import { request } from "@/services/http";
import { hasRole } from "@/domain/policies";
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
export function StockOperations() {
  const { data, toast } = useApp(),
    mutation = useCommand();
  const [open, setOpen] = useState(false),
    [product, setProduct] = useState(""),
    [kind, setKind] = useState("receipts"),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const signature = useRef(""),
    key = useRef("");
  const ledger = useQuery({
    queryKey: ["ledger", data.user.id],
    queryFn: () => request<Movement[]>("inventory/movements"),
    refetchInterval: 15000,
  });
  return (
    <section className="panel padded">
      <div className="panel-heading">
        <h2>دفتر حركات المخزون</h2>
        {hasRole(data.user, "SUPER_ADMIN", "WAREHOUSE_MANAGER") && (
          <Button
            onClick={() => {
              mutation.reset();
              setOpen(true);
            }}
          >
            إضافة حركة مخزون
          </Button>
        )}
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
                <td>{data.products.find((p) => p.id === m.productId)?.name}</td>
                <td>
                  {
                    {
                      OPENING: "رصيد افتتاحي",
                      RECEIPT: "استلام",
                      ADJUSTMENT: "تصحيح جرد",
                      RESERVE: "حجز",
                      RELEASE: "تحرير حجز",
                      DISPATCH: "صرف",
                    }[m.type]
                  }
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
      <Dialog
        variant="drawer"
        open={open}
        onOpenChange={setOpen}
        title="تسجيل حركة مخزون"
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
              ...(kind === "adjustments"
                ? { countedOnHand: Number(quantity) }
                : { quantity: Number(quantity) }),
            };
            const s = JSON.stringify([kind, body]);
            if (signature.current !== s) {
              signature.current = s;
              key.current = crypto.randomUUID();
            }
            try {
              await mutation.mutateAsync(() =>
                request("inventory/" + kind, "POST", body, key.current),
              );
              setOpen(false);
              setQuantity("");
              setReason("");
              toast("تم تسجيل الحركة وتحديث الرصيد");
            } catch {}
          }}
        >
          <label>
            نوع الحركة
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="receipts">استلام كمية</option>
              <option value="openings">رصيد افتتاحي — مرة واحدة</option>
              <option value="adjustments">تصحيح جرد</option>
            </select>
          </label>
          <label>
            الصنف
            <select
              required
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">اختر الصنف</option>
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === "adjustments" ? "الرصيد الفعلي بعد الجرد" : "الكمية"}
            <input
              required
              type="number"
              min={kind === "adjustments" ? 0 : 1}
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            السبب / المرجع
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
            تأكيد تسجيل الحركة
          </Button>
        </form>
      </Dialog>
    </section>
  );
}
