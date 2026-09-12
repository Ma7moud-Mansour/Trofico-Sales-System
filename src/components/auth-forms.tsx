"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { auth } from "@/services/http";
export function LoginFields({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onLogin(username, password);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        اسم المستخدم
        <input
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        كلمة المرور
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <Button disabled={busy} type="submit">
        {busy ? "جارٍ تسجيل الدخول…" : "دخول إلى النظام"}
      </Button>
    </form>
  );
}
export function PasswordForm({
  required = false,
  onDone,
}: {
  required?: boolean;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel padded">
      <h2>{required ? "تغيير كلمة المرور مطلوب" : "تغيير كلمة المرور"}</h2>
      <p>
        استخدم عبارة مرور من 12 إلى 128 حرفًا. تُلغى الجلسات الحالية بعد
        التغيير.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await auth.changePassword(current, next);
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          كلمة المرور الحالية
          <input
            autoComplete="current-password"
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          كلمة المرور الجديدة
          <input
            autoComplete="new-password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          حفظ كلمة المرور
        </Button>
      </form>
    </section>
  );
}
