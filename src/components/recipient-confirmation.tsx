"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
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
      setError(
        "Please describe the issue in a few words so the merchant can help.",
      );
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
            "The delivery service is not connected yet. Please contact the merchant to confirm your delivery.",
          );
        } else if (response.status === 503) {
          setError(
            "We couldn’t verify the result. Please ask the merchant to check your delivery status before trying again.",
          );
        } else {
          setError(
            result.message ||
              "Your request could not be confirmed. Please contact the merchant.",
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
            ? "Your issue is recorded and automatic payout is paused. The on-chain freeze is still awaiting confirmation. Please contact the merchant for next steps."
            : "Your issue is recorded and the courier’s payout is paused. Please contact the merchant so they can review what happened.",
        );
        setScreen("disputed");
      } else if (result.state === "PAID" || result.state === "REFUNDED") {
        token.current = "";
        setResultMessage(
          result.state === "PAID"
            ? "The courier’s payment had already completed. Please contact the merchant directly about your delivery issue."
            : "This delivery’s escrow has already been refunded. Please contact the merchant about your delivery.",
        );
        setScreen("settled");
      } else {
        setError(
          "The service returned an unexpected result. Please ask the merchant to check your delivery status.",
        );
      }
    } catch {
      setError(
        "We couldn’t verify the result. Please ask the merchant to check your delivery status before trying again.",
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
          <LockKeyhole size={13} /> Private delivery link
        </span>
      </header>

      <main className="recipient-main">
        <section
          className="recipient-card"
          aria-labelledby="recipient-title"
          aria-busy={screen === "loading" || busy !== null}
        >
          <div
            className={`recipient-illustration ${finished ? "recipient-illustration-complete" : ""}`}
            aria-hidden="true"
          >
            <span className="recipient-orbit recipient-orbit-one" />
            <span className="recipient-orbit recipient-orbit-two" />
            <span className="recipient-parcel">
              {finished ? (
                <ShieldCheck size={49} strokeWidth={1.4} />
              ) : (
                <PackageCheck size={52} strokeWidth={1.35} />
              )}
            </span>
            <span className="recipient-illustration-check">
              <Check size={16} strokeWidth={2.8} />
            </span>
            <span className="recipient-spark recipient-spark-one">✦</span>
            <span className="recipient-spark recipient-spark-two">✦</span>
          </div>

          <div className="recipient-card-body">
            <p className="recipient-eyebrow">A little care. Every handoff.</p>
            <h1 id="recipient-title">
              {screen === "confirmed"
                ? "Delivered. With care."
                : screen === "disputed"
                  ? "We’ve recorded your issue."
                  : screen === "settled"
                    ? "Delivery already settled."
                    : invalid
                      ? "Let’s find your delivery."
                      : "Your parcel, in good hands."}
            </h1>

            {screen === "loading" && (
              <p className="recipient-loading" role="status">
                <LoaderCircle size={17} className="recipient-spinner" /> Opening
                your private delivery link…
              </p>
            )}

            {invalid && (
              <div className="recipient-state" role="status">
                <p>
                  {screen === "expired"
                    ? "This link has expired or has already been used. Ask the merchant to check your delivery or send you a fresh link."
                    : "Open the complete delivery link sent by your merchant. For your privacy, the link’s private token is removed after opening; reloading this page requires reopening the original link."}
                </p>
                <div className="recipient-note">
                  <CircleAlert size={18} />
                  <span>
                    {screen === "expired"
                      ? "Ask the merchant to check whether your receipt is already recorded."
                      : "A complete private delivery link is required to continue."}
                  </span>
                </div>
              </div>
            )}

            {screen === "ready" && (
              <>
                <p className="recipient-intro">
                  One last check to finish the journey. Confirm only when your
                  parcel is safely with you.
                </p>
                <div className="recipient-step">
                  <span>
                    <Check size={12} />
                  </span>{" "}
                  Courier handoff <i />
                  <strong> Your confirmation</strong>
                </div>

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
                        I have received my parcel and everything looks right.
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
                          Confirming receipt…
                        </>
                      ) : (
                        <>
                          Confirm I’ve received it <ArrowRight size={17} />
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
                      <CircleAlert size={15} /> Something isn’t right
                    </button>
                  </div>
                ) : (
                  <form className="recipient-issue-form" onSubmit={reportIssue}>
                    <label htmlFor="delivery-issue">
                      Tell the merchant what happened
                    </label>
                    <p>
                      For damage, a missing parcel, or another delivery problem.
                    </p>
                    <textarea
                      id="delivery-issue"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      minLength={5}
                      maxLength={2000}
                      rows={4}
                      required
                      disabled={busy !== null}
                      placeholder="Describe the issue. Please leave out payment details or other sensitive information."
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
                          Recording your issue…
                        </>
                      ) : (
                        <>
                          Report a delivery issue <ArrowRight size={17} />
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
                      Back to receipt confirmation
                    </button>
                  </form>
                )}

                {error && (
                  <div className="recipient-error" role="alert">
                    <CircleAlert size={18} />
                    <p>{error}</p>
                  </div>
                )}
                <p className="recipient-payment-note">
                  <LockKeyhole size={13} /> Your confirmation allows the
                  courier’s reserved payment to be processed. You won’t be
                  charged.
                </p>
              </>
            )}

            {finished && (
              <div className="recipient-state" role="status">
                {screen === "confirmed" ? (
                  <>
                    <p>
                      Your receipt is confirmed. The merchant and courier can
                      now see that your parcel arrived.
                    </p>
                    <div className="recipient-success">
                      <CheckCircle2 size={19} />
                      <span>Thank you for completing the handoff.</span>
                    </div>
                    <p className="recipient-small">
                      The courier’s payment will be processed separately. You
                      can close this page.
                    </p>
                  </>
                ) : (
                  <>
                    <p>{resultMessage}</p>
                    <div className="recipient-note">
                      <CircleAlert size={18} />
                      <span>Keep in touch with the merchant for updates.</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
        <p className="recipient-footer">
          <ShieldCheck size={16} /> A verified human at every handoff.
        </p>
        <p className="recipient-privacy">
          A private, single-purpose link. No account needed.
        </p>
      </main>
    </div>
  );
}
