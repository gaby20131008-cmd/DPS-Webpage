import { createContext, useContext, useEffect, useState } from "react";
import { api, DEFAULT_SITE_CONFIG, type SiteConfig, type Stats } from "./api";

type SiteCtx = { config: SiteConfig; stats?: Stats; mode: "dark" | "light"; toggleMode: () => void; reload: () => void };
const Ctx = createContext<SiteCtx>({ config: DEFAULT_SITE_CONFIG, mode: "dark", toggleMode: () => {}, reload: () => {} });
export const useSite = () => useContext(Ctx);

const initialMode = (): "dark" | "light" => {
  const saved = localStorage.getItem("bcso-mode");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [stats, setStats] = useState<Stats>();
  const [mode, setMode] = useState(initialMode);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<{ config: SiteConfig; stats: Stats }>("/api/site")
      .then((d) => {
        setConfig(d.config);
        setStats(d.stats);
      })
      .catch(() => {});
  }, [tick]);

  useEffect(() => {
    document.documentElement.dataset.theme = config.theme || "gold";
  }, [config.theme]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    localStorage.setItem("bcso-mode", mode);
  }, [mode]);

  return (
    <Ctx.Provider value={{ config, stats, mode, toggleMode: () => setMode((m) => (m === "dark" ? "light" : "dark")), reload: () => setTick((t) => t + 1) }}>
      {children}
    </Ctx.Provider>
  );
}
