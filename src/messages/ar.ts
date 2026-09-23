import type { Role, Status } from "@/domain/types";
export const roleLabels: Record<Role, string> = {
  SALES_REP: "مندوب مبيعات",
  SALES_MANAGER: "المدير التجاري",
  WAREHOUSE_MANAGER: "مسؤول المخزن",
  FINANCE: "الحسابات",
  LOGISTICS: "مسؤول الحركة",
  DRIVER: "سائق",
  SUPER_ADMIN: "الإدارة العليا",
};
export const statusLabels: Record<Status, string> = {
  DRAFT: "مسودة",
  PENDING_FINANCE: "بانتظار توصية الحسابات",
  PENDING_MANAGER: "بانتظار قرار المدير",
  MANAGER_APPROVED: "معتمد من الإدارة",
  WAREHOUSE_CONFIRMED: "جاهز للصرف",
  IN_TRANSIT: "قيد التوصيل",
  DELIVERED: "تم التسليم",
  REJECTED: "مرفوض",
  CANCELLED: "ملغي",
};
export const outcomeLabels = {
  FULL: "اعتماد كامل",
  PARTIAL: "اعتماد جزئي",
  NONE: "رفض كامل",
};
export const decisionLabels = {
  PENDING: "لم يراجع",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
};
export const nextOwner: Record<Status, string> = {
  DRAFT: "مندوب المبيعات",
  PENDING_FINANCE: "الحسابات",
  PENDING_MANAGER: "المدير التجاري",
  MANAGER_APPROVED: "المخزن",
  WAREHOUSE_CONFIRMED: "المخزن لتسليم السائق",
  IN_TRANSIT: "السائق",
  DELIVERED: "مكتمل",
  REJECTED: "أغلق الطلب",
  CANCELLED: "أغلق الطلب",
};
export const eventLabels: Record<string, string> = {
  DRAFT: "حفظ مسودة",
  SUBMIT: "إرسال الطلب",
  FINANCE_RECOMMENDATION: "توصية الحسابات",
  REVIEW: "إنهاء مراجعة الإدارة",
  WAREHOUSE: "تأكيد المخزن",
  ASSIGN: "تعيين سائق",
  DISPATCH: "الخروج للتوصيل",
  DELIVER: "تسليم الطلب",
  FAILED: "محاولة تسليم متعثرة",
  CANCEL: "إلغاء الطلب",
  STOCK: "ملاحظة نقص مخزون",
  STOCK_RECEIPT_REQUEST: "تسجيل وارد",
  STOCK_RECEIPT_APPROVED: "اعتماد وارد",
  STOCK_RECEIPT_REJECTED: "رفض وارد",
  ROLE_PERMISSIONS_UPDATED: "تعديل صلاحيات دور",
  MASTER: "تعديل البيانات الأساسية",
};
export const ar = {
  name: "إدارة طلبات المبيعات",
  subtitle: "من أول طلب، حتى آخر تسليم.",
  demo: "وضع تجريبي",
  loading: "جارٍ تحميل البيانات…",
  empty: "لا توجد نتائج مطابقة",
  forbidden: "ليس لديك صلاحية لهذه الصفحة",
  notFound: "الطلب غير موجود",
  offline:
    "أنت غير متصل. يمكنك مراجعة البيانات، وتحتاج إلى الاتصال لحفظ الإجراءات.",
  conflict:
    "تم تعديل الطلب بواسطة مستخدم آخر. أعد تحميل البيانات قبل المحاولة.",
  saved: "تم حفظ الإجراء بنجاح",
  search: "ابحث برقم الطلب، العميل أو المندوب…",
};
export function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Cairo",
      }).format(new Date(value))
    : "—";
}
export function cairoDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
