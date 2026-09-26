import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Package,
  ShieldCheck,
} from "lucide-react";
import {
  formatCoinAmount,
  type CustodyRecord,
} from "@/lib/sui/custody";
import "./custody-records.css";

const EXPLORER = "https://suiscan.xyz/testnet";
const STATE_LABEL = [
  "Funded",
  "Assigned",
  "In transit",
  "Delivered",
  "Disputed",
  "Paid",
  "Refunded",
];
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));

function Address({ value, label }: { value: string; label: string }) {
  return (
    <a
      href={`${EXPLORER}/account/${value}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label} ${value} on SuiScan`}
    >
      {short(value)}
    </a>
  );
}

function Parcel({ record }: { record: CustodyRecord }) {
  const title = record.job?.title ?? "Unlinked parcel";
  return (
    <article className="custody-parcel" aria-label={title}>
      <div className="custody-parcel-top">
        <div>
          <span className="custody-parcel-id">
            {record.job?.id ?? `ref ${record.jobRef.slice(0, 10)}`}
          </span>
          <h2>{title}</h2>
          {record.job && (
            <p className="custody-route">
              {record.job.pickup} → {record.job.destination}
            </p>
          )}
        </div>
        <span className={`custody-state state-${record.state}`}>
          {STATE_LABEL[record.state]}
        </span>
      </div>
      <dl className="custody-facts">
        <div>
          <dt>Parcel with</dt>
          <dd>{record.parcelWith}</dd>
        </div>
        <div>
          <dt>Courier fee</dt>
          <dd>
            {record.funds} · {formatCoinAmount(record.amount, record.coin)}
          </dd>
        </div>
        <div>
          <dt>Merchant</dt>
          <dd>
            <Address value={record.merchant} label="Merchant wallet" />
          </dd>
        </div>
        <div>
          <dt>Courier payout</dt>
          <dd>
            {record.payout ? (
              <Address value={record.payout} label="Courier payout wallet" />
            ) : (
              "Not assigned"
            )}
          </dd>
        </div>
      </dl>
      <ol className="custody-timeline" aria-label={`${title} custody history`}>
        {record.events.map((event) => (
          <li key={event.digest} className={`kind-${event.kind}`}>
            <span className="custody-dot" aria-hidden="true" />
            <div>
              <strong>{event.label}</strong>
              <p>
                <time dateTime={event.at}>{time(event.at)} JST</time> · signed
                by{" "}
                {event.sender === record.merchant
                  ? "merchant"
                  : "Haulie operator"}
              </p>
            </div>
            <a
              href={`${EXPLORER}/tx/${event.digest}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${event.label} transaction ${event.digest} on SuiScan`}
            >
              {short(event.digest)} <ArrowUpRight size={13} />
            </a>
          </li>
        ))}
      </ol>
      <div className="custody-parcel-foot">
        <a
          href={`${EXPLORER}/object/${record.escrowId}`}
          target="_blank"
          rel="noreferrer"
        >
          Escrow object {short(record.escrowId)} <ArrowUpRight size={13} />
        </a>
        {record.coin && !record.coin.isUsdc && (
          <span>Testnet SUI stands in for USDC</span>
        )}
      </div>
    </article>
  );
}

export function CustodyRecords({
  packageId,
  records,
}: {
  packageId: string;
  records: CustodyRecord[] | null;
}) {
  return (
    <main className="custody-page">
      <header className="custody-header">
        <Link href="/courier" className="custody-back">
          <ArrowLeft size={16} /> Deliveries
        </Link>
        <a
          href={`${EXPLORER}/object/${packageId}`}
          target="_blank"
          rel="noreferrer"
          className="custody-back"
        >
          Escrow package <ArrowUpRight size={16} />
        </a>
      </header>
      <div className="custody-layout">
        <section className="custody-intro">
          <div className="custody-title-row">
            <h1>On-chain custody</h1>
            <span className="custody-network">Sui testnet · live</span>
          </div>
          <p>
            Each parcel is a shared escrow object on Sui. Its handoffs and the
            courier fee move through the same state machine, so custody and
            settlement share one tamper-evident record.
          </p>
        </section>
        {records === null ? (
          <div className="custody-message" role="alert">
            <CircleAlert size={18} />
            <p>Sui testnet could not be reached. Refresh to try again.</p>
          </div>
        ) : records.length === 0 ? (
          <div className="custody-message" role="status">
            <Package size={18} />
            <p>No parcels have been escrowed with this package yet.</p>
          </div>
        ) : (
          <div className="custody-list">
            {records.map((record) => (
              <Parcel key={record.escrowId} record={record} />
            ))}
          </div>
        )}
        <footer className="custody-footer">
          <ShieldCheck size={16} />
          <p>
            Operator-attested delivery: the chain records who authorized each
            handoff and enforces the order of custody and payment, but it does
            not prove physical delivery. Only a SHA-256 job reference and public
            wallet addresses are on-chain, never addresses, contacts, or World
            identifiers.
          </p>
        </footer>
      </div>
    </main>
  );
}
