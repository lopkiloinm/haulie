"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Bike,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Copy,
  LockKeyhole,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { DeliveryMap } from "./delivery-map";
import {
  DEMO_COURIER,
  isOwnCourierJob,
  STATUS,
  formatMoney,
  type DemoAction,
  type DemoJob,
  type DemoRole,
} from "@/lib/demo";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const id = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        const outside = !ref.current?.contains(document.activeElement);
        if (
          e.shiftKey &&
          (outside ||
            document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (outside ||
            document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <div className="modal-header">
          <div>
            {subtitle && <span className="mini-label">{subtitle}</span>}
            <h2 id={id}>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function DeliveryDetail({
  job,
  initialRole,
  onClose,
  onAction,
  notify,
  startWithAcceptance = false,
  acceptanceReady = true,
}: {
  job: DemoJob;
  initialRole: DemoRole;
  onClose: () => void;
  onAction: (id: string, action: DemoAction, reason?: string) => void;
  notify: (message: string) => void;
  startWithAcceptance?: boolean;
  acceptanceReady?: boolean;
}) {
  const [role, setRole] = useState<DemoRole>(initialRole);
  const [verification, setVerification] = useState<{
    stage: "ACCEPT" | "VERIFY_PICKUP";
    nonce: string;
    expires: number;
  } | null>(() =>
    startWithAcceptance && acceptanceReady && job.status === "FUNDED"
      ? {
          stage: "ACCEPT",
          nonce: crypto.randomUUID(),
          expires: Date.now() + 120000,
        }
      : null,
  );
  const [receipt, setReceipt] = useState(false);
  const [issue, setIssue] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  function requestProof(stage: "ACCEPT" | "VERIFY_PICKUP") {
    if (stage === "ACCEPT" && !acceptanceReady) {
      notify("Complete demo enrollment and connect the demo wallet first.");
      return;
    }
    setVerification({
      stage,
      nonce: crypto.randomUUID(),
      expires: Date.now() + 120000,
    });
  }
  function confirmProof() {
    if (!verification || busy) return;
    if (verification.expires < Date.now()) {
      setVerification(null);
      notify("This demo request expired. Start a fresh verification.");
      return;
    }
    const stage = verification.stage;
    setBusy(true);
    timers.current.push(
      setTimeout(() => {
        onAction(job.id, stage);
        setVerification(null);
        setBusy(false);
      }, 700),
    );
  }
  function payout() {
    if (busy) return;
    setBusy(true);
    timers.current.push(
      setTimeout(() => {
        onAction(job.id, "PAY");
        setBusy(false);
      }, 900),
    );
  }
  const s = STATUS[job.status];
  const steps = [
    {
      title: "Funds reserved",
      detail: `${formatMoney(job.fee)} demo USDC ready for this delivery`,
      done: true,
      icon: LockKeyhole,
    },
    {
      title: "Courier freshly verified",
      detail: job.acceptVerified
        ? `${job.courier} · verified for this delivery`
        : "A new session check is required to accept",
      done: !!job.acceptVerified,
      icon: ShieldCheck,
    },
    {
      title: "Pickup, confirmed together",
      detail:
        job.status === "ASSIGNED" && job.pickupVerified
          ? "Courier checked. Waiting for merchant handoff."
          : job.pickupVerified && job.status !== "ASSIGNED"
            ? "Fresh courier check + merchant confirmation"
            : "A second check and merchant confirmation",
      done:
        !!job.pickupVerified && !["ASSIGNED", "FUNDED"].includes(job.status),
      icon: Package,
    },
    {
      title: "Safe in the recipient’s hands",
      detail: job.recipientConfirmed
        ? "The recipient confirmed receipt"
        : "The recipient independently confirms receipt",
      done: !!job.recipientConfirmed,
      icon: CircleCheck,
    },
    {
      title:
        job.status === "PAID"
          ? "Demo courier payout complete"
          : "Courier payment released",
      detail:
        job.status === "PAID"
          ? "Simulated payment · no on-chain transaction"
          : "Only after confirmation, with no open dispute",
      done: job.status === "PAID",
      icon: Wallet,
    },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);
  return (
    <Modal
      title={job.title}
      subtitle={`DELIVERY ${job.id}`}
      onClose={onClose}
      wide
    >
      <div className="detail-topline">
        <span className={`badge badge-${s.tone}`}>
          <span className="status-dot" />
          {s.label}
        </span>
        <span className="detail-demo-label">
          <Sparkles size={13} />
          Interactive demo · no real funds
        </span>
        <button
          className="text-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(job.id);
              notify("Delivery reference copied.");
            } catch {
              notify(`Delivery reference: ${job.id}`);
            }
          }}
        >
          <Copy size={13} />
          Copy reference
        </button>
      </div>
      <div className="detail-grid">
        <div className="detail-left">
          <div className="detail-map">
            <DeliveryMap compact stage={job.status} />
          </div>
          <div className="detail-route">
            <div>
              <span className="route-dot" />
              <span>
                <small>PICKUP · {job.pickup}</small>
                <strong>{job.pickupAddress}</strong>
                <span>The Everyday Store</span>
              </span>
            </div>
            <div>
              <span className="route-dot route-dot-destination" />
              <span>
                <small>DROP-OFF · {job.destination}</small>
                <strong>{job.destinationAddress}</strong>
                <span>{job.recipient}</span>
              </span>
            </div>
          </div>
          <div className="detail-facts">
            <span>
              <Package size={15} />
              {job.category}
            </span>
            <span>
              <Clock3 size={15} />
              {job.window}
            </span>
          </div>
          <div className="escrow-box">
            <div>
              <span className="escrow-icon">
                <LockKeyhole size={21} />
              </span>
              <span>
                <strong>
                  {job.status === "PAID"
                    ? "Demo payout completed"
                    : job.status === "DISPUTED"
                      ? "Payout frozen"
                      : job.status === "REFUNDED"
                        ? "Demo funds returned"
                        : "Courier fee reserved"}
                </strong>
                <small>
                  {job.payoutWallet || "Payout wallet fixed at acceptance"}
                </small>
              </span>
            </div>
            <b>
              {formatMoney(job.fee)} <small>USDC</small>
            </b>
            <p>
              {job.status === "PAID"
                ? "There is no transaction digest: this is a simulated payment."
                : "Demo balance only. Live escrow holds native USDC on Sui."}
            </p>
          </div>
          {job.courier && (
            <div className="detail-courier">
              <span className="avatar avatar-2">{job.initials}</span>
              <span>
                <strong>{job.courier}</strong>
                <small>
                  <ShieldCheck size={13} />
                  Verified for this delivery · demo
                </small>
              </span>
              <Bike size={21} />
            </div>
          )}
        </div>
        <div className="detail-right">
          <h3 className="timeline-heading">
            A clear path, from here to there.
          </h3>
          <div className="delivery-timeline">
            {steps.map((step, index) => (
              <div
                className={`timeline-step ${step.done ? "step-done" : ""} ${index === currentIndex ? "step-current" : ""}`}
                key={step.title}
              >
                <span className="timeline-icon">
                  {step.done ? <Check size={15} /> : <step.icon size={15} />}
                </span>
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </span>
                {index === currentIndex &&
                  job.status !== "DISPUTED" &&
                  job.status !== "REFUNDED" && (
                    <span className="next-label">NEXT</span>
                  )}
              </div>
            ))}
          </div>
          {job.status !== "PAID" && job.status !== "REFUNDED" && (
            <div className="handoff-controls">
              <div className="control-heading">
                <span className="mini-label">TRY THE NEXT HANDOFF</span>
                <span>View as</span>
              </div>
              <div className="role-tabs" aria-label="Demo role">
                {(
                  ["Merchant", "Courier", "Recipient", "Operator"] as DemoRole[]
                ).map((r) => (
                  <button
                    key={r}
                    aria-pressed={r === role}
                    className={r === role ? "role-selected" : ""}
                    onClick={() => {
                      setRole(r);
                      setVerification(null);
                      setIssue(false);
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {verification ? (
                <div className="proof-panel">
                  <span className="proof-orb">
                    <GlobeMark />
                  </span>
                  <span className="mini-label">FRESH SESSION CHECK · DEMO</span>
                  <h3>Same human. New handoff.</h3>
                  <p>
                    A new proof is required for <strong>{job.id}</strong> at{" "}
                    <strong>
                      {verification.stage === "ACCEPT"
                        ? "acceptance"
                        : "pickup"}
                    </strong>
                    . An old verification badge cannot approve this step.
                  </p>
                  <div className="proof-context">
                    <span>Request</span>
                    <code>{verification.nonce.slice(0, 8)}…</code>
                    <span>Expires</span>
                    <strong>2 minutes from request</strong>
                  </div>
                  <button
                    className="button button-primary full-width"
                    disabled={busy}
                    onClick={confirmProof}
                  >
                    {busy ? (
                      <>
                        <span className="button-spinner" />
                        Simulating check…
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={17} />
                        Simulate fresh verification
                      </>
                    )}
                  </button>
                  <button
                    className="text-button centered"
                    disabled={busy}
                    onClick={() => setVerification(null)}
                  >
                    Cancel
                  </button>
                  <small className="proof-disclaimer">
                    No World ID proof is requested or verified in this demo.
                  </small>
                </div>
              ) : (
                <div className="stage-action">
                  {role === "Courier" &&
                    job.courier &&
                    !isOwnCourierJob(job) && (
                      <div className="notice">
                        <ShieldCheck size={18} />
                        <p>
                          This delivery is assigned to {job.courier}. You’re
                          viewing as {DEMO_COURIER.name}; only the assigned
                          courier can verify pickup or cancel the assignment.
                        </p>
                      </div>
                    )}
                  {job.status === "FUNDED" &&
                    (role === "Courier" ? (
                      <>
                        <h4>A good delivery starts with you.</h4>
                        <p>
                          Complete a fresh demo check to accept. The payout
                          address will be fixed to this assignment.
                        </p>
                        <button
                          className="button button-primary full-width"
                          disabled={!acceptanceReady}
                          onClick={() => requestProof("ACCEPT")}
                        >
                          <ShieldCheck size={16} />
                          Verify & accept delivery
                        </button>
                        {!acceptanceReady && (
                          <p>
                            Complete demo enrollment and connect your demo
                            payout wallet in the courier workspace first.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h4>Ready for a verified courier.</h4>
                        <p>
                          Demo funds are reserved. Switch to the courier view to
                          complete a fresh acceptance check.
                        </p>
                        {role === "Merchant" && (
                          <button
                            className="text-button danger-text"
                            onClick={() => onAction(job.id, "REFUND")}
                          >
                            Cancel & refund demo funds
                          </button>
                        )}
                      </>
                    ))}
                  {job.status === "ASSIGNED" &&
                    (role === "Courier" && isOwnCourierJob(job) ? (
                      <>
                        <h4>
                          {job.pickupVerified
                            ? "You’re checked in. Ready to hand over."
                            : "At pickup? Time for a fresh check."}
                        </h4>
                        <p>
                          {job.pickupVerified
                            ? "The merchant must now confirm that the parcel has been handed to you."
                            : "Your acceptance check cannot be reused. Complete a second check for this pickup."}
                        </p>
                        <button
                          className="button button-primary full-width"
                          disabled={job.pickupVerified}
                          onClick={() => requestProof("VERIFY_PICKUP")}
                        >
                          <ShieldCheck size={16} />
                          {job.pickupVerified
                            ? "Pickup check complete"
                            : "Verify for this pickup"}
                        </button>
                        <button
                          className="text-button centered"
                          onClick={() => onAction(job.id, "UNASSIGN")}
                        >
                          Cancel assignment before pickup
                        </button>
                      </>
                    ) : role === "Merchant" ? (
                      <>
                        <h4>
                          {job.pickupVerified
                            ? "Your courier is ready."
                            : "A fresh pickup check comes first."}
                        </h4>
                        <p>
                          {job.pickupVerified
                            ? "Confirm only once the parcel is in the courier’s hands."
                            : "Do not hand over the parcel until the courier completes the pickup verification."}
                        </p>
                        <button
                          className="button button-primary full-width"
                          disabled={!job.pickupVerified}
                          onClick={() => onAction(job.id, "HANDOFF")}
                        >
                          <Package size={16} />
                          {job.pickupVerified
                            ? "Confirm parcel handoff"
                            : "Waiting for courier verification"}
                        </button>
                      </>
                    ) : (
                      <>
                        <h4>Getting ready to go.</h4>
                        <p>
                          The courier and merchant must both confirm pickup
                          before the delivery can move forward.
                        </p>
                      </>
                    ))}
                  {job.status === "PICKED_UP" &&
                    (role === "Recipient" ? (
                      <>
                        <h4>Your parcel made it.</h4>
                        <p>
                          Check that you’ve received the right parcel and it’s
                          in good condition before confirming.
                        </p>
                        <label className="checkbox-label receipt-check">
                          <input
                            type="checkbox"
                            checked={receipt}
                            onChange={(e) => setReceipt(e.target.checked)}
                          />
                          <span>I have received this parcel.</span>
                        </label>
                        <button
                          className="button button-primary full-width"
                          disabled={!receipt}
                          onClick={() => onAction(job.id, "CONFIRM_RECEIPT")}
                        >
                          <CircleCheck size={16} />
                          Confirm receipt
                        </button>
                      </>
                    ) : role === "Courier" && isOwnCourierJob(job) ? (
                      <>
                        <h4>On your way to a good handoff.</h4>
                        <p>
                          The recipient must confirm receipt. You can record an
                          attempt if they’re unavailable.
                        </p>
                        <button
                          className="button button-secondary full-width"
                          onClick={() => onAction(job.id, "ATTEMPT")}
                        >
                          <MapPin size={16} />
                          Record unavailable recipient
                        </button>
                      </>
                    ) : (
                      <>
                        <h4>Good things are on the way.</h4>
                        <p>
                          The courier has the parcel. Switch to the recipient
                          view to confirm it arrived safely.
                        </p>
                        <span className="waiting-label">
                          <Clock3 size={14} />
                          Waiting for recipient confirmation
                        </span>
                      </>
                    ))}
                  {["DELIVERY_CONFIRMED", "PAYOUT_RETRY"].includes(
                    job.status,
                  ) && (
                    <>
                      <h4>
                        {job.status === "PAYOUT_RETRY"
                          ? "Ready for a careful retry."
                          : "Delivered, with everyone in the loop."}
                      </h4>
                      <p>
                        {job.status === "PAYOUT_RETRY"
                          ? "Receipt is still confirmed. Retry settlement without changing the payout address or releasing funds twice."
                          : "Both courier checks and both handoffs are complete. The reserved fee can now be released."}
                      </p>
                      <button
                        className="button button-primary full-width"
                        disabled={busy}
                        onClick={payout}
                      >
                        {busy ? (
                          <>
                            <span className="button-spinner" />
                            Processing demo payout…
                          </>
                        ) : (
                          <>
                            <Wallet size={16} />
                            {job.status === "PAYOUT_RETRY"
                              ? "Retry demo payout"
                              : "Process demo payout"}
                          </>
                        )}
                      </button>
                      {job.status === "DELIVERY_CONFIRMED" && (
                        <button
                          className="text-button centered"
                          disabled={busy}
                          onClick={() => onAction(job.id, "FAIL_PAYOUT")}
                        >
                          Try a failed settlement
                        </button>
                      )}
                    </>
                  )}
                  {job.status === "DISPUTED" && (
                    <>
                      <span className="dispute-symbol">
                        <CircleAlert size={23} />
                      </span>
                      <h4>This delivery needs a little attention.</h4>
                      <p className="dispute-reason">{job.disputeReason}</p>
                      <p>
                        Automatic payout is frozen. An operator must review the
                        case before it can continue.
                      </p>
                      {role === "Operator" ? (
                        <button
                          className="button button-primary full-width"
                          onClick={() => onAction(job.id, "RESOLVE")}
                        >
                          <Check size={16} />
                          Resolve demo case & resume
                        </button>
                      ) : (
                        <span className="waiting-label">
                          <LockKeyhole size={14} />
                          Payout locked during review
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {job.status === "PAID" && (
            <div className="success-panel">
              <CircleCheck size={30} />
              <h3>A good delivery, all around.</h3>
              <p>
                {formatMoney(job.fee)} demo USDC paid to {job.courier}. No real
                transfer took place.
              </p>
            </div>
          )}
          {job.status === "REFUNDED" && (
            <div className="success-panel">
              <RotateCcw size={28} />
              <h3>Back where it started.</h3>
              <p>
                {formatMoney(job.fee)} demo USDC has been returned to the
                merchant balance.
              </p>
            </div>
          )}
          {[
            "ASSIGNED",
            "PICKED_UP",
            "DELIVERY_CONFIRMED",
            "PAYOUT_RETRY",
          ].includes(job.status) &&
            !verification && (
              <div className="report-issue">
                {issue ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onAction(job.id, "DISPUTE", reason);
                      setIssue(false);
                    }}
                  >
                    <label>
                      Tell us what happened
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                        minLength={5}
                        maxLength={500}
                        placeholder="e.g. The parcel arrived damaged"
                      />
                    </label>
                    <div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setIssue(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button button-secondary button-small"
                        type="submit"
                      >
                        Report & freeze payout
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => setIssue(true)}
                  >
                    <CircleAlert size={14} />
                    Something not right? Report an issue
                  </button>
                )}
              </div>
            )}
        </div>
      </div>
      <details className="audit-log">
        <summary>
          <Clock3 size={15} />
          Delivery activity <span>{job.events.length} events</span>
        </summary>
        <div>
          {job.events.map((event, index) => (
            <div key={index}>
              <span />
              <strong>{event.title}</strong>
              <small>{event.actor}</small>
              <time suppressHydrationWarning>
                {new Date(event.at).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      </details>
    </Modal>
  );
}
function GlobeMark() {
  return (
    <svg viewBox="0 0 40 40" width="42" height="42" aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="8"
        ry="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4 20h32M7 11h26M7 29h26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
