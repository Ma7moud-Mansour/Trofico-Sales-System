import { z } from "zod";
export const normalizeDigits = (v: string) =>
  v.replace(/[٠-٩۰-۹]/g, (c) =>
    String(
      "٠١٢٣٤٥٦٧٨٩".includes(c)
        ? "٠١٢٣٤٥٦٧٨٩".indexOf(c)
        : "۰۱۲۳۴۵۶۷۸۹".indexOf(c),
    ),
  );
export const quantitySchema = z
  .string()
  .transform(normalizeDigits)
  .refine(
    (v) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0,
    "أدخل عددًا صحيحًا موجبًا",
  );
export const orderSchema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  deliveryAddress: z.string().trim().min(1, "عنوان التسليم مطلوب"),
  requestedDeliveryDate: z.string().optional(),
  notes: z.string().max(1000, "الحد الأقصى 1000 حرف"),
  items: z
    .array(
      z.object({
        id: z.string(),
        productId: z.string().min(1, "اختر الصنف"),
        quantity: quantitySchema,
        note: z.string().max(300, "الحد الأقصى 300 حرف").optional(),
      }),
    )
    .min(1, "أضف صنفًا واحدًا على الأقل"),
});
