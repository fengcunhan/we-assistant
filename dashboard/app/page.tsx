"use client";

import { useEffect, useState } from "react";
import { PieChart } from "./components/pie-chart";
import { ActivityChart } from "./components/activity-chart";
import { useAuth } from "./components/auth-provider";

interface Operation {
  id: string;
  type: string;
  content: string;
  category: string;
  timestamp: number;
}

interface Stats {
  totalNotes: number;
  intentDistribution: { store: number; query: number; chat: number };
  recentActivity: Array<{ date: string; count: number }>;
  recentOperations: Operation[];
}

const EMPTY_STATS: Stats = {
  totalNotes: 0,
  intentDistribution: { store: 0, query: 0, chat: 0 },
  recentActivity: [],
  recentOperations: [],
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return "刚刚";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

export default function DashboardPage() {
  const { authFetch } = useAuth();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);

  useEffect(() => {
    authFetch("/api/stats")
      .then((res) => res.json())
      .then((data: Stats) =>
        setStats({
          ...EMPTY_STATS,
          ...data,
          recentOperations: data.recentOperations ?? [],
          recentActivity: data.recentActivity ?? [],
        }),
      )
      .catch(() => {});
  }, [authFetch]);

  const dist = stats.intentDistribution;
  const pieData = [
    { label: "Store", value: dist.store, color: "var(--pi-gold)" },
    { label: "Query", value: dist.query, color: "var(--pi-blue)" },
    { label: "Chat", value: dist.chat, color: "var(--pi-green)" },
  ];

  return (
    <div className="max-w-5xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          Your knowledge at a glance
        </p>
      </header>

      <div
        className="grid grid-cols-3 gap-4 mb-8 animate-fade-up"
        style={{ animationDelay: "0.1s" }}
      >
        <StatCard label="Total Notes" value={stats.totalNotes} />
        <StatCard label="Queries" value={dist.query} />
        <StatCard label="Stored" value={dist.store} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div
          className="bg-white/60 border border-pi-border rounded-xl p-6 card-hover animate-fade-up"
          style={{ animationDelay: "0.2s" }}
        >
          <h2 className="text-sm font-medium text-pi-ink-muted uppercase tracking-wider mb-4">
            Intent Distribution
          </h2>
          <PieChart data={pieData} />
        </div>

        <div
          className="bg-white/60 border border-pi-border rounded-xl p-6 card-hover animate-fade-up"
          style={{ animationDelay: "0.3s" }}
        >
          <h2 className="text-sm font-medium text-pi-ink-muted uppercase tracking-wider mb-4">
            7-Day Activity
          </h2>
          <ActivityChart data={stats.recentActivity} />
        </div>
      </div>

      <div
        className="bg-white/60 border border-pi-border rounded-xl p-6 animate-fade-up"
        style={{ animationDelay: "0.4s" }}
      >
        <h2 className="text-sm font-medium text-pi-ink-muted uppercase tracking-wider mb-4">
          Recent Operations
        </h2>
        <div className="space-y-3">
          {stats.recentOperations.length === 0 ? (
            <p className="text-sm text-pi-ink-muted py-2">暂无操作记录</p>
          ) : (
            stats.recentOperations.map((op) => (
              <div
                key={op.id}
                className="flex items-center gap-3 py-2 border-b border-pi-border/50 last:border-0"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    op.type === "store"
                      ? "bg-pi-gold"
                      : op.type === "query"
                      ? "bg-pi-blue"
                      : "bg-pi-green"
                  }`}
                />
                <span className="text-sm text-pi-ink-soft flex-1 truncate">
                  {op.content}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 tag-${op.category}`}
                >
                  {op.category}
                </span>
                <span className="text-xs text-pi-ink-muted tabular-nums whitespace-nowrap">
                  {formatRelativeTime(op.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/60 border border-pi-border rounded-xl p-5 card-hover">
      <p className="text-xs text-pi-ink-muted uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-pi-ink tabular-nums">
        {value}
      </p>
    </div>
  );
}
