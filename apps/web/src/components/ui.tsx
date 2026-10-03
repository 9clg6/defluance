"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonBase = "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
const variants = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border bg-card hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-destructive text-background hover:opacity-90",
} as const;
const sizes = { sm: "h-8 px-3", md: "h-9 px-4", icon: "h-9 w-9" } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }>(
  ({ className, variant = "default", size = "md", type = "button", ...p }, ref) => <button ref={ref} type={type} className={cn(buttonBase, variants[variant], sizes[size], className)} {...p} />,
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("h-9 w-full rounded-lg border bg-card px-3 text-sm placeholder:text-muted-foreground", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-24 w-full rounded-lg border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn("h-9 rounded-lg border bg-card px-2 text-sm", className)} {...p} />
));
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

export function Badge({ className, tone = "muted", ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "primary" | "success" | "warning" | "destructive" }) {
  const tones = {
    muted: "bg-muted text-foreground",
    primary: "bg-accent text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
  };
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />;
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card p-4", className)} {...p} />;
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
    <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- dialog

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, closeLabel = "Close" }: { title: string; description?: string; children: ReactNode; className?: string; closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content className={cn("fixed left-1/2 top-[8vh] z-50 max-h-[84vh] w-[min(92vw,34rem)] -translate-x-1/2 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl", className)}>
        <DialogPrimitive.Title className="font-heading text-lg font-semibold">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 hover:bg-muted" aria-label={closeLabel}>
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ---------------------------------------------------------------- tabs

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn("flex gap-1 overflow-x-auto border-b", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: TabsPrimitive.TabsTriggerProps) {
  return <TabsPrimitive.Trigger className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground", className)} {...p} />;
}
export const TabsContent = TabsPrimitive.Content;
