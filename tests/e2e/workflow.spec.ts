import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});
async function login(page: Page, id = "u1") {
  await page.goto("/login");
  await page.getByLabel("الحساب التجريبي").selectOption(id);
  await page.getByRole("button", { name: "الدخول للتجربة" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator("h1")).toContainText("نظرة عامة");
}
async function switchUser(page: Page, id: string) {
  await page.getByRole("button", { name: "أدوات العرض التجريبي" }).click();
  await page.getByLabel("تبديل المستخدم").selectOption(id);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await expect(page.locator("h1")).toContainText("نظرة عامة");
}
async function confirm(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
test("Full cross-role partial approval, reservation, failed attempt, delivery, finance and persistence", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "إنشاء طلب جديد" }).click();
  await page
    .getByRole("combobox", { name: "العميل *", exact: true })
    .selectOption("c1");
  for (const id of ["p1", "p2"]) {
    await page
      .getByRole("combobox", { name: "الصنف", exact: true })
      .selectOption(id);
    await page.getByRole("button", { name: "إضافة صنف", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "كمية عصير مانجو" }).fill("١٠");
  await page.getByRole("button", { name: "إرسال للمراجعة" }).click();
  await page.getByRole("button", { name: "تأكيد الإرسال" }).click();
  await expect(page).toHaveURL(/orders\/[a-f0-9-]{36}$/);
  await expect(
    page.getByText("بانتظار توصية الحسابات", { exact: true }).first(),
  ).toBeVisible();
  const url = page.url();
  await switchUser(page, "u5");
  await page.goto(url);
  await page
    .getByRole("button", { name: "أوصي بالموافقة", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(/ملاحظة الحسابات/)
    .fill("سليم");
  await confirm(page);
  await switchUser(page, "u3");
  await page.goto(url);
  await page.getByRole("radio", { name: "اعتماد الصنف" }).first().check();
  await page.getByRole("radio", { name: "رفض الصنف" }).nth(1).check();
  await page.getByLabel("سبب رفض عصير برتقال").fill("غير متاح");
  await page
    .getByRole("button", { name: "إنهاء المراجعة", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByText("اعتماد جزئي", { exact: true }).first(),
  ).toBeVisible();
  await switchUser(page, "u4");
  await page.goto(url);
  await page
    .getByRole("button", { name: "تأكيد الجاهزية وحجز الكميات", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByText("جاهز للصرف", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "تعيين سائق", exact: true }).click();
  await page
    .getByRole("combobox", { name: "السائق", exact: true })
    .selectOption("u7");
  await confirm(page);
  await page
    .getByRole("button", { name: "تسليم الطلب للسائق", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByText("قيد التوصيل", { exact: true }).first(),
  ).toBeVisible();
  await switchUser(page, "u7");
  await page.goto(url);
  await page.getByRole("button", { name: "تعذر التسليم", exact: true }).click();
  await confirm(page);
  await expect(
    page.getByText("تعثر التسليم", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "تم التسليم", exact: true }).click();
  await page.getByLabel("اسم المستلم").fill("محمد المستلم");
  await confirm(page);
  await expect(
    page.getByText("تم التسليم", { exact: true }).first(),
  ).toBeVisible();
  await switchUser(page, "u5");
  await page.goto(url);
  await expect(
    page.getByText("اعتماد جزئي", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "إنهاء المراجعة", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("تم الاستلام بواسطة محمد المستلم")).toBeVisible();
});
test("Shortage and deterministic conflict preserve state; retry succeeds once", async ({
  page,
}) => {
  await login(page, "u4");
  await page.goto("/orders/o8");
  await expect(
    page.getByRole("button", { name: "تأكيد الجاهزية وحجز الكميات" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "أدوات العرض التجريبي" }).click();
  await page.getByLabel("صنف لتجربة المخزون").selectOption("p12");
  await page.getByRole("button", { name: "تزويد الرصيد التجريبي" }).click();
  await expect(page.locator(".toast")).toContainText("1000");
  await page.getByRole("button", { name: "تعارض الإصدار التالي" }).click();
  await page
    .getByRole("button", { name: "تأكيد الجاهزية وحجز الكميات", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("مستخدم آخر");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("جاهز للصرف", { exact: true }).first(),
  ).toBeVisible();
});
test("Draft survives reload, filters persist through back, forbidden route, keyboard dialog", async ({
  page,
}) => {
  await login(page);
  await page.goto("/orders/new");
  await page.getByLabel("ملاحظات الطلب").fill("مسودة اختبار");
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page).toHaveURL(/orders\/[a-f0-9-]{36}$/);
  await page.reload();
  await expect(page.getByText("مسودة اختبار")).toBeVisible();
  await page.goto("/orders?status=PENDING_FINANCE");
  const href = await page.locator(".order-row").first().getAttribute("href");
  await page.locator(".order-row").first().click();
  await expect(page).toHaveURL(new RegExp(href!));
  await page.getByRole("link", { name: "العودة إلى القائمة" }).click();
  await expect(page).toHaveURL(/status=PENDING_FINANCE/);
  await page.goto("/users");
  await expect(page.getByText("ليس لديك صلاحية لهذه الصفحة")).toBeVisible();
  await page.getByRole("button", { name: "أدوات العرض التجريبي" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "أدوات العرض التجريبي" }),
  ).toBeFocused();
});
test("Responsive screenshots, no page overflow, and print layout", async ({
  page,
}) => {
  await login(page, "u3");
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("نظرة عامة");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
    await page.goto("/orders");
    await expect(page.locator(".order-row").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/orders/o1");
    await expect(
      page.getByRole("heading", { name: "بيانات العميل والتسليم" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/detail-${width}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".review-radios").first()).toBeHidden();
  await expect(page.locator(".print-only").first()).toBeVisible();
  await page.screenshot({ path: "test-results/print.png", fullPage: true });
});
test("Admin edits preserve order history and master routes work", async ({
  page,
}) => {
  await login(page, "u9");
  await page.goto("/products");
  await page
    .getByRole("row")
    .filter({ hasText: "TR-0001" })
    .getByRole("button", { name: "تعديل" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "الاسم *", exact: true })
    .fill("عصير مانجو — اسم محدث");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("عصير مانجو — اسم محدث", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/orders/o1");
  await expect(
    page.getByText("عصير مانجو ٢٥٠ مل", { exact: true }),
  ).toBeVisible();
  for (const route of [
    "/customers",
    "/users",
    "/activity",
    "/inventory",
    "/profile",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByText("ليس لديك صلاحية لهذه الصفحة")).toHaveCount(0);
  }
  await page.goto("/orders/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "الطلب غير موجود" }),
  ).toBeVisible();
});
test("Failed save retains draft input and retry creates exactly one order", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "أدوات العرض التجريبي" }).click();
  await page.getByRole("button", { name: "فشل الحفظ التالي" }).click();
  await page.getByRole("link", { name: "إنشاء طلب جديد" }).click();
  await page.getByLabel("ملاحظات الطلب").fill("طلب بعد فشل الحفظ");
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "تعذر حفظ التجربة" }),
  ).toBeVisible();
  await expect(page.getByLabel("ملاحظات الطلب")).toHaveValue(
    "طلب بعد فشل الحفظ",
  );
  await page.getByRole("button", { name: "حفظ مسودة" }).click();
  await expect(page).toHaveURL(/orders\/[a-f0-9-]{36}$/);
  await expect(
    page.getByText("طلب بعد فشل الحفظ", { exact: true }),
  ).toBeVisible();
  await page.goto("/orders?tab=drafts");
  await expect(page.locator(".order-row")).toHaveCount(3);
});
