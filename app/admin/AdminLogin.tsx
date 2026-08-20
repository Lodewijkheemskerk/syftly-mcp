"use client";

import { useState } from "react";

// Unlock screen for the private dashboard. Two modes, chosen server-side by
// whether an ADMIN_PIN is configured (the flag comes in as a prop so the PIN
// itself never reaches client JS):
// - pinMode: iPhone-style keypad, dots fill as you type, the last digit
//   auto-submits. Reuses the .lock/.keypad styles from the site gate so both
//   unlock surfaces feel identical.
// - fallback: the original secret input (METRICS_SECRET), kept so an unset
//   ADMIN_PIN never locks the dashboard.
// On success we reload so the server component re-reads the httpOnly cookie.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

function AdminKeypad({ pinLength }: { pinLength: number }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(code: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: code }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // fall through to error state
    }
    setBusy(false);
    setError(true);
    setPin("");
    setTimeout(() => setError(false), 450);
  }

  function press(key: string) {
    if (busy || key === "") return;
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= pinLength) return;
    const updated = pin + key;
    setPin(updated);
    if (updated.length === pinLength) void submit(updated);
  }

  return (
    <main className="lock">
      <div className={`lock-card${error ? " shake" : ""}`}>
        <span className="lock-brand">SYFTLY</span>
        <p className="lock-sub">Metrics — enter the PIN</p>

        <div className="pin-dots" aria-hidden="true">
          {Array.from({ length: pinLength }, (_, i) => (
            <span key={i} className={`pin-dot${i < pin.length ? " filled" : ""}`} />
          ))}
        </div>

        <div className="keypad">
          {KEYS.map((key, i) => (
            <button
              key={i}
              type="button"
              className={`key${key === "" ? " key--empty" : ""}`}
              onClick={() => press(key)}
              disabled={key === "" || busy}
              aria-label={key === "del" ? "Delete" : key || undefined}
            >
              {key === "del" ? "⌫" : key}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function SecretForm() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <main className="admin admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1>Syftly metrics</h1>
        <p>Private dashboard. Enter the secret.</p>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="secret"
          autoFocus
          aria-label="Admin secret"
        />
        <button type="submit" disabled={busy || secret.length === 0}>
          {busy ? "…" : "Unlock"}
        </button>
        {error && <p className="admin-login-error">Wrong secret.</p>}
      </form>
    </main>
  );
}

export default function AdminLogin({
  pinMode = false,
  pinLength = 6,
}: {
  pinMode?: boolean;
  pinLength?: number;
}) {
  return pinMode ? <AdminKeypad pinLength={pinLength} /> : <SecretForm />;
}
