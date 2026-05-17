"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../components/auth-provider";
import { useBots, type BotInfo } from "../components/bot-provider";

type BindStep = "idle" | "loading" | "scanning" | "scanned" | "confirmed" | "error";

export default function WeChatPage() {
  const { authFetch } = useAuth();
  const { bots, refresh } = useBots();
  const [step, setStep] = useState<BindStep>("idle");
  const [qrContent, setQrContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startBind = async () => {
    setStep("loading");
    setErrorMsg("");
    setQrContent("");

    try {
      const res = await authFetch("/api/wechat/qrcode", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to get QR code");
      }

      const data = await res.json();
      setQrContent(data.qrcodeImgContent);
      setStep("scanning");

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await authFetch(
            `/api/wechat/qrcode/${data.qrcode}/status`,
          );
          const statusData = await statusRes.json();

          if (statusData.status === "confirmed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep("confirmed");
            await refresh();
          } else if (statusData.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep("error");
            setErrorMsg("QR code expired. Please try again.");
          } else if (
            statusData.status === "scaned" ||
            statusData.status === "scanned"
          ) {
            setStep("scanned");
          }
        } catch {
          // retry on network error
        }
      }, 2000);
    } catch (err) {
      setStep("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to start binding");
    }
  };

  const cancelBind = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep("idle");
    setQrContent("");
  };

  const removeBinding = async (botId: string) => {
    if (!confirm(`解绑 bot ${botId}? 该 bot 将停止收发消息（数据保留）。`)) return;
    try {
      await authFetch(`/api/wechat/bindings/${encodeURIComponent(botId)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          WeChat Bots
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          每个 bot 绑定一个微信号，数据互相隔离
        </p>
      </header>

      {/* Bind card */}
      <div
        className="bg-white/60 border border-pi-border rounded-xl p-6 mb-6 animate-fade-up"
        style={{ animationDelay: "0.1s" }}
      >
        {step === "idle" && (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-pi-green/10 flex items-center justify-center mx-auto mb-4">
              <svg
                width="28"
                height="28"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-pi-green"
              >
                <rect x="3" y="3" width="6" height="6" rx="1" />
                <rect x="11" y="3" width="6" height="6" rx="1" />
                <rect x="3" y="11" width="6" height="6" rx="1" />
                <circle cx="14" cy="14" r="3" />
              </svg>
            </div>
            <p className="text-sm text-pi-ink-soft mb-4">
              扫码绑定一个新的微信机器人
            </p>
            <button
              onClick={startBind}
              className="px-6 py-2.5 bg-pi-gold text-white text-sm font-medium rounded-lg hover:bg-pi-gold/90 transition-colors"
            >
              Add Bot (Generate QR)
            </button>
          </div>
        )}

        {step === "loading" && (
          <div className="text-center py-10">
            <div className="w-48 h-48 bg-pi-cream rounded-xl mx-auto flex items-center justify-center animate-pulse">
              <p className="text-sm text-pi-ink-muted">Loading...</p>
            </div>
          </div>
        )}

        {(step === "scanning" || step === "scanned") && qrContent && (
          <div className="text-center">
            <div className="inline-block p-4 bg-white rounded-xl border border-pi-border shadow-sm">
              <QRCodeSVG value={qrContent} size={200} level="M" />
            </div>
            <p className="mt-4 text-sm text-pi-ink-soft">
              {step === "scanned"
                ? "Scanned! Please confirm on your phone..."
                : "Open WeChat and scan this QR code"}
            </p>
            {step === "scanned" && (
              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-pi-green">
                <span className="w-2 h-2 rounded-full bg-pi-green animate-pulse" />
                Waiting for confirmation
              </div>
            )}
            <button
              onClick={cancelBind}
              className="mt-4 text-sm text-pi-ink-muted hover:text-pi-ink transition-colors block mx-auto"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "confirmed" && (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-pi-green/15 flex items-center justify-center mx-auto mb-4">
              <svg
                width="28"
                height="28"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-pi-green"
              >
                <path d="M5 10l3 3 7-7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-pi-green mb-2">
              新 bot 绑定成功！
            </p>
            <button
              onClick={() => {
                setStep("idle");
                setQrContent("");
              }}
              className="text-sm text-pi-ink-muted hover:text-pi-ink transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6">
            <div className="text-sm text-pi-red bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 max-w-xs mx-auto">
              {errorMsg}
            </div>
            <button
              onClick={() => {
                setStep("idle");
                setErrorMsg("");
              }}
              className="text-sm text-pi-ink-muted hover:text-pi-ink transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Bots list */}
      <div
        className="bg-white/60 border border-pi-border rounded-xl p-6 animate-fade-up"
        style={{ animationDelay: "0.2s" }}
      >
        <h2 className="text-sm font-medium text-pi-ink-muted uppercase tracking-wider mb-4">
          Bots ({bots.length})
        </h2>

        {bots.length === 0 ? (
          <p className="text-sm text-pi-ink-muted py-8 text-center">
            还没有绑定任何 bot
          </p>
        ) : (
          <div className="space-y-4">
            {bots.map((b) => (
              <BotCard
                key={b.botId}
                bot={b}
                onRemove={() => removeBinding(b.botId)}
                onSaved={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BotCard({
  bot,
  onRemove,
  onSaved,
}: {
  bot: BotInfo;
  onRemove: () => void;
  onSaved: () => Promise<void>;
}) {
  const { authFetch } = useAuth();
  const [pEnabled, setPEnabled] = useState(bot.proactiveEnabled);
  const [pUserId, setPUserId] = useState(bot.proactiveUserId);
  const [saving, setSaving] = useState(false);

  const dirty =
    pEnabled !== bot.proactiveEnabled || pUserId !== bot.proactiveUserId;

  const saveProactive = async () => {
    setSaving(true);
    try {
      await authFetch(
        `/api/wechat/bindings/${encodeURIComponent(bot.botId)}/proactive`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: pEnabled, userId: pUserId }),
        },
      );
      await onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-pi-border/60 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            bot.running ? "bg-pi-green" : "bg-pi-ink-muted/40"
          }`}
          title={bot.running ? "Running" : "Stopped"}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pi-ink truncate">
            {bot.nickname}
          </p>
          <p className="text-xs text-pi-ink-muted truncate">{bot.botId}</p>
        </div>
        <span className="text-xs text-pi-ink-muted tabular-nums whitespace-nowrap">
          {new Date(bot.boundAt).toLocaleDateString("zh-CN")}
        </span>
        <button
          onClick={onRemove}
          title="Unbind"
          className="p-1.5 rounded-md text-pi-ink-muted hover:text-pi-red hover:bg-red-50 transition-colors"
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
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-pi-border/40">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-pi-ink-soft">
            <input
              type="checkbox"
              checked={pEnabled}
              onChange={(e) => setPEnabled(e.target.checked)}
              className="accent-pi-gold"
            />
            主动聊天
          </label>
          <input
            type="text"
            placeholder="主动聊天目标 wxid"
            value={pUserId}
            onChange={(e) => setPUserId(e.target.value)}
            className="flex-1 max-w-xs px-3 py-1.5 bg-white/70 border border-pi-border rounded-lg text-xs text-pi-ink placeholder:text-pi-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-pi-gold/30"
          />
          <button
            onClick={saveProactive}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-pi-gold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pi-gold/90 transition-colors"
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
