"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Bike,
  Check,
  CircleAlert,
  LockKeyhole,
  Package,
  ShieldCheck,
} from "lucide-react";
import "./world-sandbox.css";

type Status = {
  configured: boolean;
  connected: boolean;
  jobs: Record<string, { accepted: number; pickedUp?: number }>;
};
const messages: Record<string, string> = {
  accepted:
    "World verified your fresh sign-in. Your sandbox delivery is accepted.",
  "picked-up":
    "The same World identity passed a new check. Sandbox pickup is confirmed.",
  denied: "Verification was declined. No delivery action was authorized.",
  expired:
    "This request expired or no longer matches your browser. Start a new check.",
  failed:
    "World verification could not be validated. No delivery action was authorized. Try again with the same World identity.",
  unavailable:
    "World sandbox is temporarily unavailable or awaiting configuration. No action was authorized.",
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
          setMessage(
            "Could not load the sandbox connection. Refresh to try again.",
          );
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
      setMessage(
        "Pending verification cancelled. No new action was authorized.",
      );
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
        <Link href="/courier" className="sandbox-brand">
          <Bike size={28} /> haulie<span>World sandbox</span>
        </Link>
        <Link href="/courier" className="sandbox-back">
          <ArrowLeft size={16} /> Courier workspace
        </Link>
      </header>
      <div className="sandbox-layout">
        <section className="sandbox-intro">
          <span className="sandbox-eyebrow">A HUMAN AT EVERY HANDOFF</span>
          <h1>
            Real connection.
            <br />
            <em>Test deliveries.</em>
          </h1>
          <p>
            Connect to World’s official sandbox. Accept a delivery with a fresh
            sign-in, then prove it’s the same identity at pickup.
          </p>
          <div className="sandbox-note">
            <ShieldCheck size={22} />
            <div>
              <strong>Official World sandbox</strong>
              <p>
                World uses test identities here. This is not production proof of
                humanity. No real parcel or money moves.
              </p>
            </div>
          </div>
          <a
            href="https://sandbox.auth.world.org/docs"
            target="_blank"
            rel="noreferrer"
          >
            How World verification works <ArrowUpRight size={16} />
          </a>
        </section>
        <section className="sandbox-card" aria-label="World sandbox delivery">
          <div className="sandbox-card-top">
            <span className="sandbox-package">
              <Package size={25} />
            </span>
            <span className="sandbox-badge">
              {delivery?.pickedUp
                ? "Pickup confirmed"
                : delivery
                  ? "Accepted"
                  : "Available to accept"}
            </span>
          </div>
          <span className="sandbox-eyebrow">SANDBOX DELIVERY · {job}</span>
          <h2>Your human handoff</h2>
          <p className="sandbox-description">
            An isolated test order for the World verification journey. Your main
            demo workspace stays separate.
          </p>
          <ol className="sandbox-steps">
            <li className={delivery ? "complete" : ""}>
              <span>{delivery ? <Check size={16} /> : "1"}</span>
              <div>
                <strong>Accept with World</strong>
                <p>Fresh authentication authorizes this sandbox order.</p>
              </div>
            </li>
            <li className={delivery?.pickedUp ? "complete" : ""}>
              <span>{delivery?.pickedUp ? <Check size={16} /> : "2"}</span>
              <div>
                <strong>Verify again at pickup</strong>
                <p>A new check must match the identity that accepted.</p>
              </div>
            </li>
            <li>
              <span>
                <LockKeyhole size={16} />
              </span>
              <div>
                <strong>Server checks every result</strong>
                <p>
                  Invalid, cancelled, or expired sign-ins cannot approve a
                  handoff.
                </p>
              </div>
            </li>
          </ol>
          {message && (
            <div className="sandbox-message" role="status">
              <CircleAlert size={18} />
              <p>{message}</p>
            </div>
          )}
          {status && !status.configured && (
            <div className="sandbox-message" role="status">
              <CircleAlert size={18} />
              <p>
                Connection awaiting setup. Haulie’s owner needs to save the
                registered World sandbox client credentials before verification
                can begin.
              </p>
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
                    ? "Verify pickup with World"
                    : "Accept with World sandbox"}
              {!busy && <ArrowUpRight size={17} />}
            </button>
          )}
          {delivery?.pickedUp && (
            <div className="sandbox-success">
              <Check size={20} /> Both World checks complete
            </div>
          )}
          <button className="text-button centered" onClick={cancel}>
            Cancel pending verification
          </button>
          <p className="sandbox-footnote">
            You’ll continue on sandbox.auth.world.org. Only the openid scope is
            requested. Identity and tokens stay on Haulie’s server or in
            encrypted, HttpOnly session cookies.
          </p>
        </section>
      </div>
      <footer className="sandbox-footer">
        Sandbox orders belong to this browser session and expire after 24 hours.
        They do not reserve shared delivery inventory or authorize payouts.
      </footer>
    </main>
  );
}
