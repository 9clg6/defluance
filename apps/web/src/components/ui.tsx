"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Alert as ArcAlert } from "@/components/arc/alert/alert";
import { Badge as ArcBadge } from "@/components/arc/badge/badge";
import { Button as ArcButton } from "@/components/arc/button/button";
import { Skeleton as ArcSkeleton } from "@/components/arc/skeleton/skeleton";
import { cn } from "@/lib/utils";

// The building blocks of the UI. Buttons, badges, dialogs and tabs are Arc UI (https://uiarc.dev) components, wearing our
// colours through components/arc/arc-theme.css. Text fields stay native elements: they are what browsers, screen readers
// and password managers know best, and they carry the same Arc look.

const buttonVariants = { default: "primary", outline: "secondary", ghost: "ghost", destructive: "danger" } as const;
const buttonSizes = { sm: "sm", md: "md", icon: "md" } as const;

export const Button = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> & { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes; loading?: boolean }>(
  ({ className, variant = "default", size = "md", type = "button", ...p }, ref) => (
    <ArcButton ref={ref} type={type} variant={buttonVariants[variant]} size={buttonSizes[size]} className={cn(size === "icon" && "!px-0 aspect-square", className)} {...p} />
  ),
);
Button.displayName = "Button";

const field = "w-full rounded-[var(--arc-radius-control)] border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground shadow-[var(--arc-shadow-resting)] transition-colors hover:border-[var(--arc-border-strong)] focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--arc-focus-ring)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-11", className)} {...p} />);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-24 py-2.5", className)} {...p} />);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-11 w-auto pr-8", className)} {...p} />);
Select.displayName = "Select";

export function Label({ className, ...p }: HTMLAttributes<HTMLLabelElement> & { htmlFor?: string }) {
  return <label className={cn("mb-1 block text-sm font-medium", className)} {...p} />;
}

export function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const badgeTones = { muted: "neutral", primary: "info", success: "success", warning: "warning", destructive: "danger" } as const;

export function Badge({ className, tone = "muted", children, ...p }: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & { tone?: keyof typeof badgeTones; children?: ReactNode }) {
  return (
    <ArcBadge tone={badgeTones[tone]} size="sm" className={className} {...p}>
      {children}
    </ArcBadge>
  );
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--arc-radius-control)] border bg-card p-4 shadow-[var(--arc-shadow-resting)]", className)} {...p} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</kbd>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-[var(--arc-radius-control)] border-2 border-destructive px-3.5 py-2.5 text-sm text-destructive">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- dialog and tabs (Arc UI)

export { Dialog, DialogClose, DialogTrigger } from "@/components/arc/dialog/dialog";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
export { DialogContent } from "@/components/arc/dialog/dialog";

// ---------------------------------------------------------------- page states (Arc UI)

/** A page-level error: Arc alert, role=alert. Dialogs and forms keep ErrorBox. */
export function PageAlert({ title, children }: { title: string; children?: ReactNode }) {
  return <ArcAlert tone="danger" title={title}>{children}</ArcAlert>;
}

/** A page-level placeholder while data loads (role=status, named by `label`). */
export function PageSkeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return <ArcSkeleton label={label} lines={lines} />;
}

export { EmptyState } from "@/components/arc/empty-state/empty-state";
