"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "./auth-provider";

export interface BotInfo {
  botId: string;
  nickname: string;
  enabled: boolean;
  running: boolean;
  proactiveEnabled: boolean;
  proactiveUserId: string;
  boundAt: number;
}

interface BotContextValue {
  bots: BotInfo[];
  selectedBotId: string | null;
  selectBot: (botId: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}

const BotContext = createContext<BotContextValue | null>(null);

export function useBots() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error("useBots must be used within BotProvider");
  return ctx;
}

export function BotProvider({ children }: { children: ReactNode }) {
  const { authFetch, isAuthenticated } = useAuth();
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("pi_bot") : null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch("/api/wechat/bindings");
      const data = await res.json();
      const list: BotInfo[] = data.bindings ?? [];
      setBots(list);
      const stored = localStorage.getItem("pi_bot");
      if (list.length > 0 && (!stored || !list.some((b) => b.botId === stored))) {
        localStorage.setItem("pi_bot", list[0].botId);
        setSelectedBotId(list[0].botId);
      }
    } catch {
      // ignore — pages fall back to first bot server-side
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  const selectBot = useCallback((botId: string) => {
    localStorage.setItem("pi_bot", botId);
    setSelectedBotId(botId);
    // Reload so every page refetches scoped to the newly selected bot
    window.location.reload();
  }, []);

  return (
    <BotContext.Provider
      value={{ bots, selectedBotId, selectBot, refresh, loading }}
    >
      {children}
    </BotContext.Provider>
  );
}
