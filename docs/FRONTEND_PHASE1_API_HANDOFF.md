# عقد الربط بالباك إند

المصدر الملزم: `src/services/contracts.ts`، `src/domain/types.ts` و`src/domain/commands.ts`. كل الأوامر المذكورة أدناه منفذة في mock. المسارات HTTP أدناه توصية للربط المستقبلي، ولا يوجد سيرفر API في هذا التسليم.

## قواعد عامة

المعرفات strings؛ timestamps ISO UTC وتعرض بتوقيت Africa/Cairo. تواريخ التسليم `YYYY-MM-DD` قيم تاريخ فقط. بيانات العميل والمنتج واسم منشئ الطلب والسائق والمنفذ snapshots لحفظ التاريخ.

كل تعديل طلب يستقبل `MutationMeta = { expectedVersion: number, idempotencyKey: string }`. يفحص السيرفر الجلسة ثم رؤية الطلب وإذن الإجراء ثم الإصدار وقواعد الحالة. تكرار نفس المفتاح ونفس payload لنفس actor يعيد النتيجة الأصلية، ولا يعيد الحجز أو الصرف أو إنشاء الحدث. استخدام المفتاح مع payload مختلف خطأ تحقق. هوية actor لا تأتي من نموذج الإدخال.

## خدمات الطلبات

| الخدمة              | HTTP مقترح                                   | المدخلات الإضافية         | النتيجة                      |
| ------------------- | -------------------------------------------- | ------------------------- | ---------------------------- |
| list                | GET /orders                                  | OrderFilters              | Page<Order>                  |
| get                 | GET /orders/:id                              | id                        | Order                        |
| saveDraft           | POST /orders/drafts أو PUT /orders/:id/draft | SaveDraftInput + meta     | Order DRAFT                  |
| submit              | POST /orders/:id/submit                      | meta                      | PENDING_APPROVAL             |
| finalizeReview      | POST /orders/:id/review                      | ReviewInput + meta        | MANAGER_APPROVED أو REJECTED |
| confirmWarehouse    | POST /orders/:id/warehouse-confirmation      | meta                      | WAREHOUSE_CONFIRMED          |
| assignDriver        | POST /orders/:id/assignment                  | AssignmentInput + meta    | نفس الحالة                   |
| dispatch            | POST /orders/:id/dispatch                    | meta                      | IN_TRANSIT                   |
| deliver             | POST /orders/:id/delivery                    | DeliveryInput + meta      | DELIVERED                    |
| reportFailedAttempt | POST /orders/:id/delivery-attempts           | FailedAttemptInput + meta | IN_TRANSIT مع استثناء        |
| cancel              | POST /orders/:id/cancel                      | CancelInput + meta        | CANCELLED                    |
| recordStockIssue    | POST /orders/:id/stock-issue                 | {reason} + meta           | نفس الحالة مع ملاحظة         |
| deleteDraft         | DELETE /orders/:id/draft                     | meta                      | نسخة المسودة المحذوفة        |

```ts
type SaveDraftInput = {
  id?: string;
  customerId: string;
  deliveryAddress: string;
  requestedDeliveryDate?: string;
  notes?: string; // <=1000
  items: { id: string; productId: string; quantity: string; note?: string }[];
};
type ReviewInput = {
  decisions: {
    itemId: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reason?: string;
  }[];
};
type AssignmentInput = {
  driverId: string;
  scheduledDate?: string;
  loadingNote?: string;
};
type DeliveryInput = { recipientName: string; note?: string };
type FailedAttemptInput = { reason: string };
type CancelInput = { reason: string };
```

`quantity` في مدخل النموذج string لدعم تحويل الأرقام العربية؛ المخزن والطلب يحتويان number صحيحًا. المسودة تسمح بصفر أو أصناف ناقصة، والإرسال يشترط على الأقل صنفًا صالحًا وكمية موجبة وعميلًا نشطًا وعنوانًا. SKU لا يكرر. لا يُقبل PENDING عند إنهاء المراجعة؛ سبب كل REJECTED إلزامي. requestedQuantity لا تتغير؛ approvedQuantity مساوية للأصل أو صفر، وnull قبل المراجعة.

إنشاء وإرسال واجهة النموذج مرحلتان؛ يحتفظ النموذج بهوية المسودة ونتيجة الحفظ عند فشل الإرسال لتفادي إنشاء نسخة أخرى. يجب الإبقاء على سياسة retry بنفس المفتاح عند غموض نتيجة الشبكة.

