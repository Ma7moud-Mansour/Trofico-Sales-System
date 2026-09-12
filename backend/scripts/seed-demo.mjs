// Explicit local demonstration seed. Never runs on application startup.
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { db, transaction, one, rows, write } from '../dist/db.js';
import { getActor, hashPassword } from '../dist/auth.js';
import { master, reconcile } from '../dist/masters.js';
import { balance, movement, event } from '../dist/repository.js';
import { draft, orderCommand } from '../dist/orders.js';

async function run() {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw Error('Requires a local development database');
  if (await one(db, "SELECT id FROM users WHERE username_normalized='demo.sales1'")) throw Error('Demo batch already exists; refusing duplicate data');
  const adminRow = await one(db, "SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active AND r.role='SUPER_ADMIN' LIMIT 1");
  if (!adminRow) throw Error('Bootstrap administrator first');
  mkdirSync('.runtime', { recursive: true });
  const backupUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  const backup = spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe', ['-h', backupUrl.hostname, '-p', backupUrl.port || '5432', '-U', decodeURIComponent(backupUrl.username), '-d', backupUrl.pathname.slice(1), '-Fc', '-f', `.runtime/before-demo-${Date.now()}.dump`], { env: { ...process.env, PGPASSWORD: decodeURIComponent(backupUrl.password) }, windowsHide: true, encoding: 'utf8' });
  if (backup.status !== 0) throw Error('Pre-seed backup failed');
  const definitions = [
    ['sales1', 'محمود حسن', 'SALES_REP', 'مندوب مبيعات'],
    ['sales2', 'سارة أحمد', 'SALES_REP', 'مندوبة مبيعات'],
    ['manager', 'أحمد علام', 'SALES_MANAGER', 'مدير المبيعات'],
    ['warehouse', 'خالد علي', 'WAREHOUSE_MANAGER', 'مسؤول المخزن'],
    ['logistics', 'كريم إبراهيم', 'LOGISTICS', 'مسؤول الحركة'],
    ['finance', 'منى أحمد', 'FINANCE', 'الحسابات'],
    ['driver1', 'أحمد محمود', 'DRIVER', 'سائق'],
    ['driver2', 'محمد علي', 'DRIVER', 'سائق'],
  ];
  const accounts = [];
  for (const [key, name, role, label] of definitions) {
    const password = randomBytes(15).toString('base64url');
    accounts.push({ id: randomUUID(), key, name, role, label, username: `demo.${key}`, password, hash: await hashPassword(password) });
  }
  const result = await transaction(async tx => {
    if (await one(tx, "SELECT id FROM users WHERE username_normalized='demo.sales1'")) throw Error('Demo batch already exists');
    const admin = await getActor(tx, adminRow.id);
    const actors = {};
    for (const a of accounts) {
      await write(tx, 'INSERT INTO users(id,username,username_normalized,name,password_hash,must_change_password) VALUES($1::uuid,$2,$2,$3,$4,false)', a.id, a.username, a.name, a.hash);
      await write(tx, 'INSERT INTO user_roles VALUES($1::uuid,$2)', a.id, a.role);
      await event(tx, admin, 'USER_CREATED', `إنشاء حساب عرض: ${a.name}`, randomUUID());
      actors[a.key] = await getActor(tx, a.id);
    }
    const customerNames = ['شركة النور للتجارة', 'مؤسسة الأمل للتوزيع', 'أسواق الصفوة', 'هايبر المدينة', 'سوبر ماركت الندى', 'شركة الرواد للتوريدات', 'أسواق الياسمين', 'مؤسسة الفجر', 'ماركت البستان', 'شركة الوفاق', 'أسواق الريان', 'مؤسسة المروة'];
    const areas = ['مدينة نصر — القاهرة', 'المعادي — القاهرة', 'التجمع الخامس — القاهرة', 'الدقي — الجيزة', 'سموحة — الإسكندرية', 'المنصورة — الدقهلية', 'طنطا — الغربية', 'الزقازيق — الشرقية', 'شبرا — القاهرة', 'السادس من أكتوبر — الجيزة', 'العبور — القليوبية', 'الشروق — القاهرة'];
    const customers = [];
    for (let i = 0; i < customerNames.length; i++) customers.push(await master(tx, admin, 'customers', undefined, { name: customerNames[i], code: `DEMO-C-${String(i + 1).padStart(3, '0')}`, phone: '', defaultAddress: areas[i], active: true }, randomUUID()));
    const names = ['عصير مانجو 1 لتر', 'عصير برتقال 1 لتر', 'عصير تفاح 1 لتر', 'عصير جوافة 1 لتر', 'عصير أناناس 1 لتر', 'مياه معدنية 600 مل', 'مياه معدنية 1.5 لتر', 'مشروب خوخ 250 مل', 'مشروب كوكتيل 250 مل', 'عصير رمان 1 لتر'];
    const products = [];
    for (let i = 0; i < names.length; i++) {
      const product = await master(tx, admin, 'products', undefined, { name: names[i], sku: `DEMO-P-${String(i + 1).padStart(3, '0')}`, unit: 'كرتونة', active: true }, randomUUID());
      products.push(product);
      await movement(tx, actors.warehouse, await balance(tx, product.id), 'OPENING', i === 9 ? 5 : 350 + i * 45, 0, 'رصيد افتتاحي لبيانات العرض التجريبية', randomUUID());
    }
    const summary = [];
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 36; i++) {
      const scenario = i % 12, rep = i % 2 ? actors.sales2 : actors.sales1;
      const customer = customers[i % customers.length];
      const selected = scenario === 4 ? [products[9], products[0]] : [products[i % 9], products[(i + 2) % 9], products[(i + 4) % 9]];
      let order = await draft(tx, rep, undefined, { customerId: customer.id, deliveryAddress: customer.defaultAddress, requestedDeliveryDate: today, notes: 'بيانات تجريبية للعرض والاختبار — يرجى مراجعة الأصناف قبل التحميل.', items: selected.map((p, j) => ({ productId: p.id, quantity: String(scenario === 4 && j === 0 ? 12 : 5 + (i * 7 + j * 3) % 16) })) }, randomUUID());
      const command = async (actor, type, extra = {}) => { order = await orderCommand(tx, actor, order.id, type, { expectedVersion: order.version, ...extra }, randomUUID()); };
      if (scenario !== 0) await command(rep, 'submit');
      if (scenario >= 2) await command(actors.manager, 'review', { decisions: order.items.map((item, j) => ({ itemId: item.id, status: scenario === 10 || ((scenario === 3 || scenario === 8) && j === 2) ? 'REJECTED' : 'APPROVED', reason: 'الصنف غير مناسب لاحتياج العميل الحالي' })) });
      if (scenario === 4) await command(actors.warehouse, 'warehouse-notes', { reason: 'عصير الرمان: المطلوب 12 كرتونة والمتاح 5؛ في انتظار توريد 7 كراتين لاستكمال التجهيز.' });
      if ([5, 6, 7, 8, 9, 11].includes(scenario)) await command(actors.warehouse, 'warehouse-confirmation');
      const driver = i % 2 ? actors.driver2 : actors.driver1;
      if ([6, 7, 8, 9].includes(scenario)) await command(actors.logistics, 'assignment', { driverId: driver.id, scheduledDate: today, loadingNote: 'راجع عدد الكراتين وسلامة العبوات قبل الخروج.' });
      if ([7, 8, 9].includes(scenario)) await command(driver, 'dispatch');
      if (scenario === 8) await command(driver, 'deliver', { recipientName: ['حسن إبراهيم', 'محمد سعيد', 'أحمد عادل'][Math.floor(i / 12)], note: 'تمت مراجعة الكميات وتسليمها كاملة بحالة جيدة.' });
      if (scenario === 9) await command(driver, 'delivery-attempts', { reasonCode: 'ABSENT', reason: 'مسؤول الاستلام غير موجود؛ تمت جدولة إعادة المحاولة.' });
      if (scenario === 11) await command(actors.manager, 'cancel', { reason: 'طلب العميل تأجيل الشحنة وإلغاء الطلب الحالي.' });
      summary.push({ id: order.id, status: order.status, scenario });
    }
    const differences = await reconcile(tx);
    if (differences.length) throw Error('Ledger reconciliation failed; demo transaction rolled back');
    return summary;
  });
  writeFileSync('.runtime/demo-accounts.json', JSON.stringify(accounts.map(a => ({ id: a.id, key: a.key, name: a.name, role: a.role, label: a.label, username: a.username, password: a.password })), null, 2), { mode: 0o600 });
  writeFileSync('.runtime/demo-access.md', '# حسابات العرض التجريبي\n\nهذه بيانات وهمية للعرض. حساب المدير الحالي لم يتغير.\n\n| الدور | الاسم | اسم المستخدم | كلمة المرور |\n|---|---|---|---|\n' + accounts.map(a => `| ${a.label} | ${a.name} | ${a.username} | ${a.password} |`).join('\n') + '\n\nالرابط: http://localhost:3000/login\n', { mode: 0o600 });
  writeFileSync('.runtime/demo-manifest.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ added: { customers: 12, products: 10, users: 8, orders: result.length }, statuses: result.reduce((a, o) => ({ ...a, [o.status]: (a[o.status] || 0) + 1 }), {}), inventoryDifferences: 0, credentials: '.runtime/demo-access.md' }, null, 2));
  console.log(JSON.stringify(await rows(db, 'SELECT status,count(*)::int count FROM orders GROUP BY status ORDER BY status')));
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
