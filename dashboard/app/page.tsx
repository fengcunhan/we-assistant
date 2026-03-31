"use client";

import { useEffect, useState } from "react";
import { PieChart } from "./components/pie-chart";
import { ActivityChart } from "./components/activity-chart";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

interface Stats {
  totalNotes: number;
  intentDistribution: { store: number; query: number; chat: number };
  recentActivity: Array<{ date: string; count: number }>;
}

const DEMO_STATS: Stats = {
  totalNotes: 156,
  intentDistribution: { store: 89, query: 42, chat: 25 },
  recentActivity: [
    { date: "2026-03-24", count: 12 },
    { date: "2026-03-25", count: 8 },
    { date: "2026-03-26", count: 15 },
    { date: "2026-03-27", count: 6 },
    { date: "2026-03-28", count: 22 },
    { date: "2026-03-29", count: 18 },
    { date: "2026-03-30", count: 11 },
  ],
};

const DEMO_OPERATIONS = [
  { type: "store", content: "Q2 产品路线图会议纪要 - 三个核心优先级", category: "meeting", time: "2 分钟前" },
  { type: "query", content: "上周的 action items 是什么?", category: "work", time: "15 分钟前" },
  { type: "store", content: "关于边缘计算趋势的文章", category: "learning", time: "1 小时前" },
  { type: "chat", content: "你能帮我做什么?", category: "general", time: "2 小时前" },
  { type: "store", content: "生日聚会策划 - 场地和嘉宾名单", category: "life", time: "3 小时前" },
  { type: "query", content: "找一下关于 SiliconFlow API 的笔记", category: "work", time: "5 小时前" },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>(DEMO_STATS);

  useEffect(() => {
    fetch(`${API_BASE}/api/stats`)
      .then((res) => res.json())
      .then((data: Stats) => setStats(data))
      .catch(() => {});
  }, []);

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
          {DEMO_OPERATIONS.map((op, i) => (
            <div
              key={i}
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
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 tag-${op.category}`}>
                {op.category}
              </span>
              <span className="text-xs text-pi-ink-muted tabular-nums whitespace-nowrap">
                {op.time}
              </span>
            </div>
          ))}
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
