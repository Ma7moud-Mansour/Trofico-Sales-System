# تشغيل المرحلة الثانية ونشرها

## الحالة الفعلية

تم تنفيذ API وربط الواجهة واختبار PostgreSQL محليًا. لم يُنشر النظام على الإنترنت. لا توجد بيانات موثقة عن مزود الاستضافة أو خطته؛ تشغيل Node وحده لا يثبت دعم عمليتين أو PostgreSQL أو TLS.

الإصدارات المثبتة: Node 24.19.0 للاختبار النهائي، PostgreSQL 18.3، NestJS 12.0.1، Prisma 7.10.0، Next 16.3.4. ملف lock ثابت؛ لم تستخدم Prisma 8 RC رغم ظهوره كـlatest. overrides تعالج تبعيات multer/deepmerge-ts/mysql2؛ فحص npm audit بعد التحديث بلا ثغرات معروفة وقت الفحص.

## البنية المختارة

عمليتان خلف نطاق واحد: Next على 3000، وNest على loopback:4000. `/api/v1` يذهب إلى Nest، والباقي Next. يوجد rewrite للتطوير، ونموذج Nginx في `backend/ops/nginx.conf.example`. لا Redis ولا خدمات رسائل. الشركة والمخزن واحدان. دفتر حركة محلي هو مصدر رصيد المخزون؛ يلزم اعتماد هذا الافتراض قبل إدخال أرصدة فعلية.

يلزم تأكيد: دعم PostgreSQL/اتصال خارجي، عمليتي Node وإدارة إعادة تشغيلهما، reverse proxy وTLS، عدد اتصالات DB وRAM، cron، ومكان نسخ احتياطي خارج الجهاز. لم تُختبر طوبولوجيا نطاقين أو عملية Node واحدة؛ لا تستخدمها دون اختبار مستقل.

## إعداد البيئة

انسخ `.env.example` إلى ملف أسرار محلي أو استخدم secret manager. `DATABASE_URL` لحساب runtime محدود، و`MIGRATION_DATABASE_URL` لمالك المهاجرات. لا تُعرض عناوين الاتصال في المتصفح أو السجلات. الإنتاج يرفض `COOKIE_SECURE=false` وأصول HTTP. اضبط `ALLOWED_ORIGINS` على الأصل الفعلي فقط، و`TRUST_PROXY=loopback` فقط عند proxy محلي موثوق يحذف X-Forwarded-For الوارد ويضبطه بنفسه. دون ذلك استخدم `none`.

`API_INTERNAL_URL` يحدد وجهة rewrite وقت البناء؛ الافتراضي `http://127.0.0.1:4000`. يُفضّل أن يتولى reverse proxy توجيه API في الإنتاج. لا تفتح منفذ Nest للإنترنت. اضبط pool لكل replica بحيث مجموعها أقل من حد المزود، مع هامش للمهاجرات والنسخ. statement timeout=15s، transaction=20s، connection timeout=5s؛ كل اتصال DB يضبط timezone=UTC لتجنب اختلاف تحويل driver للتوقيت.

## خطوات release

1. استخدم Node الموافق `.node-version` ثم `npm ci`.
2. خذ نسخة احتياطية لقاعدة موجودة وتحقق من صلاحيتها.
3. `npm run db:migrate:deploy` مرة واحدة منسقة بهوية migrations. لا db push/reset في الإنتاج.
4. أنشئ runtime role غير مالك وغير superuser، ثم طبّق `backend/ops/runtime-grants.sql` كمالك باستخدام psql ومتغير `runtime_role`. أعد تطبيق المنح بعد كل migration تضيف جداول.
5. `npm run build` ثم `npm run api:start` و`npm start` تحت مدير عمليات مناسب للمزود. لا تنفذ seed عند الإقلاع.
6. نفذ `npm run admin:bootstrap` مرة واحدة من terminal آمن؛ كلمة المرور تقرأ مخفية من TTY أو stdin الخاص بمدير الأسرار. لا تضعها في arguments/history. يرفض الأمر إنشاء Admin ثانٍ عند وجود واحد.
7. افحص `/api/v1/health/live`. فحص `/api/v1/health/ready` يحتاج جلسة Admin ويختبر DB والمهاجرة؛ لا تكشفه للعامة. OpenAPI العام يعرض العقد فقط في `/api/v1/openapi.json`.
8. أنشئ الحسابات والعملاء والمنتجات، ثم الأرصدة المعتمدة من شاشة المخزون. كلمات المرور المؤقتة تظهر للمسؤول مرة واحدة ويلزم تغييرها. لا تستورد localStorage تلقائيًا.
9. smoke test في staging بحسابات معروفة. لا تنشئ طلبات اختبار في إنتاج العميل دون توجيه.
10. جدولة `npm run sessions:cleanup` يوميًا، ومراقبة السجلات JSON ومؤشرات الخدمة والنسخ الاحتياطي. لا حذف للتاريخ التجاري.

## سياسات تشغيل مهمة

- جلسة opaque 32 bytes، hash فقط في DB، HttpOnly وSameSite=Lax، وSecure/`__Host-session` على HTTPS. الخمول 60 دقيقة، والحد 12 ساعة قابلان للإعداد. تحديث lastSeen مرة في الدقيقة.
- Argon2id: 64 MiB، 3 passes، parallelism=1؛ قِس تكلفة hashing على الاستضافة قبل زيادة حمل الدخول. حدود مشتركة في PostgreSQL: 5 محاولات/دقيقة للحساب و30/IP، بلا قفل دائم.
- جميع mutations تتحقق من Origin وJSON وCSRF. token يعاد bootstrap بعد تغيير الجلسة؛ الطلب الفاشل لا يُعاد تلقائيًا.
- تغيير/إعادة ضبط كلمة المرور وتعديل المستخدم يلغي جلساته. mustChangePassword يسمح فقط ببيانات الحساب وتغيير كلمة المرور والخروج (مع CSRF bootstrap).
- idempotency يحتفظ بالنتائج 7 أيام؛ بعد النافذة يمكن أن يكون إنشاء الطلب إنشاءً جديدًا. كلمات المرور المؤقتة لا تخزن في سجل النتائج: replay يعيد إيصال النجاح دون إعادة كشف السر؛ عند فقد استجابة إنشاء الحساب، يعيد المسؤول ضبط كلمة مروره.
- أقفال PostgreSQL موثقة في FRONTEND_API_MAPPING: advisory lock موحد للكتابة، ثم الطلب ثم الأرصدة بترتيب ثابت. يضمن التنسيق بين replicas لكنه يحد throughput؛ لا ندّعي أرقام أداء قبل اختبار حمل الاستضافة.
- CSP يستخدم nonce للـscripts مع rendering ديناميكي، ويسمح inline styles لمكونات React/Radix. لا unsafe-eval في الإنتاج. headers وhydration يُفحصان في اختبارات المتصفح.
- workspace هو DTO تجميعي للتوافق مع الواجهات الحالية، وجميع بياناته scoped في DB. قائمة الطلبات تستخدم pagination/filters في API؛ workspace وتاريخ الحركة ما زالا تجميعيين، ولذلك ينبغي قياسهما وتقسيم قراءتهما قبل اعتماد أحجام تشغيل كبيرة. لم يُنفذ اختبار 10,000 طلب/20 مستخدمًا.

## الرجوع

ارجع إصدار الكود فقط إذا schema متوافق. لا down/reset عشوائي. عند تغير غير متوافق استخدم خطة استعادة مجربة على قاعدة مستقلة، ثم وجّه الاتصال بعد التحقق. لا تفترض RTO دون قياس.
