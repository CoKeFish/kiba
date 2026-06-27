import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type DashboardMode = "consumer" | "publisher";

const STORAGE_KEY = "kiba.dashboard.mode";

interface ModeContextValue {
  mode: DashboardMode;
  setMode: (m: DashboardMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DashboardMode>(() => {
    if (typeof window === "undefined") return "consumer";
    return (localStorage.getItem(STORAGE_KEY) as DashboardMode) || "consumer";
  });

  const setMode = (m: DashboardMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be inside ModeProvider");
  return ctx;
}
