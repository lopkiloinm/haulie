"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  ShieldCheck,
} from "lucide-react";
import "./world-sandbox.css";

type Status = {
  configured: boolean;
  connected: boolean;
  jobs: Record<string, { accepted: number; pickedUp?: number }>;
};
const messages: Record<string, string> = {
  accepted: "Delivery accepted. Verify again at pickup.",
  "picked-up": "Pickup verified.",
  denied: "Verification declined.",
  expired: "Verification expired. Start a new check.",
  failed: "Verification failed. Try again with the same World identity.",
  unavailable: "World is unavailable. Try again later.",
};
export function WorldSandbox({
  initialJob = "HL-1046",
  initialResult = "",
}: {
  initialJob?: string;
  initialResult?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const job = initialJob;
  const [message, setMessage] = useState(
    ["accepted", "picked-up"].includes(initialResult)
      ? ""
      : messages[initialResult] || "",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    window.history.replaceState(null, "", `/world-sandbox?job=${initialJob}`);
    fetch("/api/world-sandbox/status", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const value = await r.json();
        if (active) {
          setStatus(value);
          if (initialResult === "accepted" && value.jobs[initialJob]?.accepted)
            setMessage(messages.accepted);
          if (initialResult === "picked-up" && value.jobs[initialJob]?.pickedUp)
            setMessage(messages["picked-up"]);
        }
      })
      .catch(() => {
        if (active)
          setMessage("Could not connect to World. Refresh to try again.");
      });
    return () => {
      active = false;
    };
  }, [initialJob, initialResult]);
  async function start(stage: "ACCEPT" | "PICKUP") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/world-sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job, stage }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Unable to start World verification.");
      const url = new URL(body.url);
      if (url.origin !== "https://sandbox.auth.world.org")
        throw new Error("Unexpected verification destination.");
      window.location.assign(url.toString());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect. Try again.",
      );
      setBusy(false);
    }
  }
  async function cancel() {
    try {
      const result = await fetch("/api/world-sandbox/cancel", {
        method: "POST",
      });
      if (!result.ok) throw new Error();
      setMessage("Verification cancelled.");
      setBusy(false);
    } catch {
      setMessage(
        "Could not cancel. The request will expire after five minutes.",
      );
    }
  }
  const delivery = status?.jobs[job];
  return (
    <main className="world-sandbox">
      <header className="sandbox-header">
        <Link href="/courier" className="sandbox-back">
          <ArrowLeft size={16} /> Deliveries
        </Link>
        <Link href="/wallet" className="sandbox-back">
          Sui wallet <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className="sandbox-layout">
        <section className="sandbox-intro">
          <div className="sandbox-title-row">
            <h1>World verification</h1>
            <span className="sandbox-network">Test identities</span>
          </div>
          <p>
            Verify to accept. Use the same identity at pickup.
          </p>
        </section>
        <section className="sandbox-card" aria-label="World delivery verification">
          <div className="sandbox-card-top">
            <h2>Delivery {job}</h2>
            <span className="sandbox-badge">
              {delivery?.pickedUp
                ? "Pickup confirmed"
                : delivery
                  ? "Accepted"
                  : "Available"}
            </span>
          </div>
          <ol className="sandbox-steps">
            <li className={delivery ? "complete" : ""}>
              <span>{delivery ? <Check size={16} /> : "1"}</span>
              <div>
                <strong>Accept with World</strong>
                <p>Sign in to accept this order.</p>
              </div>
            </li>
            <li className={delivery?.pickedUp ? "complete" : ""}>
              <span>{delivery?.pickedUp ? <Check size={16} /> : "2"}</span>
              <div>
                <strong>Verify pickup</strong>
                <p>Use the same World identity.</p>
              </div>
            </li>
          </ol>
          {message && message !== messages["picked-up"] && (
            <div className="sandbox-message" role="status">
              <CircleAlert size={18} />
              <p>{message}</p>
            </div>
          )}
          {status && !status.configured && (
            <div className="sandbox-message" role="status">
              <CircleAlert size={18} />
              <p>Connection awaiting setup.</p>
            </div>
          )}
          {!delivery?.pickedUp && (
            <button
              className="button button-primary full-width"
              disabled={!status?.configured || busy}
              onClick={() => start(delivery ? "PICKUP" : "ACCEPT")}
            >
              <ShieldCheck size={18} />
              {busy
                ? "Opening World…"
                : !status
                  ? "Checking connection…"
                  : delivery
                    ? "Verify pickup"
                    : "Accept with World"}
              {!busy && <ArrowUpRight size={17} />}
            </button>
          )}
          {delivery?.pickedUp && (
            <div className="sandbox-success" role="status">
              <Check size={20} /> Verification complete
            </div>
          )}
          {!delivery?.pickedUp && (
            <button className="text-button centered" onClick={cancel}>
              Cancel verification
            </button>
          )}
        </section>
        <footer className="sandbox-footer">
          <p>
            World uses test identities. Verification does not move funds.
          </p>
        </footer>
      </div>
    </main>
  );
}
