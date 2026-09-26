"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
} from "lucide-react";

type Screen =
  | "loading"
  | "ready"
  | "missing"
  | "expired"
  | "confirmed"
  | "disputed"
  | "settled";
type ReceiptResult = {
  state?: string;
  error?: string;
  message?: string;
  chainSyncPending?: boolean;
};

export default function RecipientConfirmation({ jobId }: { jobId: string }) {
  const token = useRef<string | null>(null);
  const tokenJob = useRef<string | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [received, setReceived] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"confirm" | "dispute" | null>(null);
  const [error, setError] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    let active = true;
    function readLink() {
      if (
        token.current === null ||
        tokenJob.current !== jobId ||
        window.location.hash
      ) {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const value = fragment.get("token") ?? "";
        // Consume the fragment once. The credential never enters storage, rendered
        // markup, query parameters, analytics, or an authenticated application cookie.
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
        token.current =
          /^[A-Za-z0-9_-]{43}$/.test(value) && /^[0-9a-f-]{36}$/i.test(jobId)
            ? value
            : "";
        tokenJob.current = jobId;
      }
      queueMicrotask(() => {
        if (!active) return;
        setScreen(token.current ? "ready" : "missing");
        setReceived(false);
        setShowIssue(false);
        setReason("");
        setError("");
      });
    }
    readLink();
    // Reopening the original link in this tab can be a fragment-only navigation.
    window.addEventListener("hashchange", readLink);
    return () => {
      active = false;
      window.removeEventListener("hashchange", readLink);
    };
  }, [jobId]);

  async function submit(action: "confirm" | "dispute") {
    if (!token.current || busy || (action === "confirm" && !received)) return;
    if (action === "dispute" && reason.trim().length < 5) {
      setError("Describe the issue in at least 5 characters.");
      return;
    }
    setBusy(action);
    setError("");
    const requestToken = token.current;
    try {
      const response = await fetch(
        `/api/recipient/${encodeURIComponent(jobId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "omit",
          cache: "no-store",
          body: JSON.stringify({
            token: requestToken,
            action,
            ...(action === "dispute" ? { reason: reason.trim() } : {}),
          }),
          signal: AbortSignal.timeout(55_000),
        },
      );
      const result = (await response.json()) as ReceiptResult;
      if (token.current !== requestToken) return;
      if (!response.ok) {
        if (result.error === "INVALID_CHALLENGE") {
          token.current = "";
          setScreen("expired");
        } else if (result.error === "NOT_CONFIGURED") {
          setError(
            "Confirmation is unavailable. Contact the merchant to confirm delivery.",
          );
        } else if (response.status === 503) {
          setError(
            "We couldn’t confirm the result. Ask the merchant to check before trying again.",
          );
        } else {
          setError(
            result.message ||
              "Your request couldn’t be confirmed. Contact the merchant.",
          );
        }
        return;
      }
      if (result.state === "DELIVERY_CONFIRMED") {
        token.current = "";
        setScreen("confirmed");
      } else if (result.state === "DISPUTED") {
        token.current = "";
        setResultMessage(
          result.chainSyncPending
            ? "Automatic payout is paused. The on-chain freeze is pending. Contact the merchant for next steps."
            : "The courier’s payout is paused. Contact the merchant for next steps.",
        );
        setScreen("disputed");
      } else if (result.state === "PAID" || result.state === "REFUNDED") {
        token.current = "";
        setResultMessage(
          result.state === "PAID"
            ? "The courier was already paid. Contact the merchant about your issue."
            : "This delivery was already refunded. Contact the merchant about your issue.",
        );
        setScreen("settled");
      } else {
        setError(
          "We couldn’t confirm the status. Ask the merchant to check your delivery.",
        );
      }
    } catch {
      setError(
        "We couldn’t confirm the result. Ask the merchant to check before trying again.",
      );
    } finally {
      setBusy(null);
    }
  }

  function reportIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("dispute");
  }

  const finished =
    screen === "confirmed" || screen === "disputed" || screen === "settled";
  const invalid = screen === "missing" || screen === "expired";

  return (
    <div className="recipient-page">
      <header className="recipient-brand-row">
        <Link href="/" className="recipient-brand" aria-label="Haulie home">
          <Leaf size={28} strokeWidth={2.3} />
          haulie<span>.</span>
        </Link>
        <span>
          <LockKeyhole size={13} /> Private link
        </span>
      </header>

      <main className="recipient-main">
        <section
          className="recipient-card"
          aria-labelledby="recipient-title"
          aria-busy={screen === "loading" || busy !== null}
        >
          <div className="recipient-card-body">
            <div className="recipient-status-icon" aria-hidden="true">
              {screen === "confirmed" ? (
                <CheckCircle2 size={28} strokeWidth={1.6} />
              ) : invalid || screen === "disputed" || screen === "settled" ? (
                <CircleAlert size={28} strokeWidth={1.6} />
              ) : (
                <PackageCheck size={28} strokeWidth={1.6} />
              )}
            </div>
            <h1 id="recipient-title">
              {screen === "confirmed"
                ? "Delivery confirmed"
                : screen === "disputed"
                  ? "Issue reported"
                  : screen === "settled"
                    ? "Delivery already settled"
                    : invalid
                      ? "Delivery link unavailable"
                      : showIssue
                        ? "Report an issue"
                        : "Confirm your delivery"}
            </h1>

            {screen === "loading" && (
              <p className="recipient-loading" role="status">
                <LoaderCircle size={17} className="recipient-spinner" /> Opening
                delivery…
              </p>
            )}

            {invalid && (
              <div className="recipient-state" role="status">
                <p>
                  {screen === "expired"
                    ? "This link has expired or was already used. Ask the merchant to check your delivery or send a new link."
                    : "Reopen the original delivery link from your merchant. If it no longer works, ask for a new link."}
                </p>
              </div>
            )}

            {screen === "ready" && (
              <>
                {!showIssue ? (
                  <div className="recipient-receipt-form">
                    <label className="recipient-checkbox">
                      <input
                        type="checkbox"
                        checked={received}
                        disabled={busy !== null}
                        onChange={(event) => setReceived(event.target.checked)}
                      />
                      <span>
                        I received my parcel in good condition.
                      </span>
                    </label>
                    <button
                      type="button"
                      className="recipient-primary"
                      disabled={!received || busy !== null}
                      onClick={() => void submit("confirm")}
                    >
                      {busy === "confirm" ? (
                        <>
                          <LoaderCircle
                            size={17}
                            className="recipient-spinner"
                          />{" "}
                          Confirming…
                        </>
                      ) : (
                        <>
                          Confirm delivery <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="recipient-issue-toggle"
                      disabled={busy !== null}
                      onClick={() => {
                        setShowIssue(true);
                        setError("");
                      }}
                    >
                      <CircleAlert size={15} /> Report an issue
                    </button>
                  </div>
                ) : (
                  <form className="recipient-issue-form" onSubmit={reportIssue}>
                    <label htmlFor="delivery-issue">
                      What happened?
                    </label>
                    <textarea
                      id="delivery-issue"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      minLength={5}
                      maxLength={2000}
                      rows={4}
                      required
                      disabled={busy !== null}
                      placeholder="Describe the damage, missing parcel, or other issue."
                    />
                    <button
                      className="recipient-primary"
                      disabled={busy !== null || reason.trim().length < 5}
                      type="submit"
                    >
                      {busy === "dispute" ? (
                        <>
                          <LoaderCircle
                            size={17}
                            className="recipient-spinner"
                          />{" "}
                          Sending…
                        </>
                      ) : (
                        <>
                          Send report <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="recipient-issue-toggle"
                      disabled={busy !== null}
                      onClick={() => {
                        setShowIssue(false);
                        setError("");
                      }}
                    >
                      Back to confirmation
                    </button>
                  </form>
                )}

                {error && (
                  <div className="recipient-error" role="alert">
                    <CircleAlert size={18} />
                    <p>{error}</p>
                  </div>
                )}
                {!showIssue && (
                  <p className="recipient-payment-note">
                    Confirmation allows the courier to be paid. You won’t be charged.
                  </p>
                )}
              </>
            )}

            {finished && (
              <div className="recipient-state" role="status">
                {screen === "confirmed" ? (
                  <>
                    <p>
                      The merchant and courier can see your confirmation.
                    </p>
                    <p className="recipient-small">
                      Payment is processed separately. You can close this page.
                    </p>
                  </>
                ) : (
                  <p>{resultMessage}</p>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
