import { createHash } from "node:crypto";
import { z } from "zod";
import { INITIAL_STATE } from "../demo";
import { ESCROW_STATE } from "./types";
import { LIVE_ESCROW } from "./live-escrow-config";

/** Published by scripts/publish-escrow.mts; override for a redeployed package. */
export const TESTNET_ESCROW_PACKAGE = LIVE_ESCROW.packageId;
const GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";
const MAX_EVENT_PAGES = 4;

export const CUSTODY_EVENT_LABEL: Record<number, string> = {
  0: "Fee escrowed by merchant",
  1: "Assigned to courier payout wallet",
  2: "Picked up · custody to courier",
  3: "Delivery confirmed by recipient",
  4: "Disputed · payout frozen",
  5: "Released to courier",
  6: "Refunded to merchant",
  7: "Courier unassigned",
};

export type CustodyEvent = {
  kind: number;
  label: string;
  at: string;
  digest: string;
  sender: string;
  recipient: string;
};

export type CustodyRecord = {
  escrowId: string;
  jobRef: string;
  job: { id: string; title: string; pickup: string; destination: string } | null;
  coin: { symbol: string; decimals: number; isUsdc: boolean } | null;
  amount: string;
  merchant: string;
  payout: string | null;
  state: number;
  parcelWith: string;
  funds: string;
  events: CustodyEvent[];
};

const address = z.string().regex(/^0x[0-9a-f]{64}$/);
const EventNode = z.object({
  timestamp: z.string(),
  sender: z.object({ address }),
  transaction: z.object({ digest: z.string().min(32) }),
  contents: z.object({
    json: z.object({
      escrow_id: address,
      job_ref: z.string(),
      kind: z.number().int().min(0).max(7),
      amount: z.string().regex(/^\d+$/),
      recipient: address,
    }),
  }),
});
const EventsResponse = z.object({
  data: z.object({
    events: z.object({
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      }),
      nodes: z.array(EventNode),
    }),
  }),
});
const EscrowJson = z.object({
  merchant: address,
  amount: z.string().regex(/^\d+$/),
  funds: z.string().regex(/^\d+$/),
  payout: address,
  state: z.number().int().min(0).max(6),
});
const EscrowObject = z
  .object({
    asMoveObject: z.object({
      contents: z.object({
        type: z.object({ repr: z.string() }),
        json: EscrowJson,
      }),
    }),
  })
  .nullable();

const ZERO_ADDRESS = `0x${"0".repeat(64)}`;

const jobRefHex = (jobId: string) =>
  createHash("sha256").update(`haulie:job:${jobId}`).digest("hex");
const KNOWN_JOBS = new Map(
  INITIAL_STATE.jobs.map((job) => [
    jobRefHex(job.id),
    {
      id: job.id,
      title: job.title,
      pickup: job.pickup,
      destination: job.destination,
    },
  ]),
);

export function coinFromEscrowType(type: string, packageId: string) {
  const match = type.match(/^(0x[0-9a-f]+)::escrow::Escrow<(.+)>$/);
  if (!match || match[1] !== packageId) return null;
  if (/^0x0*2::sui::SUI$/.test(match[2]))
    return { symbol: "SUI", decimals: 9, isUsdc: false };
  if (match[2].endsWith("::usdc::USDC"))
    return { symbol: "USDC", decimals: 6, isUsdc: true };
  return null;
}

/** Physical custody and fund location implied by the latest on-chain state. */
export function custodyStatus(state: number, events: CustodyEvent[]) {
  if (state === ESCROW_STATE.DISPUTED) {
    const before = events.findLast((event) => event.kind !== 4)?.kind;
    return {
      parcelWith:
        before === ESCROW_STATE.PICKED_UP
          ? "Courier"
          : before === ESCROW_STATE.DELIVERY_CONFIRMED
            ? "Recipient"
            : "Merchant",
      funds: "Frozen in escrow",
    };
  }
  switch (state) {
    case ESCROW_STATE.FUNDED:
    case ESCROW_STATE.ASSIGNED:
      return { parcelWith: "Merchant", funds: "Held in escrow" };
    case ESCROW_STATE.PICKED_UP:
      return { parcelWith: "Courier", funds: "Held in escrow" };
    case ESCROW_STATE.DELIVERY_CONFIRMED:
      return { parcelWith: "Recipient", funds: "Held in escrow" };
    case ESCROW_STATE.PAID:
      return { parcelWith: "Recipient", funds: "Released to courier" };
    default:
      return { parcelWith: "Merchant", funds: "Returned to merchant" };
  }
}

