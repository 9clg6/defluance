"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, fr, type Key } from "./dict";

export type Lang = "en" | "fr";
const DICTS: Record<Lang, Record<Key, string>> = { en, fr };

const detect = (): Lang => {
  try {
    const saved = localStorage.getItem("dfl-lang");
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // storage unavailable
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
};

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** Label for a vocabulary value (`status` + `draft`). Unknown values are shown as they are. */
  tr: (kind: "status" | "type" | "link" | "role" | "perm", value: string) => string;
}

const Ctx = createContext<I18n>({ lang: "en", setLang: () => undefined, t: (k) => en[k], tr: (_k, v) => v });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const l = detect();
    setLangState(l);
    document.documentElement.lang = l;
  }, []);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem("dfl-lang", l);
    } catch {
      // the choice lasts for this page only
    }
    document.documentElement.lang = l;
    setLangState(l);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    return {
      lang,
      setLang,
      t: (key, vars) => (dict[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`)),
      tr: (kind, value) => (dict[`${kind}.${value}` as Key] as string | undefined) ?? value,
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
