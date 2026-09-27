"use client";
import { BookOpen, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui";

export type Theme = "light" | "dark" | "sepia";

function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "sepia" ? t : "light";
}

/** The pre-paint script in layout.tsx sets data-theme; this keeps React in sync after mount. */
export function useTheme(): [Theme | null, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the theme applied before hydration
    setThemeState(readTheme());
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("als-theme", JSON.stringify(t));
    } catch {
      /* storage unavailable */
    }
    setThemeState(t);
  };
  return [theme, setTheme];
}

export function ThemeToggle({ withSepia = false }: { withSepia?: boolean }) {
  const [theme, setTheme] = useTheme();
  const current = theme ?? "light";
  const order: Theme[] = withSepia ? ["light", "sepia", "dark"] : ["light", "dark"];
  const next = order[(order.indexOf(current) + 1) % order.length] ?? "light";
  return (
    <IconButton label={`Switch to ${next} mode`} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Moon className="size-4" /> : theme === "sepia" ? <BookOpen className="size-4" /> : <Sun className="size-4" />}
    </IconButton>
  );
}
