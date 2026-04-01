"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../components/auth-provider";

interface CronJob {
  id: string;
  name: string;
  user_id: string;
  schedule_kind: "at" | "every" | "cron";
  schedule_value: string;
  schedule_tz: string;
  payload: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_status: string | null;
  created_at: number;
  updated_at: number;
}

const KIND_LABELS: Record<string, string> = {
  at: "One-time",
  every: "Interval",
  cron: "Daily",
};

function formatSchedule(job: CronJob): string {
  if (job.schedule_kind === "at") return new Date(job.schedule_value).toLocaleString("zh-CN");
  if (job.schedule_kind === "every") {
    const ms = parseInt(job.schedule_value, 10);
    if (ms >= 3_600_000) return `Every ${Math.round(ms / 3_600_000)}h`;
    return `Every ${Math.round(ms / 60_000)}min`;
  }
  return job.schedule_value;
}

function formatTime(ms: number | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("zh-CN");
}

export default function SchedulesPage() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", payload: "", schedule_value: "" });

  const fetchJobs = useCallback(async () => {
    try {
      const res = await authFetch("/api/cron");
      const data = await res.json();
      if (data.jobs) setJobs(data.jobs);
    } catch {
      // keep current state
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const toggleEnabled = async (job: CronJob) => {
    const newEnabled = job.enabled ? 0 : 1;
    try {
      await authFetch(`/api/cron/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
    } catch {
      // update locally anyway
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, enabled: newEnabled } : j))
    );
  };

  const startEdit = (job: CronJob) => {
    setEditingId(job.id);
    setEditForm({ name: job.name, payload: job.payload, schedule_value: job.schedule_value });
  };

  const saveEdit = async (id: string) => {
    try {
      const res = await authFetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.job) {
        setJobs((prev) => prev.map((j) => (j.id === id ? data.job : j)));
      }
    } catch {
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, ...editForm } : j))
      );
    }
    setEditingId(null);
  };

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this scheduled task?")) return;
    try {
      await authFetch(`/api/cron/${id}`, { method: "DELETE" });
    } catch {
      // delete locally anyway
    }
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const enabledJobs = jobs.filter((j) => j.enabled);
  const disabledJobs = jobs.filter((j) => !j.enabled);

  return (
    <div className="max-w-4xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          Schedules
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          Manage scheduled reminders and tasks
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <StatCard label="Total" value={jobs.length} />
        <StatCard label="Active" value={enabledJobs.length} color="green" />
        <StatCard label="Disabled" value={disabledJobs.length} color="muted" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-pi-ink-muted text-sm">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-pi-ink-muted text-sm">
          No scheduled tasks. Create reminders via WeChat chat.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job, i) => (
            <div
              key={job.id}
              className={`bg-white/60 border border-pi-border rounded-xl p-5 card-hover animate-fade-up ${
                !job.enabled ? "opacity-60" : ""
              }`}
              style={{ animationDelay: `${0.15 + i * 0.05}s` }}
            >
              {editingId === job.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="Task name"
                    className="w-full p-2.5 bg-pi-cream border border-pi-border rounded-lg text-sm text-pi-ink focus:outline-none focus:ring-2 focus:ring-pi-gold/30"
                  />
                  <textarea
                    value={editForm.payload}
                    onChange={(e) => setEditForm({ ...editForm, payload: e.target.value })}
                    placeholder="Message content"
                    className="w-full p-2.5 bg-pi-cream border border-pi-border rounded-lg text-sm text-pi-ink resize-none focus:outline-none focus:ring-2 focus:ring-pi-gold/30"
                    rows={2}
                  />
                  <input
                    type="text"
                    value={editForm.schedule_value}
                    onChange={(e) => setEditForm({ ...editForm, schedule_value: e.target.value })}
                    placeholder={job.schedule_kind === "at" ? "2026-04-02T15:00:00" : job.schedule_kind === "cron" ? "09:00" : "3600000"}
                    className="w-full p-2.5 bg-pi-cream border border-pi-border rounded-lg text-sm text-pi-ink focus:outline-none focus:ring-2 focus:ring-pi-gold/30"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(job.id)}
                      className="px-4 py-1.5 bg-pi-gold text-white text-xs font-medium rounded-lg hover:bg-pi-gold/90"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-4 py-1.5 text-pi-ink-muted text-xs font-medium rounded-lg hover:bg-pi-sand"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${job.enabled ? "bg-pi-green" : "bg-pi-ink-muted/30"}`} />
                        <h3 className="text-sm font-medium text-pi-ink truncate">
                          {job.name}
                        </h3>
                      </div>
                      <p className="text-xs text-pi-ink-soft leading-relaxed ml-4">
                        {job.payload}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-pi-sand text-pi-ink-soft shrink-0">
                      {KIND_LABELS[job.schedule_kind] ?? job.schedule_kind}
                    </span>
                  </div>

                  <div className="mt-3 ml-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-pi-ink-muted">
                    <div>
                      <span className="text-pi-ink-muted/60">Schedule: </span>
                      <span className="tabular-nums">{formatSchedule(job)}</span>
                    </div>
                    <div>
                      <span className="text-pi-ink-muted/60">Next: </span>
                      <span className="tabular-nums">{formatTime(job.next_run_at)}</span>
                    </div>
                    <div>
                      <span className="text-pi-ink-muted/60">Last run: </span>
                      <span className="tabular-nums">{formatTime(job.last_run_at)}</span>
                    </div>
                    <div>
                      <span className="text-pi-ink-muted/60">Status: </span>
                      <span className={job.last_status === "ok" ? "text-pi-green" : job.last_status === "error" ? "text-pi-red" : ""}>
                        {job.last_status ?? "–"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-pi-ink-muted tabular-nums ml-4">
                      {job.user_id}
                    </span>
                    <div className="flex gap-1">
                      <ActionButton onClick={() => toggleEnabled(job)} label={job.enabled ? "Disable" : "Enable"}>
                        {job.enabled ? (
                          <path d="M3 3l10 10M8 4a4 4 0 014 4c0 .9-.3 1.7-.8 2.4M4.8 7.6A4 4 0 008 12a4 4 0 003.2-1.6" />
                        ) : (
                          <path d="M1 8a7 7 0 0114 0M5 8l2 2 4-4" />
                        )}
                      </ActionButton>
                      <ActionButton onClick={() => startEdit(job)} label="Edit">
                        <path d="M11 2l3 3-8 8H3v-3z" />
                      </ActionButton>
                      <ActionButton onClick={() => deleteJob(job.id)} label="Delete" danger>
                        <path d="M4 5h8M5 5v7a1 1 0 001 1h4a1 1 0 001-1V5M7 3h2" />
                      </ActionButton>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const textColor = color === "green" ? "text-pi-green" : color === "muted" ? "text-pi-ink-muted" : "text-pi-ink";
  return (
    <div className="bg-white/60 border border-pi-border rounded-xl p-4 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${textColor}`}>{value}</div>
      <div className="text-xs text-pi-ink-muted mt-1">{label}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 rounded-md transition-colors ${
        danger
          ? "text-pi-ink-muted hover:text-pi-red hover:bg-red-50"
          : "text-pi-ink-muted hover:text-pi-gold hover:bg-pi-gold-bg"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
