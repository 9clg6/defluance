"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import ArcToast from "@/components/arc/toast/toast";

interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;
  open: boolean;
}

const Ctx = createContext<{ toast: (kind: Toast["kind"], text: string) => void }>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    setItems((x) => [...x, { id: Date.now() + Math.random(), kind, text, open: true }]);
  }, []);
  // closing keeps the toast mounted for its exit animation, then drops it
  const close = useCallback((id: number) => {
    setItems((x) => x.map((t) => (t.id === id ? { ...t, open: false } : t)));
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 600);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {/* each Arc toast is its own polite live region (role=status) */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 [&>*]:pointer-events-auto">
        {items.map((t) => (
          <ArcToast key={t.id} tone={t.kind} title={t.text} open={t.open} onOpenChange={(o) => !o && close(t.id)} duration={t.kind === "error" ? 8000 : 4000} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx).toast;
