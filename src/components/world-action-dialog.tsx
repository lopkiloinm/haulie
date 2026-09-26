"use client";

import { useState } from "react";
import { ArrowRight, Check, Globe2, Wallet } from "lucide-react";
import type { DemoJob } from "@/lib/demo";
import { formatMoney } from "@/lib/demo";
import { formatSui } from "@/lib/sui/live-escrow-config";
import { Modal } from "./delivery-detail";
import { SuiWallet } from "./sui-wallet";
import type { WorldConnectionStatus } from "./workspace-connections";

type Props = {
  job: DemoJob;
  stage: "ACCEPT" | "PICKUP";
  status: WorldConnectionStatus | null;
  wallet: string | null;
  onWalletChange: (address: string | null) => void;
  onClose: () => void;
  onUpdated: () => Promise<void>;
};

export function WorldActionDialog({
  job,
  stage,
  status,
  wallet,
  onWalletChange,
  onClose,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accepted = status?.jobs[job.id];
  const needsWallet = !!accepted && !accepted.payoutWallet;
  async function attachWallet() {
    if (!wallet || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/world-sandbox/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: job.id, payoutWallet: wallet }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Could not save the wallet.");
      }
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the wallet.");
      setBusy(false);
    }
  }
  const complete = stage === "ACCEPT" ? !!accepted : !!accepted?.pickedUp;
  const supported = [
    "HL-1046",
    "HL-1048",
    "HL-1047",
    "HL-1045",
    "HL-1044",
    "HL-1043",
  ].includes(job.id);
  const eligible =
    status?.configured &&
    supported &&
    (stage === "ACCEPT" ? !!wallet : !!accepted);
  async function verify() {
    if (busy || !eligible) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/world-sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job: job.id,
          stage,
          returnTo: "courier",
          ...(stage === "ACCEPT" && wallet ? { payoutWallet: wallet } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Verification could not start.");
      const destination = new URL(result.url);
      if (destination.origin !== "https://sandbox.auth.world.org")
        throw new Error("Verification service unavailable.");
      window.location.assign(destination.href);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Verification could not start. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        complete
          ? "World verification"
          : stage === "ACCEPT"
            ? "Accept delivery"
            : "Verify pickup"
      }
      subtitle={job.id}
      onClose={onClose}
    >
      <div className="world-action-summary">
        <div>
          <strong>{job.title}</strong>
          <small>
            {job.pickup} → {job.destination}
          </small>
        </div>
        <span>
          {job.chain
            ? formatSui(job.chain.mist)
            : `${formatMoney(job.fee)} USDC`}
        </span>
      </div>
      <div className="world-action-connection">
        <span>
          <Globe2 size={18} /> World ID
        </span>
        <span>
          {complete ? (
            <>
              <Check size={16} /> Verified
            </>
          ) : (
            "Sandbox"
          )}
        </span>
      </div>
      <div className="world-action-connection">
        <span>
          <Wallet size={18} /> Sui wallet
        </span>
        <SuiWallet compact onAccountChange={onWalletChange} />
      </div>
      {accepted?.payoutWallet && (
        <p className="world-action-help">
          Accepted wallet: {accepted.payoutWallet.slice(0, 8)}…
          {accepted.payoutWallet.slice(-6)}
        </p>
      )}
      <p className="world-action-help">
        {needsWallet
          ? "World verification is complete. Select a Sui wallet for this delivery."
          : complete
            ? "This delivery’s World check is complete."
            : !supported
              ? "World verification is not available for this delivery yet."
              : stage === "PICKUP" && !accepted
                ? "This sample assignment has no World acceptance. Choose an available delivery to verify and accept."
                : !status?.configured
                  ? "World verification is currently unavailable."
                  : stage === "ACCEPT" && !wallet
                    ? "Connect your Sui wallet, then verify with World to accept."
                    : stage === "ACCEPT"
                      ? "Verify with World to accept this delivery."
                      : "Verify again with the same World identity to confirm pickup."}{" "}
        {job.chain
          ? "The fee is locked in escrow on Sui testnet and pays your wallet after delivery."
          : "Test delivery fees are simulated."}
      </p>
      {error && (
        <p className="world-action-error" role="alert">
          {error}
        </p>
      )}
      {needsWallet ? (
        <button
          className="button button-primary full-width"
          disabled={!wallet || busy}
          onClick={attachWallet}
        >
          {busy ? "Saving…" : "Use this wallet"}
          <ArrowRight size={16} />
        </button>
      ) : complete ? (
        <button className="button button-primary full-width" onClick={onClose}>
          Done
        </button>
      ) : (
        <button
          className="button button-primary full-width"
          disabled={!eligible || busy}
          onClick={verify}
        >
          {busy ? "Opening World…" : "Continue with World"}
          <ArrowRight size={16} />
        </button>
      )}
    </Modal>
  );
}
