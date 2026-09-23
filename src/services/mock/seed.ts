import {
  type Database,
  type Order,
  type Status,
  type Role,
  roles,
  permissions as allPermissions,
  type Permission,
} from "@/domain/types";
import veterinaryCatalog from "@/data/veterinary-products.json";
export function createSeed(now = new Date().toISOString()): Database {
  const areas = [
    "منطقة الشرقية والقناة",
    "منطقة الدقهلية ودمياط",
    "قليوبية ومنوفية",
    "الغربية وكفر الشيخ",
    "البحيرة والإسكندرية",
    "القاهرة والجيزة",
    "الفيوم وبني سويف",
    "المنيا وأسيوط",
    "قنا والأقصر",
    "المنيا وأسيوط - دوا ميكرز",
  ].map((name, i) => ({
    id: `a${i + 1}`,
    name,
    active: true,
    version: 1,
  }));
  const names = [
    "أحمد مصطفى",
    "سارة محمود",
    "د. أحمد علام",
    "أمين المخزن",
    "منى حسن",
    "عمر خالد",
    "يوسف علي",
    "كريم سعيد",
    "د. محمد صبري",
  ];
  const rs: Role[] = [
    "SALES_REP",
    "SALES_REP",
    "SALES_MANAGER",
    "WAREHOUSE_MANAGER",
    "FINANCE",
    "LOGISTICS",
    "DRIVER",
    "DRIVER",
    "SUPER_ADMIN",
  ];
  const defaults: Record<Role, Permission[]> = {
    SALES_REP: ["ORDERS_VIEW", "ORDERS_CREATE"],
    SALES_MANAGER: ["ORDERS_VIEW", "MANAGER_DECIDE", "INVENTORY_VIEW"],
    WAREHOUSE_MANAGER: [
      "ORDERS_VIEW",
      "WAREHOUSE_PREPARE",
      "INVENTORY_VIEW",
      "INVENTORY_RECEIVE",
    ],
    FINANCE: [
      "ORDERS_VIEW",
      "FINANCE_RECOMMEND",
      "INVENTORY_VIEW",
      "RECEIPTS_APPROVE",
      "CUSTOMERS_MANAGE",
      "PRODUCTS_MANAGE",
    ],
    LOGISTICS: ["ORDERS_VIEW", "LOGISTICS_VIEW"],
    DRIVER: ["ORDERS_VIEW", "DELIVERY_CONFIRM"],
    SUPER_ADMIN: [...allPermissions],
  };
  const rolePermissions = roles.map((role) => ({
    role,
    permissions: defaults[role],
    version: 1,
  }));
  const users = names.map((name, i) => ({
    id: `u${i + 1}`,
    name,
    username: [
      "ahmed",
      "sara",
      "manager",
      "warehouse",
      "finance",
      "logistics",
      "youssef",
      "karim",
      "admin",
    ][i],
    roles: [rs[i]],
    permissions: defaults[rs[i]],
    areaIds: i === 0 ? ["a1", "a6"] : i === 1 ? ["a2", "a5"] : [],
    active: true,
  }));
  const customers = [
    "سوبر ماركت النور",
    "أسواق المدينة",
    "ماركت الخير",
    "مؤسسة الأمانة للتجارة والتوزيع",
    "هايبر العائلة",
    "محلات البركة",
    "سوبر ماركت الروضة",
    "أسواق الصفوة",
    "ماركت الياسمين",
    "شركة المستقبل للتوريدات",
  ].map((name, i) => ({
    id: `c${i + 1}`,
    code: `C-${String(i + 1).padStart(3, "0")}`,
    name,
    phone: `01000000${String(i + 1).padStart(3, "0")}`,
    defaultAddress: `القاهرة، ${["مدينة نصر", "المعادي", "التجمع الخامس", "الشروق", "مصر الجديدة"][i % 5]}، شارع ${i + 10}، مبنى ${i + 1}`,
    areaId: areas[i % areas.length].id,
    active: true,
  }));
  const products = veterinaryCatalog.products.map((product) => ({
    id: `p${product.sourceId}`,
    sku: product.sku,
    name: product.name,
    unit: "عبوة",
    active: true,
  }));
  const db: Database = {
    schemaVersion: 1,
    orderSequence: 24,
    referenceTime: now,
    users,
    rolePermissions,
    areas,
    customers,
    products,
    orders: [],
    inventory: products.map((p, i) => ({
      productId: p.id,
      onHand: i === 11 ? 0 : i === 3 ? 8 : 500,
      reserved: 0,
      version: 1,
    })),
    stockReceipts: [],
    reservations: [],
    attempts: [],
    activity: [],
    receipts: {},
  };
  const ss: Status[] = [
    "PENDING_FINANCE",
    "PENDING_MANAGER",
    "MANAGER_APPROVED",
    "WAREHOUSE_CONFIRMED",
    "IN_TRANSIT",
    "DELIVERED",
    "PENDING_FINANCE",
    "REJECTED",
    "MANAGER_APPROVED",
    "DRAFT",
    "CANCELLED",
    "WAREHOUSE_CONFIRMED",
    "IN_TRANSIT",
  ];
  for (let n = 0; n < 24; n++) {
    const status = ss[n % ss.length];
    const time = new Date(
      new Date(now).getTime() - (24 - n) * 3600000 * 3,
    ).toISOString();
    const customer = customers[n % 10];
    const o: Order = {
      id: `o${n + 1}`,
      orderNumber: `SO-${new Date(now).getFullYear()}-${String(n + 1).padStart(5, "0")}`,
      createdBy: n % 2 ? "u2" : "u1",
      creatorNameSnapshot: users[n % 2].name,
      customerId: customer.id,
      customerSnapshot: { ...customer },
      deliveryAddress: customer.defaultAddress,
      requestedDeliveryDate: now.slice(0, 10),
      notes: n % 4 === 0 ? "يرجى الاتصال بالعميل قبل الوصول." : "",
      status,
      items: [0, 1].map((_, j) => {
        const p = products[(n + j) % products.length];
        const reviewed = ![
          "DRAFT",
          "PENDING_FINANCE",
          "PENDING_MANAGER",
          "CANCELLED",
        ].includes(status);
        const rejected =
          status === "REJECTED" || (reviewed && n % 3 === 1 && j === 1);
        return {
          id: `i${n}-${j}`,
          productId: p.id,
          productSnapshot: { ...p },
          requestedQuantity: 10 + j * 5,
          approvalStatus: reviewed
            ? rejected
              ? "REJECTED"
              : "APPROVED"
            : "PENDING",
          approvedQuantity: reviewed ? (rejected ? 0 : 10 + j * 5) : null,
          rejectionReason: rejected
            ? "الصنف غير متاح للتوريد في الوقت الحالي"
            : undefined,
        };
      }),
      createdAt: time,
      submittedAt: status === "DRAFT" ? undefined : time,
      updatedAt: time,
      version: 1,
    };
    if (
      !["DRAFT", "PENDING_FINANCE", "PENDING_MANAGER", "CANCELLED"].includes(
        status,
      )
    )
      o.approvalOutcome =
        status === "REJECTED" ? "NONE" : n % 3 === 1 ? "PARTIAL" : "FULL";
    if (!["DRAFT", "PENDING_FINANCE"].includes(status)) {
      o.financeRecommendation = n % 4 === 0 ? "REJECT" : "APPROVE";
      o.financeNote =
        o.financeRecommendation === "REJECT"
          ? "يوجد رصيد مستحق يحتاج قرار الإدارة"
          : "الحد الائتماني يسمح بالتنفيذ";
      o.financeReviewedBy = "u5";
      o.financeReviewedAt = time;
    }
    const event = (type: string, actor: string, summary: string) =>
      db.activity.push({
        id: `e${n}-${type}`,
        orderId: o.id,
        actorId: actor,
        actorNameSnapshot: users.find((u) => u.id === actor)!.name,
        actorRole: users.find((u) => u.id === actor)!.roles[0],
        type,
        occurredAt: time,
        summary,
      });
    event("DRAFT", o.createdBy, "إنشاء الطلب");
    if (status !== "DRAFT")
      event("SUBMIT", o.createdBy, "إرسال الطلب إلى الحسابات");
    if (o.financeRecommendation)
      event("FINANCE_RECOMMENDATION", "u5", "تسجيل توصية الحسابات");
    if (o.approvalOutcome) event("REVIEW", "u3", "إنهاء مراجعة أصناف الطلب");
    if (["WAREHOUSE_CONFIRMED", "IN_TRANSIT", "DELIVERED"].includes(status)) {
      event("WAREHOUSE", "u4", "حجز جميع الكميات المعتمدة");
      for (const item of o.items.filter(
        (i) => i.approvalStatus === "APPROVED",
      )) {
        const b = db.inventory.find((b) => b.productId === item.productId)!;
        b.onHand = Math.max(b.onHand, 100);
        db.reservations.push({
          id: `r-${item.id}`,
          orderId: o.id,
          itemId: item.id,
          productId: item.productId,
          quantity: item.approvedQuantity!,
          status: status === "WAREHOUSE_CONFIRMED" ? "ACTIVE" : "CONSUMED",
        });
        if (status === "WAREHOUSE_CONFIRMED")
          b.reserved += item.approvedQuantity!;
        else b.onHand -= item.approvedQuantity!;
      }
      if (n % 12 !== 2) {
        o.assignment = {
          driverId: n % 2 ? "u7" : "u8",
          driverNameSnapshot: users[n % 2 ? 6 : 7].name,
          assignedBy: "u4",
          assignedAt: time,
        };
        event("ASSIGN", "u4", "إسناد الطلب للسائق");
      }
    }
    if (["IN_TRANSIT", "DELIVERED"].includes(status))
      event("DISPATCH", "u4", "تسليم الطلب للسائق");
    if (status === "DELIVERED") {
      o.deliveredAt = time;
      db.attempts.push({
        id: `a${n}`,
        orderId: o.id,
        actorId: n % 2 ? "u7" : "u8",
        outcome: "DELIVERED",
        recipientName: "مسؤول الاستلام",
        occurredAt: time,
      });
      event("DELIVER", n % 2 ? "u7" : "u8", "تم التسليم إلى مسؤول الاستلام");
    }
    if (status === "IN_TRANSIT" && n % 12 === 11) {
      o.fulfillmentIssue = { type: "DELIVERY", reason: "العميل غير متاح" };
      db.attempts.push({
        id: `a${n}`,
        orderId: o.id,
        actorId: "u7",
        outcome: "FAILED",
        reason: "العميل غير متاح",
        occurredAt: time,
      });
      event("FAILED", "u7", "تعذر التسليم: العميل غير متاح");
    }
    if (status === "MANAGER_APPROVED" && n % 12 === 7) {
      o.items[0].productId = "p12";
      o.items[0].productSnapshot = { ...products[11] };
      o.items[0].requestedQuantity = 600;
      o.items[0].approvedQuantity = 600;
      o.fulfillmentIssue = {
        type: "STOCK",
        reason: "الكمية المتاحة لا تغطي الطلب",
      };
    }
    if (status === "CANCELLED")
      event("CANCEL", "u3", "إلغاء بناءً على طلب العميل");
    db.orders.push(o);
  }
  return db;
}
