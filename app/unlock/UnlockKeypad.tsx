"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// iPhone-unlock-style keypad: four dots fill as you type; entering the 4th digit
// auto-submits to /api/unlock (server-side check). Wrong code => shake + clear.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;
const PIN_LENGTH = 4;

export default function UnlockKeypad() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/categories";

  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(code: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
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
    if (pin.length >= PIN_LENGTH) return;
    const updated = pin + key;
    setPin(updated);
    if (updated.length === PIN_LENGTH) void submit(updated);
  }

  return (
    <main className="lock">
      <div className={`lock-card${error ? " shake" : ""}`}>
        <span className="lock-brand">SYFTLY</span>
        <p className="lock-sub">Enter the access code</p>

        <div className="pin-dots" aria-hidden="true">
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
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