`OrderFilters`: search, status, outcome, rep, customer, from, to, issue, tab, sort, page, pageSize, scope. `Page<T> = {items:T[], total:number, page:number, pageSize:number}`. total بعد تطبيق نطاق الرؤية والفلاتر. from/to على يوم submittedAt في القاهرة. القوائم الحالية مشتقة من snapshot موحد؛ عند HTTP تُنقل الفلاتر والـpagination للسيرفر عبر `orders.list`.

## الخدمات الأخرى

- `dashboard.get(): Promise<ViewData>`: لقطة عمل مفلترة حسب المستخدم. تشمل الطلبات والسجل والمحاولات والحجوزات المسموحة؛ المخزون التفصيلي للمدير والمخزن وAdmin فقط. العرض الحالي يجمع اللقطة لأغراض المحاكاة؛ الإنتاج يجب أن يعيد الحد الأدنى لكل شاشة.
- `session.current/accounts/login/logout`: جلسة تجريبية متزامنة؛ تُستبدل بمصادقة السيرفر. `accounts` ليست ميزة إنتاج.
- `users.save(User)`, `customers.save(Customer)`, `products.save(Product)`: Admin فقط، وفردية username/code/sku، وتعطيل بدل حذف. قيود آخر Admin نشط والحساب الحالي والسائق قيد التوصيل مطبقة.
- `inventory.list()`: رصيد فعلي ومحجوز ومتاح محسوب، read-only.
- `activity.list()`: أحداث مسموحة للمستخدم. الشاشة العامة Admin فقط. لا أمر حذف أو تعديل أحداث.

## معاملات المخزون

1. تأكيد المخزن يعيد فحص `onHand - reserved` لكل البنود المعتمدة، ويحجز جميعها في معاملة واحدة أو يرفض دون حجز جزئي.
2. الإلغاء قبل الخروج يحرر ACTIVE reservations ويزيد المتاح، ولا يغير onHand.
3. Dispatch يحول ACTIVE إلى CONSUMED وينقص onHand وreserved بنفس الكمية مرة واحدة.
4. Deliver وfailed attempt لا يعدلان المخزون.

ينبغي أن ينفذ السيرفر ذلك بقفل/معاملة قاعدة بيانات، وأن يربط الطلب والحجز وسجل الحدث وreceipt في نفس المعاملة. Web Locks والمحاكاة المحلية ليست بديلًا.

## الأخطاء

| code               | HTTP مقترح    | سلوك الواجهة                                  |
| ------------------ | ------------- | --------------------------------------------- |
| VALIDATION_ERROR   | 422           | الرسالة عند النموذج والاحتفاظ بالمدخلات       |
| FORBIDDEN          | 403           | لا صلاحية؛ لا كشف للبيانات غير المسموحة       |
| NOT_FOUND          | 404           | رابط العودة للقائمة                           |
| VERSION_CONFLICT   | 409           | لا overwrite؛ إعادة تحميل ومراجعة أحدث بيانات |
| INSUFFICIENT_STOCK | 409           | أسماء الأصناف والعجز؛ بقاء مرحلة المخزن       |
| NETWORK_ERROR      | شبكة / 503    | إعادة محاولة، لا نجاح وهمي                    |
| STORAGE_ERROR      | خاص بالمحاكاة | فشل القراءة/الحفظ، لا persist جزئي            |

شكل خطأ الإنتاج المقترح `{code, message, fieldErrors?, currentVersion?}`. لا يُعرض JSON تقني للمستخدم.

## الـcache والتحديث

مفتاح اللقطة `['workspace', user.id, user.roles]` وتفاصيل الطلب `['order', user.id, order.id]`. تبديل الهوية يمسح QueryClient قبل تحميل حساب جديد. كل mutation ناجحة تبطل الاستعلامات لإعادة حساب القوائم والمخزون والبطاقات والسجل. لا نجاح قبل تأكيد service؛ لا optimistic stock mutations. نموذج المراجعة يحتفظ بنسخته ويكشف اختلاف version.

في الإنتاج يُفضل مفاتيح مقسمة لقوائم الطلبات مع filters/detail/inventory/dashboard/activity. جميع انتقالات الطلب تبطل هذه المفاتيح. تعديلات masters تبطل selectors والمستخدمين النشطين دون تحديث snapshots التاريخية.

التحديث الحالي storage events وإعادة الجلب بعد focus/reconnect. يمكن لاحقًا polling كل 15–30 ثانية، أو realtime إذا دعمت الاستضافة ذلك. لا tokens عبر BroadcastChannel ولا اعتماد على إخفاء CSS كصلاحية.
