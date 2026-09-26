import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ESCROW_STATE } from "@/lib/sui/types";
import {
  LiveEscrowError,
  liveEscrowReady,
  operatorCalls,
  readLiveEscrow,
  receiptToken,
  validReceiptToken,
  verifyMerchantHandoff,
} from "@/lib/sui/live-escrow";
import {
  readWorldSession,
  secure,
  worldConfig,
  worldReady,
} from "@/lib/world-sandbox/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = ["HL-1046", "HL-1048", "HL-1047", "HL-1045", "HL-1044", "HL-1043"];
const base = {
  job: z.enum(jobs as [string, ...string[]]),
  escrowId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
};
const schemas = {
  assign: z.object(base).strict(),
  unassign: z.object(base).strict(),
  handoff: z
    .object({ ...base, signature: z.string().min(40).max(4000) })
    .strict(),
  deliver: z
    .object({ ...base, token: z.string().min(20).max(100) })
    .strict(),
};
type Operation = keyof typeof schemas;

function json(data: object, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!Object.hasOwn(schemas, operation))
    return json({ error: "Not found." }, 404);
  const permittedOrigin = secure ? worldConfig().origin : request.nextUrl.origin;
  if (request.headers.get("origin") !== permittedOrigin)
    return json({ error: "Request origin rejected." }, 403);
  if (!liveEscrowReady() || !worldReady())
    return json({ error: "On-chain escrow is not configured." }, 503);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return json({ error: "JSON required." }, 415);
  const text = await request.text();
  if (text.length > 6000) return json({ error: "Request too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = schemas[operation as Operation].safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const input = parsed.data as z.infer<(typeof schemas)["handoff"]> &
    z.infer<(typeof schemas)["deliver"]>;

  try {
    if (operation === "deliver") {
      if (!validReceiptToken(input.escrowId, input.token, worldConfig().sessionKey))
        return json({ error: "This receipt link is not valid." }, 403);
      const escrow = await readLiveEscrow(input.escrowId, input.job);
      if (escrow.state === ESCROW_STATE.PAID)
        return json({ digest: escrow.previousTransaction, payout: escrow.payout, amount: escrow.amount, reconciled: true });
      const calls =
        escrow.state === ESCROW_STATE.PICKED_UP
          ? (["confirm_delivery", "release"] as const)
          : escrow.state === ESCROW_STATE.DELIVERY_CONFIRMED
            ? (["release"] as const)
            : null;
      if (!calls)
        return json({ error: "This delivery is not ready for payment." }, 409);
      const digest = await operatorCalls(escrow.id, [...calls]);
      return json({ digest, payout: escrow.payout, amount: escrow.amount });
    }

    // Courier authority comes only from the server-verified World session.
    const session = await readWorldSession(request);
    const record = session.jobs[input.job];
    if (!session.subject || !record?.accepted || !record.payoutWallet)
      return json({ error: "Accept this delivery with World first." }, 409);
    if (operation === "handoff" && !record.pickedUp)
      return json({ error: "The courier must verify pickup with World first." }, 409);
    const escrow = await readLiveEscrow(input.escrowId, input.job);
    const ownAssignment =
      escrow.state === ESCROW_STATE.ASSIGNED &&
      escrow.payout === record.payoutWallet;

    if (operation === "assign") {
      if (ownAssignment)
        return json({ digest: escrow.previousTransaction, reconciled: true });
      if (escrow.state !== ESCROW_STATE.FUNDED)
        return json({ error: "Another courier already holds this escrow." }, 409);
      const digest = await operatorCalls(escrow.id, ["assign"], record.payoutWallet);
      return json({ digest });
    }

    if (operation === "unassign") {
      if (record.pickedUp)
        return json({ error: "This delivery can no longer be cancelled." }, 409);
      if (escrow.state === ESCROW_STATE.FUNDED)
        return json({ digest: escrow.previousTransaction, reconciled: true });
      if (!ownAssignment)
        return json({ error: "This escrow is not assigned to you." }, 409);
      const digest = await operatorCalls(escrow.id, ["unassign"]);
      return json({ digest });
    }

    // Handoff: fresh World pickup check plus the funding merchant's signature.
    await verifyMerchantHandoff(escrow, input.job, input.signature);
    const token = receiptToken(escrow.id, worldConfig().sessionKey);
    if (
      escrow.state === ESCROW_STATE.PICKED_UP &&
      escrow.payout === record.payoutWallet
    )
      return json({ digest: escrow.previousTransaction, receiptToken: token, reconciled: true });
    if (!ownAssignment)
      return json({ error: "This escrow is not assigned to this courier." }, 409);
    const digest = await operatorCalls(escrow.id, ["confirm_pickup"]);
    return json({ digest, receiptToken: token });
  } catch (error) {
    if (error instanceof LiveEscrowError)
      return json({ error: error.message }, error.status);
    console.error("Escrow operation failed", operation, error);
    return json({ error: "Sui is unavailable. Try again shortly." }, 502);
  }
}
