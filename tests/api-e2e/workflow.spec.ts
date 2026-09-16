import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const accounts: {
  id: string;
  username: string;
  password: string;
  role: string;
}[] = JSON.parse(readFileSync(".runtime/test-accounts.json", "utf8"));
async function login(page: Page, role: string) {
  await page.goto("/login");
  const a = accounts.find((a) => a.role === role)!;
  await page.getByLabel("اسم المستخدم", { exact: true }).fill(a.username);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(a.password);
  await page
    .getByRole("button", { name: "دخول إلى النظام", exact: true })
    .click();
  await expect(page.locator("main h1")).toHaveText("نظرة عامة");
}
async function switchUser(page: Page, role: string) {
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await login(page, role);
}
async function confirm(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
test("One-time account setup, forced password form and admin reset work in UI", async ({
  page,
}) => {
  await login(page, "SUPER_ADMIN");
  await page.goto("/users");
  await page.getByRole("button", { name: "إضافة سجل" }).click();
  const username = "ui-" + randomUUID();
  await page
    .getByRole("dialog")
    .getByLabel("الاسم *", { exact: true })
    .fill("مستخدم اختبار واجهة");
  await page
    .getByRole("dialog")
    .getByLabel("اسم الدخول *", { exact: true })
    .fill(username);
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  const secretDialog = page.getByRole("dialog", {
    name: "كلمة المرور المؤقتة",
  });
  await expect(secretDialog).toBeVisible();
  const temporary = (await secretDialog.locator("pre").textContent())!;
  await secretDialog
    .getByRole("button", { name: "إغلاق", exact: true })
    .click();
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("اسم المستخدم", { exact: true }).fill(username);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "دخول إلى النظام" }).click();
  await expect(
    page.getByRole("heading", { name: "تغيير كلمة المرور مطلوب" }),
  ).toBeVisible();
  await page.getByLabel("كلمة المرور الحالية").fill(temporary);
  const next = randomUUID() + "!";
  await page.getByLabel("كلمة المرور الجديدة").fill(next);
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(
    page.getByRole("button", { name: "دخول إلى النظام" }),
  ).toBeVisible();
  await login(page, "SUPER_ADMIN");
  await page.goto("/users");
  const row = page.getByRole("row").filter({ hasText: username });
  await row.getByRole("button", { name: "إعادة ضبط كلمة المرور" }).click();
  await page.getByRole("button", { name: "تأكيد إعادة الضبط" }).click();
  await expect(secretDialog).toBeVisible();
  expect(await secretDialog.locator("pre").textContent()).not.toBe(temporary);
});
test("Lost response after database commit retains draft inputs and retry creates one order", async ({
  page,
}) => {
  await login(page, "SALES_REP");
  await page.goto("/orders/new");
  let savedId = "";
  let lost = false;
  await page.route("**/api/v1/orders", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      savedId = (await response.json()).data.id;
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "حفظ مسودة", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "تعذر الاتصال بخدمة المبيعات" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "حفظ مسودة", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/orders/" + savedId + "$"));
  expect(lost).toBe(true);
});
test("B28 B29 production UI using real sessions and PostgreSQL through all roles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "SALES_REP");
  await expect(
    page.getByRole("button", { name: "أدوات العرض التجريبي" }),
  ).toHaveCount(0);
  await page.goto("/orders/new");
  await page
    .getByRole("combobox", { name: "العميل *", exact: true })
    .selectOption({ index: 1 });
  for (const sku of ["MAN-01", "ORG-01"]) {
    const picker = page.getByRole("combobox", { name: "الصنف", exact: true });
    const value = await picker
      .getByRole("option")
      .filter({ hasText: sku })
      .getAttribute("value");
    await picker.selectOption(value!);
    await page.getByRole("button", { name: "إضافة صنف", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "إرسال للمراجعة", exact: true })
    .click();
  await page
    .getByRole("button", { name: "تأكيد الإرسال", exact: true })
    .click();
  await expect(page).toHaveURL(/orders\/[a-f0-9-]{36}$/);
  const url = page.url();
  await switchUser(page, "FINANCE");
  await page.goto(url);
  await page
    .getByRole("button", { name: "أوصي بالموافقة", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(/ملاحظة الحسابات/)
    .fill("الحسابات توصي بالتنفيذ");
  await confirm(page);
  await switchUser(page, "SALES_MANAGER");
  await page.goto(url);
  await page.getByRole("radio", { name: "اعتماد الصنف" }).first().check();
  await page.getByRole("radio", { name: "رفض الصنف" }).nth(1).check();
  await page.getByRole("textbox", { name: /سبب رفض/ }).fill("غير مناسب للعميل");
  await page
    .getByRole("button", { name: "إنهاء المراجعة", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByText("اعتماد جزئي", { exact: true }).first(),
  ).toBeVisible();
  await switchUser(page, "WAREHOUSE_MANAGER");
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
    .selectOption(accounts.find((a) => a.role === "DRIVER")!.id);
  await confirm(page);
  await page
    .getByRole("button", { name: "تسليم الطلب للسائق", exact: true })
    .click();
  await confirm(page);
  await switchUser(page, "DRIVER");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page
    .getByRole("textbox", { name: "المستلم في نموذج الهاتف" })
    .fill("مستلم اختبار الباك إند");
  await page
    .getByRole("button", { name: "تأكيد التسليم", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByText("تم التسليم", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/api-mobile-delivered.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await switchUser(page, "FINANCE");
  await page.goto(url);
  await page.reload();
  await expect(
    page.getByText("تم الاستلام بواسطة مستلم اختبار الباك إند"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("trofico-sales-v1")),
  ).toBeNull();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/api-finance-delivered.png",
    fullPage: true,
  });
});
test("Admin screens use real data; warehouse receipt waits for finance approval", async ({
  page,
}) => {
  await login(page, "SUPER_ADMIN");
  for (const path of [
    "/customers",
    "/products",
    "/users",
    "/activity",
    "/profile",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
  }
  await switchUser(page, "WAREHOUSE_MANAGER");
  await page.goto("/inventory");
  await page.getByRole("button", { name: "تسجيل وارد جديد" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "الصنف", exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("dialog")
    .getByLabel("الكمية الواردة", { exact: true })
    .fill("2");
  await page
    .getByRole("dialog")
    .getByLabel("رقم الإذن / المورد / المرجع", { exact: true })
    .fill("استلام اختبار واجهة");
  await page.getByRole("button", { name: "إرسال للموافقة" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("بانتظار الحسابات", { exact: true }).first(),
  ).toBeVisible();
  await switchUser(page, "FINANCE");
  await page.goto("/inventory");
  const row = page.getByRole("row").filter({ hasText: "استلام اختبار واجهة" });
  await row.getByRole("button", { name: "اعتماد", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "تأكيد الاعتماد", exact: true })
    .click();
  await expect(
    page
      .getByRole("cell", { name: "استلام اختبار واجهة", exact: true })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/api-inventory.png",
    fullPage: true,
  });
});