export function buildCustodyRecords(
  nodes: z.infer<typeof EventNode>[],
  objects: Record<string, z.infer<typeof EscrowObject>>,
  packageId: string,
): CustodyRecord[] {
  const grouped = new Map<string, z.infer<typeof EventNode>[]>();
  for (const node of nodes) {
    const id = node.contents.json.escrow_id;
    grouped.set(id, [...(grouped.get(id) ?? []), node]);
  }
  const records: CustodyRecord[] = [];
  for (const [escrowId, group] of grouped) {
    const object = objects[escrowId]?.asMoveObject.contents;
    if (!object) continue;
    const coin = coinFromEscrowType(object.type.repr, packageId);
    const jobRef = Buffer.from(group[0].contents.json.job_ref, "base64").toString(
      "hex",
    );
    if (jobRef.length !== 64) continue;
    const events = group
      .map((node) => ({
        kind: node.contents.json.kind,
        label: CUSTODY_EVENT_LABEL[node.contents.json.kind],
        at: node.timestamp,
        digest: node.transaction.digest,
        sender: node.sender.address,
        recipient: node.contents.json.recipient,
      }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    records.push({
      escrowId,
      jobRef,
      job: KNOWN_JOBS.get(jobRef) ?? null,
      coin,
      amount: object.json.amount,
      merchant: object.json.merchant,
      payout: object.json.payout === ZERO_ADDRESS ? null : object.json.payout,
      state: object.json.state,
      ...custodyStatus(object.json.state, events),
      events,
    });
  }
  return records.sort(
    (a, b) =>
      Date.parse(b.events.at(-1)!.at) - Date.parse(a.events.at(-1)!.at),
  );
}

async function graphql(query: string, variables: Record<string, unknown>) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Sui GraphQL returned ${response.status}.`);
  return response.json();
}

export function custodyPackageId() {
  const configured = process.env.SUI_ESCROW_PACKAGE_ID?.trim().toLowerCase();
  return configured && address.safeParse(configured).success
    ? configured
    : TESTNET_ESCROW_PACKAGE;
}

/** Reads every escrow event for the package live from Sui testnet. */
export async function loadCustodyRecords(packageId = custodyPackageId()) {
  const nodes: z.infer<typeof EventNode>[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const body = EventsResponse.parse(
      await graphql(
        `query($type: String!, $after: String) {
          events(filter: { type: $type }, first: 50, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { timestamp sender { address } transaction { digest }
              contents { json } }
          }
        }`,
        { type: `${packageId}::escrow::EscrowEvent`, after },
      ),
    );
    nodes.push(...body.data.events.nodes);
    if (!body.data.events.pageInfo.hasNextPage) break;
    after = body.data.events.pageInfo.endCursor;
  }
  const ids = [...new Set(nodes.map((node) => node.contents.json.escrow_id))];
  const objects: Record<string, z.infer<typeof EscrowObject>> = {};
  if (ids.length) {
    const aliases = ids
      .map(
        (id, index) =>
          `o${index}: object(address: "${address.parse(id)}") { asMoveObject { contents { type { repr } json } } }`,
      )
      .join("\n");
    const body = z
      .object({ data: z.record(z.string(), EscrowObject) })
      .parse(await graphql(`{ ${aliases} }`, {}));
    ids.forEach((id, index) => (objects[id] = body.data[`o${index}`]));
  }
  return buildCustodyRecords(nodes, objects, packageId);
}

export function formatCoinAmount(
  amount: string,
  coin: CustodyRecord["coin"],
): string {
  if (!coin) return `${amount} base units`;
  const value = BigInt(amount);
  const scale = 10n ** BigInt(coin.decimals);
  const fraction = (value % scale)
    .toString()
    .padStart(coin.decimals, "0")
    .replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""} ${coin.symbol}`;
}
