import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { POST } from "../../app/api/escrow/[operation]/route";
import { seal, type Session } from "../world-sandbox/protocol";
import { handoffMessage } from "./live-escrow-config";
import {
  receiptToken,
  validReceiptToken,
  verifyMerchantHandoff,
  type LiveEscrow,
} from "./live-escrow";

const origin = "https://haulie.example";
const secret = "escrow-route-test-session-key-".repeat(3);
const escrowId = `0x${"e".repeat(64)}`;
const wallet = `0x${"c".repeat(64)}`;
const sessionCookie = `${process.env.NODE_ENV === "production" ? "__Host-" : ""}haulie-world-session`;

async function configured(run: () => Promise<void>, operatorKey = true) {
  const values: Record<string, string | undefined> = {
    WORLD_SANDBOX_CLIENT_ID: "client",
    WORLD_SANDBOX_CLIENT_SECRET: "secret",
    WORLD_SANDBOX_SESSION_SECRET: secret,
    WORLD_SANDBOX_ORIGIN: origin,
    SUI_OPERATOR_PRIVATE_KEY: operatorKey
      ? new Ed25519Keypair().getSecretKey()
      : undefined,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values))
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  try {
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
}

async function call(
  operation: string,
  body: object,
  { session, requestOrigin = origin }: { session?: Session; requestOrigin?: string } = {},
) {
  const cookie = session
    ? `${sessionCookie}=${await seal(session, secret, "session", 600)}`
    : undefined;
  const response = await POST(
    new NextRequest(`${origin}/api/escrow/${operation}`, {
      method: "POST",
      headers: {
        Origin: requestOrigin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ operation }) },
  );
  return { status: response.status, body: await response.json() };
}

test("escrow actions fail closed before any chain call", async () => {
  await configured(async () => {
    const job = { job: "HL-1046", escrowId };
    assert.equal((await call("assign", job, { requestOrigin: "https://evil.example" })).status, 403);
    assert.equal((await call("assign", job)).status, 409, "no World session");
    assert.equal(
      (await call("assign", job, { session: { subject: "s", jobs: {} } })).status,
      409,
      "World session without this job",
    );
    assert.equal(
      (
        await call("handoff", { ...job, signature: "x".repeat(64) }, {
          session: { subject: "s", jobs: { "HL-1046": { accepted: 1, payoutWallet: wallet } } },
        })
      ).status,
      409,
      "handoff before World pickup",
    );
    assert.equal(
      (await call("deliver", { ...job, token: "a".repeat(43) })).status,
      403,
      "forged receipt token",
    );
    assert.equal((await call("assign", { job: "HL-9999", escrowId })).status, 400);
    assert.equal((await call("assign", { ...job, extra: true })).status, 400);
    assert.equal((await call("mint", job)).status, 404);
  });
  await configured(async () => {
    assert.equal((await call("assign", { job: "HL-1046", escrowId })).status, 503);
  }, false);
});

test("receipt tokens are bound to one escrow and one secret", () => {
  const token = receiptToken(escrowId, secret);
  assert.ok(validReceiptToken(escrowId, token, secret));
  assert.ok(!validReceiptToken(`0x${"f".repeat(64)}`, token, secret));
  assert.ok(!validReceiptToken(escrowId, token, `${secret}-other`));
  assert.ok(!validReceiptToken(escrowId, token.slice(1), secret));
});

test("only the funding merchant's signature over this handoff is accepted", async () => {
  const merchant = new Ed25519Keypair();
  const escrow: LiveEscrow = {
    id: escrowId,
    merchant: merchant.toSuiAddress(),
    payout: wallet,
    amount: "6500000",
    state: 1,
    previousTransaction: null,
  };
  const sign = async (signer: Ed25519Keypair, message: string) =>
    (await signer.signPersonalMessage(new TextEncoder().encode(message))).signature;
  await verifyMerchantHandoff(
    escrow,
    "HL-1046",
    await sign(merchant, handoffMessage("HL-1046", escrowId)),
  );
  await assert.rejects(
    verifyMerchantHandoff(escrow, "HL-1046", await sign(new Ed25519Keypair(), handoffMessage("HL-1046", escrowId))),
    /wallet that funded/,
  );
  await assert.rejects(
    verifyMerchantHandoff(escrow, "HL-1046", await sign(merchant, handoffMessage("HL-1045", escrowId))),
    /wallet that funded/,
  );
});
