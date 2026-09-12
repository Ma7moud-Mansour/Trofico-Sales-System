"use client";
import { useEffect } from "react";
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest("a");
      if (
        a &&
        a.getAttribute("href") &&
        !a.getAttribute("href")?.startsWith("#") &&
        !window.confirm("لديك تغييرات غير محفوظة. هل تريد المغادرة؟")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
}
