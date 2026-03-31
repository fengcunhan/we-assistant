"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
];

export function Sidebar() {
  const pathname = usePathname();

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

      <div className="p-4 border-t border-pi-border">
        <div className="px-4 py-3 rounded-lg bg-pi-cream/80">
          <p className="text-xs text-pi-ink-muted">Vectorize</p>
          <div className="mt-1.5 h-1.5 bg-pi-border rounded-full overflow-hidden">
            <div
              className="h-full bg-pi-gold rounded-full animate-fill"
              style={{ width: "12%", animationDelay: "0.5s" }}
            />
          </div>
          <p className="mt-1 text-xs text-pi-ink-muted">
            24,000 / 200,000 vectors
          </p>
        </div>
      </div>
    </aside>
  );
}
