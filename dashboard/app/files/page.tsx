"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../components/auth-provider";

interface FileItem {
  id: number;
  content: string;
  media_path: string;
  signed_url: string | null;
  msg_type: number;
  timestamp: number;
}

const MSG_TYPE_LABELS: Record<number, string> = {
  2: "Image",
  3: "Voice",
  4: "Video",
  5: "File",
};

function fileTypeLabel(msgType: number) {
  return MSG_TYPE_LABELS[msgType] ?? "Other";
}

function fileTypeIcon(msgType: number) {
  switch (msgType) {
    case 2:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <circle cx="5" cy="7" r="1.5" />
          <path d="M15 11l-3.5-4L8 11l-2.5-2L1 14" />
        </svg>
      );
    case 3:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v12M5 5v6M11 4v8M3 7v2M13 6v4" />
        </svg>
      );
    case 4:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M6.5 6.5l3.5 2-3.5 2z" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
          <path d="M9 2v4h4" />
        </svg>
      );
  }
}

export default function FilesPage() {
  const { authFetch } = useAuth();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/files")
      .then((res) => res.json())
      .then((data) => setFiles(data.files ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authFetch]);

  return (
    <div className="max-w-4xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          Files
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          Media files stored from conversations
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-pi-ink-muted">Loading...</p>
      ) : files.length === 0 ? (
        <div className="bg-white/60 border border-pi-border rounded-xl p-12 text-center animate-fade-up">
          <p className="text-pi-ink-muted">No files yet</p>
        </div>
      ) : (
        <div className="space-y-2 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          {files.map((f) => (
            <a
              key={f.id}
              href={f.signed_url ?? f.media_path}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 px-4 py-3 bg-white/60 border border-pi-border rounded-xl card-hover transition-colors hover:border-pi-gold/40"
            >
              <span className="text-pi-ink-soft shrink-0">
                {fileTypeIcon(f.msg_type)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-pi-ink truncate">
                  {f.content || f.media_path.split("/").pop()}
                </span>
                <span className="block text-xs text-pi-ink-muted mt-0.5">
                  {new Date(f.timestamp).toLocaleString()} · {fileTypeLabel(f.msg_type)}
                </span>
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-pi-ink-muted shrink-0"
              >
                <path d="M5 3h8v8" />
                <path d="M13 3L3 13" />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
