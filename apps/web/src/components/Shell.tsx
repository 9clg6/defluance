"use client";

import { FileText, Languages, LogOut, Network, Plus, Search, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch";
import { Button, Kbd, PageSkeleton } from "@/components/ui";
import { CreateNote } from "@/components/CreateNote";
import { SearchPalette } from "@/components/SearchPalette";
import { StatusBanners } from "@/components/StatusBanners";
import { can, useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Shell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useAuth();
  const { t, lang, setLang } = useT();
  const { dark, setTheme } = useTheme();
  const pathname = usePathname() ?? "/";
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (pathname.startsWith("/login")) return <>{children}</>;
  if (loading || !me) {
    return (
      <div className="grid min-h-screen place-items-center">
        <PageSkeleton label={t("loading")} />
      </div>
    );
  }

  const nav = [
    { href: "/", label: t("nav.home"), icon: FileText, show: true },
    { href: "/search", label: t("search.page.title"), icon: Search, show: true },
    { href: "/graph", label: t("nav.graph"), icon: Network, show: true },
    { href: "/audit", label: t("nav.audit"), icon: ShieldCheck, show: me.spaces.some((s) => s.perms.includes("admin")) },
    { href: "/settings", label: t("nav.settings"), icon: Settings, show: true },
  ].filter((n) => n.show);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        {t("skip")}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-2 px-4 sm:gap-3">
          <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
            Defluance
          </Link>
          <nav aria-label={t("nav.label")} className="ml-2 hidden gap-1 sm:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm", active(n.href) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <n.icon className="size-4" aria-hidden />
                <span className="sr-only lg:not-sr-only lg:whitespace-nowrap">{n.label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} aria-label={t("search.open")} className="min-w-9 lg:min-w-60 lg:justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Search className="size-4" aria-hidden />
                <span className="hidden lg:inline">{t("search.placeholder")}</span>
              </span>
              <span className="hidden lg:inline">
                <Kbd>{isMac() ? "⌘" : "Ctrl"} K</Kbd>
              </span>
            </Button>
            {can(me, "write") && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                <span className="sr-only lg:not-sr-only lg:whitespace-nowrap">{t("note.new")}</span>
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setLang(lang === "en" ? "fr" : "en")} aria-label={t("lang.switch")} title={t("lang.switch")}>
              <Languages className="size-4" aria-hidden />
              <span className="sr-only">{lang === "en" ? "Français" : "English"}</span>
            </Button>
            <ThemeSwitch theme={dark ? "dark" : "light"} iconOnly label={t("theme.toggle")} onThemeChange={(next) => setTheme(next)} />
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label={t("auth.logout", { name: me.name })} title={t("auth.logout", { name: me.name })}>
              <LogOut className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        <nav aria-label={t("nav.label")} className="flex gap-1 overflow-x-auto border-t px-4 py-1 sm:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", active(n.href) ? "bg-muted font-medium" : "text-muted-foreground")}>
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <StatusBanners />
      <main id="main" className="mx-auto max-w-[88rem] px-4 py-6" tabIndex={-1}>
        {children}
      </main>
      <SearchPalette open={paletteOpen} onOpenChange={setPaletteOpen} onCreate={() => setCreateOpen(true)} />
      <CreateNote open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
