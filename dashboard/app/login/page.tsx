"use client";

import { useState } from "react";
import { useAuth } from "../components/auth-provider";

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    window.location.href = "/";
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-pi-cream">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-pi-gold flex items-center justify-center mx-auto mb-4">
            <span
              className="text-white font-bold text-2xl"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Pi
            </span>
          </div>
          <h1 className="text-xl font-semibold text-pi-ink tracking-tight">
            Pi Assistant
          </h1>
          <p className="text-sm text-pi-ink-muted mt-1">
            Sign in to your dashboard
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/60 border border-pi-border rounded-xl p-6 space-y-4"
        >
          {error && (
            <div className="text-sm text-pi-red bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="username"
              className="block text-xs text-pi-ink-muted uppercase tracking-wider mb-1.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full px-3 py-2.5 bg-pi-cream/50 border border-pi-border rounded-lg text-sm text-pi-ink placeholder:text-pi-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-pi-gold/30 focus:border-pi-gold"
              placeholder="admin"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs text-pi-ink-muted uppercase tracking-wider mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2.5 bg-pi-cream/50 border border-pi-border rounded-lg text-sm text-pi-ink placeholder:text-pi-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-pi-gold/30 focus:border-pi-gold"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-pi-gold text-white text-sm font-medium rounded-lg hover:bg-pi-gold/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
