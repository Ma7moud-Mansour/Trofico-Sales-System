import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, id: string) {
  await page.goto("/login");
  await page.getByLabel("الحساب التجريبي").selectOption(id);
  await page.getByRole("button", { name: "الدخول للتجربة" }).click();
  await expect(page.locator("main h1")).toHaveText("نظرة عامة");
}
test("Reference layout: dispatch directly from board, assignment drawer, finance quantities", async ({
  page,
}) => {
  await login(page, "u6");
  await page.goto("/logistics");
  const row = page.getByRole("row").filter({ hasText: "SO-2026-00003" });
  await row.getByRole("button", { name: "تعيين سائق", exact: true }).click();
  await expect(page.locator(".drawer-content")).toBeVisible();
  await page
    .getByRole("combobox", { name: "السائق المحدد" })
    .selectOption("u7");
  await page.getByLabel("ملاحظات التحميل").fill("مراجعة سلامة الأصناف");
  await page.screenshot({
    path: "test-results/reference-assignment.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "حفظ التعيين" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await row.getByRole("button", { name: "بدء التوصيل" }).click();
  await page.getByRole("button", { name: "تأكيد الخروج" }).click();
  await expect(row.getByText("قيد التوصيل", { exact: true })).toBeVisible();
  await login(page, "u5");
  await page.goto("/finance");
  await expect(
    page.getByRole("columnheader", { name: "المعتمدة", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "تعيين سائق" })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/reference-finance.png",
    fullPage: true,
  });
});
test("Reference mobile: bottom navigation, delivery card and recipient validation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "u7");
  await page
    .getByRole("navigation", { name: "التنقل السريع" })
    .getByRole("link", { name: "مهامي" })
    .click();
  await expect(page.locator(".delivery-card").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/reference-driver-mobile.png",
    fullPage: true,
  });
  await page.goto("/orders/o4");
  await expect(
    page.getByRole("button", { name: "تأكيد التسليم", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("المستلم في نموذج الهاتف").fill("مستلم الهاتف");
  await page.getByLabel("ملاحظات التسليم في الهاتف").fill("تم فحص الشحنة");
  await page.screenshot({
    path: "test-results/reference-mobile-detail.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "تأكيد التسليم", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("تم الاستلام بواسطة مستلم الهاتف")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("Reference screen gallery: all roles, forms, drawers, audit event and responsive shell", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/login");
  await page.screenshot({
    path: "test-results/reference-login.png",
    fullPage: true,
  });
  for (const [id, path, name] of [
    ["u3", "/dashboard", "dashboard"],
    ["u1", "/orders/new", "new-order"],
    ["u3", "/orders/o1", "review"],
    ["u4", "/orders/o8", "warehouse"],
    ["u6", "/logistics", "logistics"],
    ["u9", "/customers", "customers"],
    ["u9", "/products", "products"],
    ["u9", "/users", "users"],
    ["u9", "/activity", "activity"],
    ["u9", "/profile", "profile"],
  ]) {
    await login(page, id);
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await page.screenshot({
      path: `test-results/reference-${name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/activity");
  await page
    .getByRole("button", { name: "عرض التفاصيل", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "تفاصيل العملية" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/reference-event.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await page.goto("/customers");
  await page.getByRole("button", { name: "إضافة سجل" }).click();
  await expect(page.locator(".drawer-content")).toBeVisible();
  await page.screenshot({
    path: "test-results/reference-customer-drawer.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/reference-dashboard-${width}.png`,
      fullPage: true,
    });
  }
});
