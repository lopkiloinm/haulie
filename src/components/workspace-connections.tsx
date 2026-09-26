"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, Wallet } from "lucide-react";
import { SuiWallet } from "./sui-wallet";
import "./workspace-connections.css";

export type WorldConnectionStatus = {
  configured: boolean;
  connected: boolean;
  jobs: Record<
    string,
    { accepted: number; pickedUp?: number; payoutWallet?: string }
  >;
};

type Props = {
  onVerify: () => void;
  onStatus?: (status: WorldConnectionStatus | null) => void;
  onWalletChange?: (address: string | null) => void;
  refreshKey?: string | number;
};

function isWorldStatus(value: unknown): value is WorldConnectionStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<WorldConnectionStatus>;
  return (
    typeof status.configured === "boolean" &&
    typeof status.connected === "boolean" &&
    !!status.jobs &&
    typeof status.jobs === "object" &&
    !Array.isArray(status.jobs) &&
    Object.values(status.jobs).every(
      (job) =>
        !!job &&
        typeof job === "object" &&
        Number.isFinite(job.accepted) &&
        (job.pickedUp === undefined || Number.isFinite(job.pickedUp)) &&
        (job.payoutWallet === undefined ||
          (typeof job.payoutWallet === "string" &&
            /^0x[a-fA-F0-9]{64}$/.test(job.payoutWallet))),
    )
  );
}

export function WorkspaceConnections({
  onVerify,
  onStatus,
  onWalletChange,
  refreshKey,
}: Props) {
  const [status, setStatus] = useState<WorldConnectionStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const onStatusRef = useRef(onStatus);
  const contentId = useId();

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;

    async function refresh() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/world-sandbox/status", {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        });
        if (!response.ok) throw new Error("World status unavailable");
        const value: unknown = await response.json();
        if (!isWorldStatus(value)) throw new Error("Invalid World status");
        if (!active || request.signal.aborted) return;
        setStatus(value);
        setFailed(false);
        onStatusRef.current?.(value);
      } catch {
        if (!active || request.signal.aborted) return;
        setStatus(null);
        setFailed(true);
        onStatusRef.current?.(null);
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

    void refresh();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshKey, retry]);

  const worldLabel = failed
    ? "Connection unavailable"
    : !status
      ? "Checking…"
      : !status.configured
        ? "Unavailable"
        : status.connected
          ? "Verified"
          : "Not connected";

  return (
    <section className={`workspace-connections${expanded ? " is-expanded" : ""}`}>
      <div className="workspace-connections-heading">
        <span className="workspace-connections-title">Connections</span>
        <button
          type="button"
          className="workspace-connections-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>Connections</span>
          <span className="workspace-connections-summary">World ID · Sui</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <span className="workspace-connections-environment">
          World sandbox · Sui testnet
        </span>
      </div>
      <div className="workspace-connections-body" id={contentId}>
        <div className="workspace-connection workspace-connection-world">
          <span className="workspace-connection-icon" aria-hidden="true">
            <Globe2 size={19} />
          </span>
          <div className="workspace-connection-label">
            <strong>World ID</strong>
            <span
              className={status?.connected ? "is-verified" : ""}
              aria-live="polite"
            >
              {status?.connected && <Check size={12} aria-hidden="true" />}
              {worldLabel}
            </span>
          </div>
          <button
            type="button"
            className="workspace-connection-action"
            disabled={!failed && !status?.configured}
            onClick={failed ? () => setRetry((current) => current + 1) : onVerify}
          >
            {failed ? "Retry" : status?.connected ? "View" : "Verify"}
          </button>
        </div>
        <div className="workspace-connection workspace-connection-wallet">
          <span className="workspace-connection-icon" aria-hidden="true">
            <Wallet size={19} />
          </span>
          <div className="workspace-connection-label">
            <strong>Sui wallet</strong>
          </div>
          <SuiWallet compact onAccountChange={onWalletChange} />
        </div>
      </div>
    </section>
  );
}
