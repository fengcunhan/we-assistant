"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../components/auth-provider";

const CATEGORIES = ["all", "work", "life", "idea", "meeting", "learning", "general"] as const;

interface Note {
  id: string;
  content: string;
  category: string;
  userId: string;
  timestamp: number;
  score?: number;
}

const DEMO_NOTES: Note[] = [
  { id: "note_1", content: "Q2 产品路线图会议：1) 优化向量检索性能 2) 新增多用户支持 3) 前端看板升级", category: "meeting", userId: "user1", timestamp: Date.now() - 120000 },
  { id: "note_2", content: "SiliconFlow BGE-M3 模型支持 1024 维向量，免费额度充足，适合个人项目", category: "learning", userId: "user1", timestamp: Date.now() - 3600000 },
  { id: "note_3", content: "周末去西湖边跑步，下午约朋友喝咖啡", category: "life", userId: "user1", timestamp: Date.now() - 7200000 },
  { id: "note_4", content: "想做一个基于语义搜索的菜谱推荐系统", category: "idea", userId: "user1", timestamp: Date.now() - 10800000 },
  { id: "note_5", content: "Cloudflare Vectorize 免费额度 20 万条向量，cosine 相似度最适合文本场景", category: "work", userId: "user1", timestamp: Date.now() - 18000000 },
  { id: "note_6", content: "记得给妈妈打电话问一下端午节安排", category: "life", userId: "user1", timestamp: Date.now() - 36000000 },
];

export default function NotesPage() {
  const { authFetch } = useAuth();
  const [notes, setNotes] = useState<Note[]>(DEMO_NOTES);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchNotes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("q", searchQuery);
      if (activeCategory !== "all") params.set("category", activeCategory);
      const res = await authFetch(`/api/notes?${params}`);
      const data = await res.json();
      if (data.notes?.length > 0) setNotes(data.notes);
    } catch {
      // Use demo data
    }
  }, [searchQuery, activeCategory, authFetch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const filtered =
    activeCategory === "all"
      ? notes
      : notes.filter((n) => n.category === activeCategory);

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const saveEdit = async (id: string) => {
    try {
      await authFetch(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
    } catch {
      // Update locally anyway
    }
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content: editContent } : n))
    );
    setEditingId(null);
  };

  const deleteNote = async (id: string) => {
    try {
      await authFetch(`/api/notes/${id}`, { method: "DELETE" });
    } catch {
      // Delete locally anyway
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const pushToWeChat = async (note: Note) => {
    try {
      const res = await authFetch("/api/gateway/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: note.userId, text: note.content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      alert("Pushed to WeChat!");
    } catch (err: any) {
      alert(`Push failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-4xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          Notes
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          Manage your knowledge base
        </p>
      </header>

      {/* Search */}
      <div className="mb-6 animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-pi-ink-muted"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            placeholder="Semantic search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchNotes()}
            className="w-full pl-10 pr-4 py-2.5 bg-white/60 border border-pi-border rounded-lg text-sm text-pi-ink placeholder:text-pi-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-pi-gold/30 focus:border-pi-gold"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div
        className="flex gap-2 mb-6 flex-wrap animate-fade-up"
        style={{ animationDelay: "0.15s" }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat
                ? "bg-pi-gold text-white"
                : "bg-white/60 text-pi-ink-soft border border-pi-border hover:bg-pi-sand"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Notes List */}
      <div className="space-y-3">
        {filtered.map((note, i) => (
          <div
            key={note.id}
            className="bg-white/60 border border-pi-border rounded-xl p-5 card-hover animate-fade-up"
            style={{ animationDelay: `${0.2 + i * 0.05}s` }}
          >
            {editingId === note.id ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full p-3 bg-pi-cream border border-pi-border rounded-lg text-sm text-pi-ink resize-none focus:outline-none focus:ring-2 focus:ring-pi-gold/30"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(note.id)}
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
                  <p className="text-sm text-pi-ink-soft leading-relaxed flex-1">
                    {note.content}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 tag-${note.category}`}>
                    {note.category}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-pi-ink-muted tabular-nums">
                    {new Date(note.timestamp).toLocaleString("zh-CN")}
                  </span>
                  <div className="flex gap-1">
                    <ActionButton onClick={() => startEdit(note)} label="Edit">
                      <path d="M11 2l3 3-8 8H3v-3z" />
                    </ActionButton>
                    <ActionButton onClick={() => pushToWeChat(note)} label="Push">
                      <path d="M5 4l6 4-6 4z" />
                    </ActionButton>
                    <ActionButton onClick={() => deleteNote(note.id)} label="Delete" danger>
                      <path d="M4 5h8M5 5v7a1 1 0 001 1h4a1 1 0 001-1V5M7 3h2" />
                    </ActionButton>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-pi-ink-muted text-sm">
          No notes found
        </div>
      )}
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
