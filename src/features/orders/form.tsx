"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Send, Save, ArrowRight, Package } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { canActOnOrder, hasRole } from "@/domain/policies";
import { DomainError, type SaveDraftInput } from "@/domain/types";
import { services } from "@/services";
import { orderSchema, normalizeDigits } from "./schemas";
import { useCommand } from "./hooks";
import { useUnsaved } from "@/lib/use-unsaved";
type FormValues = {
  customerId: string;
  deliveryAddress: string;
  requestedDeliveryDate?: string;
  notes: string;
  items: { id: string; productId: string; quantity: string; note?: string }[];
};
export function OrderForm({ id }: { id?: string }) {
  const { data } = useApp();
  const order = data.orders.find((o) => o.id === id);
  if (
    !hasRole(data.user, "SALES_REP") ||
    (id && (!order || !canActOnOrder(data.user, order, "edit")))
  )
    return (
      <div className="panel empty">
        <h2>لا يمكنك تعديل هذا الطلب</h2>
        <p>التعديل متاح لصاحب المسودة فقط.</p>
        <Link href="/orders">العودة للطلبات</Link>
      </div>
    );
  return <FormContent key={id ?? "new"} id={id} />;
}
function FormContent({ id }: { id?: string }) {
  const { data, toast } = useApp(),
    router = useRouter(),
    mutation = useCommand();
  const original = data.orders.find((o) => o.id === id);
  const [confirm, setConfirm] = useState(false),
    [customerSearch, setCustomerSearch] = useState(""),
    [productSearch, setProductSearch] = useState(""),
    [selectedProduct, setSelectedProduct] = useState(""),
    [leaving, setLeaving] = useState(false);
  const saved = useRef<{ id: string; version: number } | null>(
    original ? { id: original.id, version: original.version } : null,
  );
  const key = useRef(crypto.randomUUID());
  const form = useForm<FormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customerId: original?.customerId ?? "",
      deliveryAddress: original?.deliveryAddress ?? "",
      requestedDeliveryDate: original?.requestedDeliveryDate ?? "",
      notes: original?.notes ?? "",
      items:
        original?.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          quantity: String(i.requestedQuantity),
          note: i.note ?? "",
        })) ?? [],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
    keyName: "formKey",
  });
  const values = useWatch({ control: form.control }) as FormValues,
    errors = form.formState.errors;
  const lastSaved = useRef<{
    fingerprint: string;
    order: import("@/domain/types").Order;
  } | null>(null);
  useUnsaved(form.formState.isDirty && !leaving);
  function add() {
    if (!selectedProduct) return;
    const idx = values.items.findIndex((i) => i.productId === selectedProduct);
    if (idx >= 0) {
      form.setFocus(`items.${idx}.quantity`);
      toast("الصنف موجود بالفعل");
      return;
    }
    append({
      id: crypto.randomUUID(),
      productId: selectedProduct,
      quantity: "1",
      note: "",
    });
    setSelectedProduct("");
  }
  async function save(submit: boolean) {
    await mutation
      .mutateAsync(async () => {
        const input: SaveDraftInput = {
          ...form.getValues(),
          id: saved.current?.id,
        };
        const fingerprint = JSON.stringify(form.getValues());
        const draft =
          lastSaved.current?.fingerprint === fingerprint
            ? lastSaved.current.order
            : await services.orders.saveDraft(input, {
                expectedVersion: saved.current?.version ?? 0,
                idempotencyKey: key.current + ":save:" + JSON.stringify(input),
              });
        lastSaved.current = { fingerprint, order: draft };
        saved.current = { id: draft.id, version: draft.version };
        let result = draft;
        if (submit)
          result = await services.orders.submit(draft.id, {
            expectedVersion: draft.version,
            idempotencyKey: key.current + ":submit",
          });
        form.reset(form.getValues());
        setLeaving(true);
        setConfirm(false);
        toast(submit ? "تم إرسال الطلب إلى جميع الإدارات" : "حُفظت المسودة");
        router.push(`/orders/${result.id}`);
      })
      .catch((error) => {
        if (error instanceof DomainError && error.fieldErrors)
          for (const [field, messages] of Object.entries(error.fieldErrors)) {
            if (
              [
                "customerId",
                "deliveryAddress",
                "requestedDeliveryDate",
                "notes",
                "items",
              ].includes(field)
            )
              form.setError(field as keyof FormValues, {
                type: "server",
                message: messages.join("، "),
              });
          }
      });
  }
  const customer = data.customers.find((c) => c.id === values.customerId);
  const totals = values.items.reduce<Record<string, number>>((acc, i) => {
    const unit =
      data.products.find((p) => p.id === i.productId)?.unit ?? "كرتونة";
    const q = Number(normalizeDigits(i.quantity));
    acc[unit] = (acc[unit] ?? 0) + (Number.isSafeInteger(q) && q > 0 ? q : 0);
    return acc;
  }, {});
  return (
    <form
      className="sales-order-form"
      onSubmit={form.handleSubmit(() => setConfirm(true))}
      noValidate
    >
      <Link className="back-link" href="/orders">
        <ArrowRight size={16} /> العودة إلى الطلبات
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            المبيعات / {id ? "تعديل المسودة" : "طلب جديد"}
          </span>
          <h1>{id ? "تعديل المسودة" : "إنشاء طلب مبيعات"}</h1>
          <p>أضف بيانات العميل والأصناف، ثم أرسل الطلب للمراجعة.</p>
        </div>
        <span className="badge status-DRAFT">مسودة · لم تُرسل بعد</span>
      </div>
      {mutation.error && (
        <div className="alert error" role="alert">
          {mutation.error.message}
          {mutation.error.message.includes("مستخدم آخر") && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (
                  window.confirm(
                    "إعادة تحميل أحدث نسخة ستستبدل مدخلات النموذج. متابعة؟",
                  )
                )
                  window.location.reload();
              }}
            >
              إعادة تحميل أحدث نسخة
            </Button>
          )}
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <div className="alert error" role="alert">
          راجع الحقول المطلوبة قبل الإرسال. {errors.items?.message}
        </div>
      )}
      <div className="detail-layout">
        <div className="form-stack">
          <section className="panel padded">
            <div className="section-title">
              <span className="section-number">01</span>
              <div>
                <h2>بيانات العميل</h2>
                <p>عنوان التسليم خاص بهذا الطلب</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                البحث عن عميل
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="اسم العميل، الكود أو الهاتف"
                />
              </label>
              <label>
                <span>
                  العميل <span className="required">*</span>
                </span>
                <select
                  {...form.register("customerId")}
                  onChange={(e) => {
                    form.setValue("customerId", e.target.value, {
                      shouldDirty: true,
                    });
                    form.setValue(
                      "deliveryAddress",
                      data.customers.find((c) => c.id === e.target.value)
                        ?.defaultAddress ?? "",
                      { shouldDirty: true },
                    );
                  }}
                >
                  <option value="">اختر العميل</option>
                  {data.customers
                    .filter(
                      (c) =>
                        c.active &&
                        (c.id === values.customerId ||
                          [c.name, c.code, c.phone]
                            .join(" ")
                            .includes(customerSearch)),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.code} · {c.phone}
                      </option>
                    ))}
                </select>
                {errors.customerId && (
                  <small className="field-error">
                    {errors.customerId.message}
                  </small>
                )}
              </label>
              <label>
                رقم التواصل
                <input
                  value={customer?.phone ?? ""}
                  readOnly
                  dir="ltr"
                  placeholder="يظهر بعد اختيار العميل"
                />
              </label>
              <label className="span-2">
                <span>
                  عنوان التسليم <span className="required">*</span>
                </span>
                <textarea {...form.register("deliveryAddress")} rows={2} />
                {errors.deliveryAddress && (
                  <small className="field-error">
                    {errors.deliveryAddress.message}
                  </small>
                )}
              </label>
              <label>
                تاريخ التسليم المطلوب (اختياري)
                <input
                  type="date"
                  {...form.register("requestedDeliveryDate")}
                />
              </label>
            </div>
            <p className="helper">عميل غير موجود؟ تواصل مع الإدارة لإضافته.</p>
          </section>
          <section className="panel padded">
            <div className="section-title">
              <span className="section-number">02</span>
              <div>
                <h2>أصناف الطلب</h2>
                <p>الكميات بأعداد صحيحة، كل صنف في سطر واحد</p>
              </div>
            </div>
            <div className="product-picker">
              <label>
                ابحث عن صنف
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="اسم الصنف أو SKU"
                />
              </label>
              <label>
                الصنف
                <select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                >
                  <option value="">اختر الصنف</option>
                  {data.products
                    .filter(
                      (p) =>
                        p.active &&
                        [p.name, p.sku].join(" ").includes(productSearch),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.sku}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={add}
                disabled={!selectedProduct}
              >
                <Plus size={17} /> إضافة صنف
              </Button>
            </div>
            {!fields.length && (
              <div className="empty compact">
                <Package size={30} />
                <p>ابدأ بإضافة أصناف الطلب من القائمة.</p>
              </div>
            )}
            {fields.map((field, index) => {
              const p = data.products.find((p) => p.id === field.productId);
              return (
                <div className="form-item" key={field.formKey}>
                  <div>
                    <strong>{p?.name}</strong>
                    <small>
                      <bdi>{p?.sku}</bdi> · {p?.unit}
                    </small>
                  </div>
                  <label>
                    الكمية
                    <span className="quantity-control">
                      <button
                        type="button"
                        aria-label={`تقليل كمية ${p?.name}`}
                        onClick={() => {
                          const q = Number(
                            normalizeDigits(values.items[index].quantity),
                          );
                          if (Number.isSafeInteger(q) && q > 1)
                            form.setValue(
                              `items.${index}.quantity`,
                              String(q - 1),
                              { shouldDirty: true, shouldValidate: true },
                            );
                        }}
                      >
                        −
                      </button>
                      <input
                        inputMode="numeric"
                        aria-label={`كمية ${p?.name}`}
                        {...form.register(`items.${index}.quantity`)}
                      />
                      <button
                        type="button"
                        aria-label={`زيادة كمية ${p?.name}`}
                        onClick={() => {
                          const q = Number(
                            normalizeDigits(values.items[index].quantity),
                          );
                          if (Number.isSafeInteger(q) && q >= 0)
                            form.setValue(
                              `items.${index}.quantity`,
                              String(q + 1),
                              { shouldDirty: true, shouldValidate: true },
                            );
                        }}
                      >
                        +
                      </button>
                    </span>
                    {errors.items?.[index]?.quantity && (
                      <small className="field-error">
                        {errors.items[index]?.quantity?.message}
                      </small>
                    )}
                  </label>
                  <label>
                    ملاحظة الصنف
                    <input
                      maxLength={300}
                      {...form.register(`items.${index}.note`)}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button danger-text"
                    aria-label={`حذف ${p?.name}`}
                    onClick={() => remove(index)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })}
          </section>
          <section className="panel padded">
            <div className="section-title">
              <span className="section-number">03</span>
              <h2>ملاحظات إضافية</h2>
            </div>
            <label>
              ملاحظات الطلب (اختياري)
              <textarea
                rows={3}
                maxLength={1000}
                {...form.register("notes")}
                placeholder="أضف أي تفاصيل تساعد فريق التنفيذ…"
              />
            </label>
            <small className="muted">{values.notes.length} / 1000</small>
          </section>
        </div>
        <aside className="panel padded order-summary">
          <h2>ملخص الطلب</h2>
          <p className="muted">راجع بياناتك قبل الإرسال</p>
          <dl>
            <dt>العميل</dt>
            <dd>{customer?.name ?? "لم يُحدد"}</dd>
            <dt>المندوب</dt>
            <dd>{data.user.name}</dd>
            <dt>عدد الأصناف</dt>
            <dd>{values.items.length}</dd>
            {Object.entries(totals).map(([unit, total]) => (
              <div key={unit}>
                <dt>إجمالي {unit}</dt>
                <dd>{total}</dd>
              </div>
            ))}
          </dl>
          <div className="alert info">
            بعد الإرسال، يظهر الطلب للإدارات وتُقفل بياناته لحين انتهاء الدورة.
          </div>
          <div className="form-stack">
            <Button
              type="submit"
              disabled={mutation.isPending || !navigator.onLine}
            >
              <Send size={17} />
              {mutation.isPending ? "جارٍ الحفظ…" : "إرسال للمراجعة"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending || !navigator.onLine}
              onClick={() => save(false)}
            >
              <Save size={17} /> حفظ مسودة
            </Button>
          </div>
        </aside>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="إرسال الطلب للمراجعة"
        description={`العميل: ${customer?.name}. عدد الأصناف: ${values.items.length}. ستظهر البيانات لجميع الإدارات.`}
      >
        <div className="button-row">
          <Button
            type="button"
            disabled={mutation.isPending}
            onClick={() => save(true)}
          >
            تأكيد الإرسال
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirm(false)}
          >
            رجوع
          </Button>
        </div>
        {mutation.error && (
          <p role="alert" className="field-error">
            {mutation.error.message}
          </p>
        )}
      </Dialog>
    </form>
  );
}
