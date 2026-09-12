# عقد API الفعلي — المرحلة الثانية

Base `/api/v1`، REST على NestJS، والواجهة تستخدم نفس-origin مع HttpOnly cookie. الوثيقة الآلية في `GET /api/v1/openapi.json` تُولد من Zod schemas المستخدمة فعلًا للتحقق، في `backend/src/openapi.ts` و`schemas.ts`.

## الطلب والاستجابة

النجاح `{data: DTO}`؛ قائمة الطلبات `{data:{items,total,page,pageSize}}` للحفاظ على عقد الواجهة. الخطأ `{error:{code,message,fieldErrors?,details?,requestId}}`. لا SQL/stack/أسرار في الردود. طلبات JSON حتى DELETE، وحد body هو 256 KiB و100 بند، وpageSize أقصاه 100.

GET auth/csrf قبل أول mutation يعيد `data.token` ويضع cookie حماية. أرسل `X-CSRF-Token` وOrigin مسموحًا وcredentials. بعد login/logout/change-password يصفّر adapter token ويطلب bootstrap جديدًا. الحماية لا تعتمد على SameSite وحده. مفاتيح العمليات `Idempotency-Key` ثابتة لنفس المحاولة؛ الواجهة تحوّل المفتاح المحلي إلى SHA-256 حتى لا تحمل headers بيانات النموذج أو حروفًا غير صالحة.

## المسارات

| النطاق | المسارات |
|---|---|
| المصادقة | GET auth/csrf, auth/me؛ POST auth/login, auth/logout, auth/change-password |
| الطلبات | GET/POST orders؛ GET/PATCH/DELETE orders/:id؛ GET orders/:id/activity |
| أوامر الطلب | POST orders/:id/submit, review, warehouse-confirmation, warehouse-notes, assignment, dispatch, deliver, delivery-attempts, cancel |
| الإدارة | GET/POST users, customers, products؛ PATCH :kind/:id؛ POST users/:id/reset-password |
| الاختيارات | GET lookups/customers, lookups/products, lookups/drivers |
| المخزون | GET inventory/balances, inventory/movements؛ POST inventory/openings, inventory/receipts, inventory/adjustments |
| العرض | GET workspace, dashboard, activity |
| التشغيل | GET health/live، وhealth/ready لجلسة Admin، وopenapi.json للعقد العام |

`expectedVersion` مطلوب بعد الإنشاء لكل تعديل. API لا يقبل createdBy/actorId/status أو snapshots من العميل. IDs UUID، رقم المسودة فارغ في DB ويعرض «مسودة» حتى الإرسال. كمية المسودة يجب أن تكون integer موجبة؛ المسودة الناقصة تقبل غياب العميل والبنود، ولا تحفظ بندًا وهميًا أو صفرًا.

الأسماء المحتفظ بها من عقد الواجهة: `decisions[].status` بدل decision، `loadingNote` بدل notes للتعيين، `Reservation.itemId` وstatus، ونجاح attempt هو `DELIVERED`. أحداث changes نصوص مقروءة تتوافق مع Timeline الحالي. الطوابع الزمنية UTC، واليوم التجاري Cairo مع نهاية exclusive لليوم التالي.

## القراءة والصلاحيات

تطبق policy SQL قبل count/pagination: المسودة لصاحبها المندوب فقط، والمرسل للإدارات المحددة أو صاحبه. ID خارج نطاق الرؤية يرجع404. master CRUD والسجل العام للـAdmin؛ lookups العملاء/المنتجات للمندوب وAdmin، والسائقين للحركة. بقية الإدارات تعتمد snapshots الطلبات.

`workspace` تجميع scoped للتوافق مع الشاشات والتفاصيل الحالية، ولا يضم hashes أوsessions. عدادات وعرض لوحة المتابعة مشتقان من نفس البيانات المصرح بها؛ قائمة الطلبات تجلب pagination من السيرفر. الاختيارات العامة لا تكشف بيانات العملاء للإدارات غير المخولة. تُبطل queries بعد command، ولا تبقى cache لحساب سابق عند الخروج.

الفلاتر: search/status/outcome/rep/customer/from/to/issue/tab/scope/sort/page/pageSize. البحث محدود الطول، الفرز allowlist مع id tie-breaker، والمدى الزمني validated. الجداول الإدارية وسجل الحركة ما زالت قراءتها تجميعية وتصفّيها واجهتها؛ انظر حد التوسع في DEPLOYMENT.

## المعاملات والإعادة

جميع writes التجارية في transaction واحدة تشمل المستخدم والسياسة والحالة وversion والأرصدة والحجز والحركة والحدث وإيصال idempotency. ترتيب التنسيق: advisory transaction lock موحد بين الكتابات ثم order row ثم balances بترتيب UUID؛ تعديل الأدوار/السائق والإرسال يستخدمان نفس التنسيق. retry محدود فقط للـdeadlock/serialization.

النتيجة السابقة تُراجع بعد المصادقة والإذن الحالي وقبل expectedVersion. نفس key مع body مختلف يرجع409. الحركات والحجوزات ونجاح التسليم لها قيود DB إضافية. كلمات المرور المؤقتة تظهر مرة واحدة ولا تُحفظ في إيصال الإعادة؛ فقدان استجابتها يستلزم reset صريحًا من المسؤول.

codes: VALIDATION_ERROR، UNAUTHENTICATED، FORBIDDEN، CSRF_INVALID، PASSWORD_CHANGE_REQUIRED، NOT_FOUND، INVALID_TRANSITION، VERSION_CONFLICT، INSUFFICIENT_STOCK، IDEMPOTENCY_KEY_REUSED، DUPLICATE_RECORD، DRIVER_BUSY، LAST_ADMIN، OPENING_EXISTS، RATE_LIMITED، SERVICE_UNAVAILABLE، INTERNAL_ERROR.
