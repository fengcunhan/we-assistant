"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="7" height="8" rx="1.5" />
        <rect x="11" y="2" width="7" height="5" rx="1.5" />
        <rect x="2" y="12" width="7" height="6" rx="1.5" />
        <rect x="11" y="9" width="7" height="9" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/notes",
    label: "Notes",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
        <path d="M6 7h8M6 10h8M6 13h5" />
      </svg>
    ),
  },
  {
    href: "/files",
    label: "Files",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5a2 2 0 012-2h4l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
      </svg>
    ),
  },
  {
    href: "/wechat",
    label: "WeChat",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="8" r="4" />
        <circle cx="13" cy="8" r="4" />
        <path d="M5 12c0 3 2 5 5 5s5-2 5-5" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout, authFetch } = useAuth();
  const [vectorCount, setVectorCount] = useState<number | null>(null);

  useEffect(() => {
    authFetch("/api/stats")
      .then((res) => res.json())
      .then((data) => setVectorCount(data.vectorCount ?? null))
      .catch(() => {});
  }, [authFetch]);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-pi-sand/60 border-r border-pi-border flex flex-col z-50">
      <div className="p-6 border-b border-pi-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-pi-gold flex items-center justify-center">
            <span className="text-white font-bold text-lg" style={{ fontFamily: "Georgia, serif" }}>
              Pi
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-pi-ink tracking-tight">
              Pi Assistant
            </h1>
            <p className="text-xs text-pi-ink-muted tracking-wide uppercase">
              Knowledge Hub
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-pi-gold-bg text-pi-gold font-medium"
                  : "text-pi-ink-soft hover:bg-pi-cream hover:text-pi-ink"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-pi-border space-y-3">
        <div className="px-4 py-2 rounded-lg bg-pi-cream/80 flex items-center justify-between">
          <span className="text-xs text-pi-ink-muted">Vectors</span>
          <span className="text-sm font-medium text-pi-ink tabular-nums">
            {vectorCount !== null ? vectorCount.toLocaleString() : "–"}
          </span>
        </div>

        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm text-pi-ink-muted hover:bg-pi-cream hover:text-pi-red transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" />
            <path d="M14 14l3-4-3-4" />
            <path d="M17 10H8" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );
}
