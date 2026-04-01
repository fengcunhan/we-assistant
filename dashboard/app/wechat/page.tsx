"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../components/auth-provider";

interface WeChatBinding {
  wechatId: string;
  nickname: string;
  boundAt: number;
}

type BindStep = "idle" | "loading" | "scanning" | "scanned" | "confirmed" | "error";

export default function WeChatPage() {
  const { authFetch } = useAuth();
  const [bindings, setBindings] = useState<WeChatBinding[]>([]);
  const [step, setStep] = useState<BindStep>("idle");
  const [qrContent, setQrContent] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBindings = useCallback(async () => {
    try {
      const res = await authFetch("/api/wechat/bindings");
      const data = await res.json();
      if (data.bindings) setBindings(data.bindings);
    } catch {
      // ignore
    }
  }, [authFetch]);

  useEffect(() => {
    fetchBindings();
  }, [fetchBindings]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startBind = async () => {
    setStep("loading");
    setErrorMsg("");
    setQrContent("");
    setQrToken("");

    try {
      const res = await authFetch("/api/wechat/qrcode", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to get QR code");
      }

      const data = await res.json();
      setQrContent(data.qrcodeImgContent);
      setQrToken(data.qrcode);
      setStep("scanning");

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await authFetch(
            `/api/wechat/qrcode/${data.qrcode}/status`,
          );
          const statusData = await statusRes.json();

          if (statusData.status === "confirmed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep("confirmed");
            await fetchBindings();
          } else if (statusData.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep("error");
            setErrorMsg("QR code expired. Please try again.");
          } else if (statusData.status === "scaned" || statusData.status === "scanned") {
            setStep("scanned");
          }
        } catch {
          // Retry on network error
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
    setQrToken("");
  };

  const removeBinding = async (id: string) => {
    try {
      await authFetch(`/api/wechat/bindings/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await fetchBindings();
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-pi-ink">
          WeChat Bindings
        </h1>
        <p className="mt-1 text-sm text-pi-ink-muted">
          Bind WeChat accounts via QR code scan
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
              Scan QR code with WeChat to bind your account
            </p>
            <button
              onClick={startBind}
              className="px-6 py-2.5 bg-pi-gold text-white text-sm font-medium rounded-lg hover:bg-pi-gold/90 transition-colors"
            >
              Generate QR Code
            </button>
          </div>
        )}

        {(step === "loading") && (
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
              className="mt-4 text-sm text-pi-ink-muted hover:text-pi-ink transition-colors"
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
              WeChat account bound successfully!
            </p>
            <button
              onClick={() => {
                setStep("idle");
                setQrContent("");
                setQrToken("");
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

      {/* Bindings list */}
      <div
        className="bg-white/60 border border-pi-border rounded-xl p-6 animate-fade-up"
        style={{ animationDelay: "0.2s" }}
      >
        <h2 className="text-sm font-medium text-pi-ink-muted uppercase tracking-wider mb-4">
          Linked Accounts ({bindings.length})
        </h2>

        {bindings.length === 0 ? (
          <p className="text-sm text-pi-ink-muted py-8 text-center">
            No WeChat accounts linked yet
          </p>
        ) : (
          <div className="space-y-3">
            {bindings.map((b) => (
              <div
                key={b.wechatId}
                className="flex items-center gap-4 py-3 border-b border-pi-border/50 last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-pi-green/15 flex items-center justify-center shrink-0">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-pi-green"
                  >
                    <circle cx="8" cy="6" r="3" />
                    <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-pi-ink truncate">
                    {b.nickname}
                  </p>
                  <p className="text-xs text-pi-ink-muted truncate">
                    {b.wechatId}
                  </p>
                </div>
                <span className="text-xs text-pi-ink-muted tabular-nums whitespace-nowrap">
                  {new Date(b.boundAt).toLocaleDateString("zh-CN")}
                </span>
                <button
                  onClick={() => removeBinding(b.wechatId)}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
