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
  onWorldVerification,
}: {
  job: DemoJob;
  initialRole: DemoRole;
  onClose: () => void;
  onAction: (id: string, action: DemoAction, reason?: string) => void;
  notify: (message: string) => void;
  startWithAcceptance?: boolean;
  acceptanceReady?: boolean;
  onWorldVerification?: (id: string, stage: "ACCEPT" | "PICKUP") => void;
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
    if (onWorldVerification) {
      onWorldVerification(job.id, stage === "ACCEPT" ? "ACCEPT" : "PICKUP");
      return;
    }
    if (stage === "ACCEPT" && !acceptanceReady) {
      notify("Verify your identity and connect a wallet first.");
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
      notify("Verification expired. Try again.");
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
      detail: `${formatMoney(job.fee)} USDC`,
      done: true,
      icon: LockKeyhole,
    },
    {
      title: "Courier verification",
      detail: job.acceptVerified
        ? `${job.courier} · verified`
        : "Required to accept",
      done: !!job.acceptVerified,
      icon: ShieldCheck,
    },
    {
      title: "Pickup",
      detail:
        job.status === "ASSIGNED" && job.pickupVerified
          ? "Awaiting merchant handoff"
          : job.pickupVerified && job.status !== "ASSIGNED"
            ? "Handoff confirmed"
            : "Verification and handoff required",
      done:
        !!job.pickupVerified && !["ASSIGNED", "FUNDED"].includes(job.status),
      icon: Package,
    },
    {
      title: "Delivery",
      detail: job.recipientConfirmed
        ? "Receipt confirmed"
        : "Awaiting recipient",
      done: !!job.recipientConfirmed,
      icon: CircleCheck,
    },
    {
      title: "Payment",
      detail:
        job.status === "PAID"
          ? "Payment recorded"
          : "After delivery confirmation",
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
            <DeliveryMap compact job={job} />
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
                    ? "Payment recorded"
                    : job.status === "DISPUTED"
                      ? "Payout frozen"
                      : job.status === "REFUNDED"
                        ? "Refund recorded"
                        : "Courier fee reserved"}
                </strong>
                <small>{job.payoutWallet || "Wallet set when accepted"}</small>
              </span>
            </div>
            <b>
              {formatMoney(job.fee)} <small>USDC</small>
            </b>
            <p>Simulated settlement · no on-chain transfer.</p>
          </div>
          {job.courier && (
            <div className="detail-courier">
              <span className="avatar avatar-2">{job.initials}</span>
              <span>
                <strong>{job.courier}</strong>
                <small>
                  <ShieldCheck size={13} />
                  Test verification
                </small>
              </span>
              <Bike size={21} />
            </div>
          )}
        </div>
        <div className="detail-right">
          <h3 className="timeline-heading">Delivery progress</h3>
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
              {!onWorldVerification && (
                <div className="role-tabs" aria-label="Workspace role">
                  {(
                    [
                      "Merchant",
                      "Courier",
                      "Recipient",
                      "Operator",
                    ] as DemoRole[]
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
              )}
              {verification ? (
                <div className="proof-panel">
                  <h3>Verify this delivery</h3>
                  <p>
                    {verification.stage === "ACCEPT"
                      ? "Verify your identity to accept."
                      : "Verify again before pickup."}
                  </p>
                  <button
                    className="button button-primary full-width"
                    disabled={busy}
                    onClick={confirmProof}
                  >
                    {busy ? (
                      <>
                        <span className="button-spinner" />
                        Checking…
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={17} />
                        Run test verification
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
                    Test check. No World proof is requested.
                  </small>
                  <a
                    href={`/world-sandbox?job=${encodeURIComponent(job.id)}`}
                    className="text-button centered"
                  >
                    Verify with World
                  </a>
                </div>
              ) : (
                <div className="stage-action">
                  {role === "Courier" &&
                    job.courier &&
                    !isOwnCourierJob(job) && (
                      <div className="notice">
                        <ShieldCheck size={18} />
                        <p>
                          Assigned to {job.courier}. You’re signed in as{" "}
                          {DEMO_COURIER.name}.
                        </p>
                      </div>
                    )}
                  {job.status === "FUNDED" &&
                    (role === "Courier" ? (
                      <>
                        <h4>Accept this delivery</h4>
                        <p>Your connected wallet receives the delivery fee.</p>
                        <button
                          className="button button-primary full-width"
                          disabled={!acceptanceReady}
                          onClick={() => requestProof("ACCEPT")}
                        >
                          <ShieldCheck size={16} />
                          Verify & accept
                        </button>
                        {!acceptanceReady && (
                          <p>
                            Verify your identity and connect a wallet first.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h4>Awaiting a courier</h4>
                        <p>Select Courier to accept this delivery.</p>
                        {role === "Merchant" && (
                          <button
                            className="text-button danger-text"
                            onClick={() => onAction(job.id, "REFUND")}
                          >
                            Cancel delivery
                          </button>
                        )}
                      </>
                    ))}
                  {job.status === "ASSIGNED" &&
                    (role === "Courier" && isOwnCourierJob(job) ? (
                      <>
                        <h4>
                          {job.pickupVerified
                            ? "Awaiting merchant handoff"
                            : "Verify at pickup"}
                        </h4>
                        <p>
                          {job.pickupVerified
                            ? "The merchant must confirm handing you the parcel."
                            : "Verify your identity before collecting the parcel."}
                        </p>
                        <button
                          className="button button-primary full-width"
                          disabled={job.pickupVerified}
                          onClick={() => requestProof("VERIFY_PICKUP")}
                        >
                          <ShieldCheck size={16} />
                          {job.pickupVerified
                            ? "Pickup check complete"
                            : "Verify pickup"}
                        </button>
                        {!job.worldPickedUpAt && (
                          <button
                            className="text-button centered"
                            onClick={() => onAction(job.id, "UNASSIGN")}
                          >
                            Cancel assignment
                          </button>
                        )}
                      </>
                    ) : role === "Merchant" ? (
                      <>
                        <h4>
                          {job.pickupVerified
                            ? "Confirm handoff"
                            : "Awaiting pickup verification"}
                        </h4>
                        <p>
                          {job.pickupVerified
                            ? "Confirm after handing the parcel to the courier."
                            : "The courier must verify before handoff."}
                        </p>
                        <button
                          className="button button-primary full-width"
                          disabled={!job.pickupVerified}
                          onClick={() => onAction(job.id, "HANDOFF")}
                        >
                          <Package size={16} />
                          {job.pickupVerified
                            ? "Confirm handoff"
                            : "Awaiting verification"}
                        </button>
                      </>
                    ) : (
                      <>
                        <h4>Awaiting pickup</h4>
                        <p>
                          Courier verification and merchant handoff are
                          required.
                        </p>
                      </>
                    ))}
                  {job.status === "PICKED_UP" &&
                    (role === "Recipient" ? (
                      <>
                        <h4>Confirm delivery</h4>
                        <p>
                          Check the parcel and its condition before confirming.
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
                        <h4>Deliver the parcel</h4>
                        <p>Ask the recipient to confirm receipt.</p>
                        <button
                          className="button button-secondary full-width"
                          onClick={() => onAction(job.id, "ATTEMPT")}
                        >
                          <MapPin size={16} />
                          Recipient unavailable
                        </button>
                      </>
                    ) : (
                      <>
                        <h4>In transit</h4>
                        <p>Select Recipient to confirm delivery.</p>
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
                          ? "Retry payment"
                          : "Ready for payment"}
                      </h4>
                      <p>
                        {job.status === "PAYOUT_RETRY"
                          ? "Retry payment to the assigned wallet."
                          : "Receipt confirmed. The courier fee is ready."}
                      </p>
                      <button
                        className="button button-primary full-width"
                        disabled={busy}
                        onClick={payout}
                      >
                        {busy ? (
                          <>
                            <span className="button-spinner" />
                            Processing…
                          </>
                        ) : (
                          <>
                            <Wallet size={16} />
                            {job.status === "PAYOUT_RETRY"
                              ? "Retry simulated payment"
                              : "Simulate payment"}
                          </>
                        )}
                      </button>
                      {job.status === "DELIVERY_CONFIRMED" && (
                        <button
                          className="text-button centered"
                          disabled={busy}
                          onClick={() => onAction(job.id, "FAIL_PAYOUT")}
                        >
                          Test payment failure
                        </button>
                      )}
                    </>
                  )}
                  {job.status === "DISPUTED" && (
                    <>
                      <span className="dispute-symbol">
                        <CircleAlert size={23} />
                      </span>
                      <h4>Dispute under review</h4>
                      <p className="dispute-reason">{job.disputeReason}</p>
                      <p>
                        Payout is paused until an operator resolves the dispute.
                      </p>
                      {role === "Operator" ? (
                        <button
                          className="button button-primary full-width"
                          onClick={() => onAction(job.id, "RESOLVE")}
                        >
                          <Check size={16} />
                          Resolve & resume
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
              <h3>Delivery complete</h3>
              <p>
                {formatMoney(job.fee)} USDC recorded for {job.courier}.
              </p>
            </div>
          )}
          {job.status === "REFUNDED" && (
            <div className="success-panel">
              <RotateCcw size={28} />
              <h3>Delivery refunded</h3>
              <p>{formatMoney(job.fee)} USDC refund recorded.</p>
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
                      What happened?
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
                    Report an issue
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
