import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Providers } from "@/components/app-shell";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/500.css";
import "@fontsource/noto-sans-arabic/700.css";
import "./globals.css";
import "./reference-theme.css";
export const metadata: Metadata = {
  title: "تروفيكو | إدارة طلبات المبيعات",
  description: "واجهة عربية لمتابعة الطلبات والموافقات والمخزن والتوصيل",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Suspense fallback={<p>جارٍ تحميل مساحة العمل…</p>}>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
