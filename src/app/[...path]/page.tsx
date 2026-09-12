"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dashboard, OrdersList } from "@/features/orders/list";
import { OrderDetail } from "@/features/orders/detail";
import { OrderForm } from "@/features/orders/form";
import {
  MasterPage,
  InventoryPage,
  ActivityPage,
  ProfilePage,
} from "@/features/admin/pages";
export default function Page() {
  const path = usePathname();
  if (path === "/login") return null;
  if (path === "/dashboard") return <Dashboard />;
  if (
    [
      "/orders",
      "/approvals",
      "/warehouse",
      "/logistics",
      "/my-deliveries",
      "/finance",
    ].includes(path)
  )
    return <OrdersList />;
  if (path === "/orders/new") return <OrderForm />;
  if (/^\/orders\/[^/]+\/edit$/.test(path))
    return <OrderForm id={path.split("/")[2]} />;
  if (/^\/orders\/[^/]+$/.test(path))
    return <OrderDetail id={path.split("/")[2]} />;
  if (path === "/inventory") return <InventoryPage />;
  if (["/users", "/customers", "/products"].includes(path))
    return (
      <MasterPage kind={path.slice(1) as "users" | "customers" | "products"} />
    );
  if (path === "/activity") return <ActivityPage />;
  if (path === "/profile") return <ProfilePage />;
  return (
    <div className="empty">
      <h1>404</h1>
      <h2>الصفحة غير موجودة</h2>
      <Link href="/dashboard">العودة للرئيسية</Link>
    </div>
  );
}
