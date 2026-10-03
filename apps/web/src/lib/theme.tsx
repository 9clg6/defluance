"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
const Ctx = createContext<{ theme: Theme; dark: boolean; setTheme: (t: Theme) => void }>({ theme: "system", dark: false, setTheme: () => undefined });

const read = (): Theme => {
  try {
    const v = localStorage.getItem("dfl-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [dark, setDark] = useState(false);

  const apply = useCallback((t: Theme) => {
    const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
  }, []);

  useEffect(() => {
    const t = read();
    setThemeState(t);
    apply(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [apply]);

  const setTheme = useCallback(
    (t: Theme) => {
      try {
        localStorage.setItem("dfl-theme", t);
      } catch {
        // storage unavailable: the choice lasts for this page only
      }
      setThemeState(t);
      apply(t);
    },
    [apply],
  );

  return <Ctx.Provider value={{ theme, dark, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Runs before first paint to avoid a flash of the wrong theme. */
export const themeScript = `try{var t=localStorage.getItem("dfl-theme");if(t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;
