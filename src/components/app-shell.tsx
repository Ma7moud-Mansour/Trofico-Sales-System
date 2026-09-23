"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  Warehouse,
  Truck,
  Users,
  Boxes,
  ContactRound,
  ReceiptText,
  History,
  UserRound,
  LogOut,
  Menu,
  RefreshCw,
  ArrowUpLeft,
  FlaskConical,
  PackageCheck,
  Search,
  MapPinned,
} from "lucide-react";
import { services, subscribe, demo, mockEnabled } from "@/services";
import { can, routePermissions, needsAction } from "@/domain/policies";
import { type User, type ViewData } from "@/domain/types";
import { ar, roleLabels, formatDate } from "@/messages/ar";
import { useWorkspace } from "@/features/orders/hooks";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Loading } from "./shared";
import { LoginFields, PasswordForm } from "./auth-forms";
const nav = [
  ["/dashboard", "نظرة عامة", LayoutDashboard],
  ["/orders", "الطلبات والمتابعة", ClipboardList],
  ["/finance", "مراجعة الحسابات", ReceiptText],
  ["/approvals", "مراجعات الإدارة", ShieldCheck],
  ["/warehouse", "تجهيز المخزن", Warehouse],
  ["/inventory", "أرصدة المخزون", Boxes],
  ["/logistics", "الحركة والتوصيل", Truck],
  ["/my-deliveries", "توصيلاتي", Truck],
  ["/customers", "العملاء", ContactRound],
  ["/areas", "المناطق", MapPinned],
  ["/products", "المنتجات", PackageCheck],
  ["/users", "المستخدمون", Users],
  ["/activity", "سجل العمليات", History],
  ["/profile", "الملف الشخصي", UserRound],
] as const;
export const titles = Object.fromEntries(nav.map(([p, t]) => [p, t]));
const Context = createContext<{
  data: ViewData;
  refresh: () => void;
  toast: (message: string) => void;
} | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw Error("Workspace provider missing");
  return c;
}
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 10000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Shell>{children}</Shell>
    </QueryClientProvider>
  );
}
function Shell({ children }: { children: ReactNode }) {
  const path = usePathname(),
    router = useRouter(),
    params = useSearchParams(),
    client = useQueryClient();
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [accounts, setAccounts] = useState<User[]>([]),
    [chosen, setChosen] = useState("u1"),
    [menu, setMenu] = useState(false),
    [tools, setTools] = useState(false),
    [reset, setReset] = useState(false),
    [notice, setNotice] = useState(""),
    [initError, setInitError] = useState(""),
    [online, setOnline] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const query = useWorkspace(user);
  useEffect(() => {
    if (user && query.data && query.data.user.id !== user.id) {
      const next = query.data.user;
      client.clear();
      setUser(next);
    }
  }, [query.data, user, client]);
  useEffect(() => {
    void (async () => {
      try {
        setAccounts(services.session.accounts());
        setUser(await services.session.current());
      } catch (e) {
        setInitError((e as Error).message);
      }
      setReady(true);
    })();
    setOnline(navigator.onLine);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const unsub = subscribe(() => {
      client.invalidateQueries();
      try {
        setAccounts(services.session.accounts());
      } catch {}
    });
    const expired = () => {
      client.clear();
      setUser(null);
    };
    const secret = (e: Event) =>
      setTemporaryPassword((e as CustomEvent<string>).detail);
    window.addEventListener("sales-session-expired", expired);
    window.addEventListener("sales-temporary-password", secret);
    return () => {
      unsub();
      window.removeEventListener("sales-session-expired", expired);
      window.removeEventListener("sales-temporary-password", secret);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, [client]);
  useEffect(() => {
    if (ready && !user && path !== "/login")
      router.replace(
        `/login?returnTo=${encodeURIComponent(path + (params.size ? "?" + params.toString() : ""))}`,
      );
  }, [ready, user, path, router, params]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(id);
  }, [notice]);
  async function login(id: string, password = "") {
    try {
      setInitError("");
      client.clear();
      const u = await services.session.login(id, password);
      setUser(u);
      setMenu(false);
      const destination = params.get("returnTo");
      router.replace(
        destination?.startsWith("/") && !destination.startsWith("//")
          ? destination
          : "/dashboard",
      );
    } catch (e) {
      setInitError((e as Error).message);
    }
  }
  const toast = (s: string) => setNotice(s);
  if (!ready)
    return (
      <main className="boot">
        <Loading />
      </main>
    );
  if (path === "/login" || !user)
    return (
      <main className="login-page">
        <section className="login-story">
          <div className="brand">
            <span className="brand-icon">
              <Image
                className="brand-logo"
                src="/trofico-logo.svg"
                alt="شعار تروفيكو فارما"
                width={55}
                height={55}
                priority
              />
            </span>
            <div>
              <b>تروفيكو فارما</b>
              <small>نظام إدارة المبيعات</small>
            </div>
          </div>
          <div>
            <span className="eyebrow">كل خطوة واضحة. كل طلب في مكانه.</span>
            <h1>
              فريق واحد.
              <br />
              دورة مبيعات متكاملة.
            </h1>
            <p>
              من المندوب إلى الإدارة والمخزن والحركة؛ تابع رحلة الطلب بالكامل في
              مساحة عمل واحدة.
            </p>
            <div className="login-stages">
              <span>
                <ClipboardList /> طلب
              </span>
              <span>
                <ShieldCheck /> اعتماد
              </span>
              <span>
                <Warehouse /> تجهيز
              </span>
              <span>
                <Truck /> توصيل
              </span>
            </div>
          </div>
          <small>
            {mockEnabled
              ? "واجهة تجريبية · بيانات محلية لأغراض العرض"
              : "من الطلب إلى التسليم، كل خطوة واضحة"}
          </small>
        </section>
        <section className="login-card">
          {mockEnabled && <span className="badge partial">{ar.demo}</span>}
          <h2>أهلًا بك في مساحة العمل</h2>
          <p className="muted">
            {mockEnabled
              ? "اختر حسابًا لتجربة النظام والصلاحيات الخاصة بكل فريق."
              : "سجّل الدخول بحسابك لمتابعة العمل."}
          </p>
          {initError && <div className="alert error">{initError}</div>}
          {!mockEnabled ? (
            <LoginFields onLogin={login} />
          ) : (
            <>
              <label>
                الحساب التجريبي
                <select
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {accounts.map((u) => (
                    <option value={u.id} key={u.id}>
                      {u.name} — {u.roles.map((r) => roleLabels[r]).join("، ")}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                onClick={() => login(chosen)}
                disabled={!mockEnabled || !accounts.length}
              >
                الدخول للتجربة <ArrowUpLeft size={18} />
              </Button>
              <div className="login-note">
                <ShieldCheck size={20} />
                <p>
                  لا تحتاج إلى كلمة مرور. يمكنك تبديل الحسابات أثناء التجربة مع
                  الاحتفاظ بالطلبات.
                </p>
              </div>
            </>
          )}
          <small className="muted">للمساعدة، تواصل مع مدير النظام.</small>
        </section>
      </main>
    );
  if (user.mustChangePassword)
    return (
      <main className="boot">
        <PasswordForm
          required
          onDone={() => {
            client.clear();
            setUser(null);
            router.replace("/login");
          }}
        />
      </main>
    );
  const permitted =
    !routePermissions[path] || can(user, ...routePermissions[path]);
  const links = (
    <>
      <div className="nav-group-label">مساحة العمل</div>
      {nav
        .filter(
          ([p]) => !routePermissions[p] || can(user, ...routePermissions[p]),
        )
        .map(([p, title, Icon]) => (
          <Link
            key={p}
            href={p}
            onClick={() => setMenu(false)}
            className={`nav-link ${path === p || (p === "/orders" && path.startsWith("/orders/")) ? "active" : ""}`}
          >
            <Icon size={19} />
            <span>{title}</span>
            {p === "/orders" && query.data && (
              <span className="nav-count">{query.data.orders.length}</span>
            )}
          </Link>
        ))}
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <Link href="/dashboard" className="brand">
          <span className="brand-icon">
            <Image
              className="brand-logo"
              src="/trofico-logo.svg"
              alt="شعار تروفيكو فارما"
              width={42}
              height={42}
              priority
            />
          </span>
          <div>
            <b>تروفيكو فارما</b>
            <small>إدارة طلبات المبيعات</small>
          </div>
        </Link>
        <div className="workspace-label">
          <span className="online-dot" /> مساحة العمل الرئيسية
        </div>
        <nav>{links}</nav>
        <div className="sidebar-bottom">
          <Link className="sidebar-account" href="/profile">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.roles.map((r) => roleLabels[r]).join("، ")}</small>
            </span>
          </Link>
          {mockEnabled && (
            <>
              <div className="demo-callout">
                <FlaskConical size={18} />
                <div>
                  <strong>تجربة النظام</strong>
                  <small>البيانات محفوظة على هذا المتصفح</small>
                </div>
              </div>
              <Button variant="ghost" onClick={() => setTools(true)}>
                أدوات العرض التجريبي
              </Button>
            </>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar no-print">
          <div className="topbar-title">
            <button
              className="icon-button mobile-only"
              aria-label="فتح القائمة"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <span className="muted">مساحة العمل</span>
            <span className="separator">/</span>
            <strong>{titles[path] ?? "تفاصيل الطلب"}</strong>
          </div>
          <div className="topbar-user">
            {mockEnabled && <span className="badge demo-badge">{ar.demo}</span>}
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div>
              <b>{user.name}</b>
              <small>{user.roles.map((r) => roleLabels[r]).join("، ")}</small>
            </div>
            <button
              className="icon-button"
              aria-label="تسجيل الخروج"
              onClick={async () => {
                try {
                  await services.session.logout();
                } catch (e) {
                  toast((e as Error).message);
                  return;
                }
                client.clear();
                setUser(null);
                router.replace("/login");
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/orders?search=${encodeURIComponent(globalSearch)}`);
            }}
          >
            <Search size={17} />
            <input
              aria-label="البحث العام في الطلبات"
              placeholder="البحث في الطلبات أو العملاء…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            <button type="submit" aria-label="تنفيذ البحث">
              بحث
            </button>
          </form>
        </header>
        <main className="workspace">
          <div className="workspace-status no-print">
            <Link href="/orders?tab=mine">
              <span className="online-dot" /> مطلوب مني{" "}
              <b>
                {query.data?.orders.filter((o) =>
                  needsAction(query.data.user, o),
                ).length ?? "…"}
              </b>
            </Link>
            <div>
              <span>
                {query.isFetching
                  ? "جارٍ التحديث…"
                  : `آخر تحديث ${query.dataUpdatedAt ? formatDate(new Date(query.dataUpdatedAt).toISOString()) : "—"}`}
              </span>
              <button
                aria-label="تحديث البيانات"
                className="icon-button"
                onClick={() => query.refetch()}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          {!online && (
            <div className="alert warning" role="status">
              {ar.offline}
            </div>
          )}
          {!permitted ? (
            <div className="panel empty">
              <ShieldCheck size={36} />
              <h1>403</h1>
              <h2>{ar.forbidden}</h2>
              <Link href="/orders">العودة إلى الطلبات</Link>
            </div>
          ) : query.isError && !query.data ? (
            <div className="alert error" role="alert">
              {query.error.message}
              <Button variant="outline" onClick={() => query.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : !query.data || query.data.user.id !== user.id ? (
            <Loading />
          ) : (
            <Context.Provider
              value={{
                data: query.data,
                refresh: () => query.refetch(),
                toast,
              }}
            >
              {query.isError && (
                <div role="alert" className="alert warning">
                  تعذر تحديث البيانات. المعروض آخر نسخة محفوظة.
                  <Button variant="outline" onClick={() => query.refetch()}>
                    إعادة المحاولة
                  </Button>
                </div>
              )}
              {children}
            </Context.Provider>
          )}
        </main>
        <footer className="footer no-print">
          <span>تروفيكو · إدارة طلبات المبيعات</span>
          <span>
            {mockEnabled
              ? "بيئة تجريبية — ليست بيانات تشغيل فعلية"
              : "تحديث تلقائي كل 15 ثانية أثناء عرض الصفحة"}
          </span>
        </footer>
      </div>
      <nav className="mobile-bottom-nav no-print" aria-label="التنقل السريع">
        {[
          ["/dashboard", "الرئيسية", LayoutDashboard],
          [
            can(user, "DELIVERY_CONFIRM") ? "/my-deliveries" : "/orders",
            can(user, "DELIVERY_CONFIRM") ? "مهامي" : "طلباتي",
            can(user, "DELIVERY_CONFIRM") ? Truck : ClipboardList,
          ],
          ["/profile", "حسابي", UserRound],
        ].map(([href, label, Icon]) => {
          const Component = Icon as typeof UserRound;
          return (
            <Link
              key={String(href)}
              href={String(href)}
              className={path === href ? "active" : ""}
            >
              <Component size={21} />
              <span>{String(label)}</span>
            </Link>
          );
        })}
      </nav>
      <Dialog
        open={menu}
        onOpenChange={setMenu}
        title="القائمة الرئيسية"
        variant="drawer"
      >
        <nav>{links}</nav>
        {mockEnabled && (
          <Button
            variant="outline"
            onClick={() => {
              setMenu(false);
              setTools(true);
            }}
          >
            أدوات العرض التجريبي
          </Button>
        )}
      </Dialog>
      <Dialog
        open={!!temporaryPassword}
        onOpenChange={() => setTemporaryPassword("")}
        title="كلمة المرور المؤقتة"
      >
        <p>
          تظهر مرة واحدة. سلّمها للمستخدم بطريقة آمنة؛ يجب تغييرها عند الدخول.
        </p>
        <pre dir="ltr">{temporaryPassword}</pre>
      </Dialog>
      <Dialog
        open={tools}
        onOpenChange={setTools}
        title="أدوات العرض التجريبي"
        description="هذه الأدوات لمحاكاة السيناريوهات فقط."
      >
        <div className="form-stack">
          {notice && (
            <p role="status" className="alert info">
              {notice}
            </p>
          )}
          <label>
            تبديل المستخدم
            <select value={user.id} onChange={(e) => login(e.target.value)}>
              {accounts.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {roleLabels[u.roles[0]]}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <Button
              variant="outline"
              onClick={() => {
                demo.failNext("network");
                toast("سيتم إفشال الطلب التالي");
                setTools(false);
              }}
            >
              فشل الطلب التالي
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                demo.failNext("conflict");
                toast("سيظهر تعارض في الإجراء التالي");
                setTools(false);
              }}
            >
              تعارض الإصدار التالي
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                demo.failNext("storage");
                toast("ستفشل محاولة الحفظ التالية");
                setTools(false);
              }}
            >
              فشل الحفظ التالي
            </Button>
          </div>
          <label>
            صنف لتجربة المخزون
            <select id="demo-product">
              {(query.data?.products.length
                ? query.data.products
                : query.data?.orders
                    .flatMap((o) => o.items.map((i) => i.productSnapshot))
                    .filter(
                      (p, i, a) => a.findIndex((x) => x.id === p.id) === i,
                    )
              )?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await demo.stock(
                    (
                      document.getElementById(
                        "demo-product",
                      ) as HTMLSelectElement
                    ).value,
                    0,
                  );
                  toast("أصبح المتاح صفرًا مع الحفاظ على الحجوزات");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              محاكاة نفاد المخزون
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await demo.stock(
                    (
                      document.getElementById(
                        "demo-product",
                      ) as HTMLSelectElement
                    ).value,
                    1000,
                  );
                  toast("تمت إضافة 1000 عبوة تجريبية");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              تزويد الرصيد التجريبي
            </Button>
          </div>
          <Button variant="destructive" onClick={() => setReset(true)}>
            إعادة ضبط البيانات
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={reset}
        onOpenChange={setReset}
        title="إعادة ضبط التجربة؟"
        description="ستحذف جميع تغييرات التجربة وتستعاد البيانات الأولية."
      >
        <Button
          variant="destructive"
          onClick={async () => {
            try {
              await demo.reset();
              setReset(false);
              toast("تمت إعادة ضبط البيانات");
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          تأكيد إعادة الضبط
        </Button>
      </Dialog>
      {notice && (
        <div role="status" className="toast">
          {notice}
        </div>
      )}
    </div>
  );
}
