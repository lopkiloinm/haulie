import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACR,
  ISSUER,
  pending,
  authorizationUrl,
  validateClaims,
  applyVerifiedAction,
  seal,
  unseal,
  verifyIdToken,
} from "../../src/lib/world-sandbox/protocol";

test("World requests a fresh, scoped PKCE authorization for every handoff", () => {
  const first = pending("HL-1046", "ACCEPT");
  const second = pending("HL-1046", "PICKUP", "same-human");
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.state, second.state);
  const url = new URL(
    authorizationUrl(first, "test-client", "https://example.com/callback"),
  );
  assert.equal(url.origin, ISSUER);
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.get("max_age"), "0");
  assert.equal(url.searchParams.get("prompt"), "login");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.notEqual(url.searchParams.get("code_challenge"), first.verifier);
  assert.equal(url.searchParams.has("client_secret"), false);
});
test("freshness and continuity reject stale, future, wrong-account and unsupported proofs", () => {
  const attempt = pending("HL-1046", "PICKUP", "human-1");
  const valid = {
    sub: "human-1",
    nonce: attempt.nonce,
    acr: ACR,
    amr: ["pop"],
    auth_time: attempt.started,
  };
  assert.equal(validateClaims(valid, attempt), "human-1");
  for (const change of [
    { sub: "human-2" },
    { nonce: "wrong" },
    { acr: "password" },
    { amr: ["pwd"] },
    { auth_time: attempt.started - 60 },
    { auth_time: attempt.started + 60 },
    { auth_time: undefined },
  ])
    assert.throws(() => validateClaims({ ...valid, ...change }, attempt));
  assert.throws(() => validateClaims(valid, attempt, attempt.started + 301));
});
test("encrypted cookies hide identity and PKCE, reject tampering and cannot cross purposes", async () => {
  const secret = "a".repeat(64);
  const attempt = pending("HL-1046", "ACCEPT", "private-identity");
  const token = await seal(attempt, secret, "pending", 300);
  assert.equal(token.includes("private-identity"), false);
  assert.equal(token.includes(attempt.verifier), false);
  assert.deepEqual(await unseal(token, secret, "pending"), attempt);
  assert.equal(await unseal(token, secret, "session"), null);
  assert.equal(await unseal(token, "b".repeat(64), "pending"), null);
  const parts = token.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.equal(await unseal(parts.join("."), secret, "pending"), null);
  const expired = await seal(attempt, secret, "pending", -1);
  assert.equal(await unseal(expired, secret, "pending"), null);
});
test("protected sandbox action requires acceptance before same-identity pickup and rejects repeats", () => {
  const accept = pending("HL-1046", "ACCEPT");
  const pickup = pending("HL-1046", "PICKUP", "human-1");
  assert.throws(() => applyVerifiedAction({ jobs: {} }, pickup, "human-1"));
  const accepted = applyVerifiedAction({ jobs: {} }, accept, "human-1");
  assert.ok(accepted.jobs[accept.job].accepted);
  assert.throws(() => applyVerifiedAction(accepted, accept, "human-1"));
  assert.throws(() => applyVerifiedAction(accepted, pickup, "human-2"));
  const collected = applyVerifiedAction(accepted, pickup, "human-1");
  assert.ok(collected.jobs[accept.job].pickedUp);
  assert.throws(() => applyVerifiedAction(collected, pickup, "human-1"));
});

test("World preserves the accepted wallet across fresh pickup verification", async () => {
  const wallet = `0x${"ab".repeat(32)}`;
  const accept = pending("HL-1046", "ACCEPT", undefined, {
    returnTo: "courier",
    payoutWallet: wallet,
  });
  const sealed = await seal(accept, "a".repeat(64), "pending", 300);
  const restored = await unseal<typeof accept>(
    sealed,
    "a".repeat(64),
    "pending",
  );
  assert.ok(restored);
  assert.equal(restored.returnTo, "courier");
  assert.equal(restored.payoutWallet, wallet);
  const accepted = applyVerifiedAction({ jobs: {} }, restored, "human-1", 100);
  assert.equal(accepted.jobs[accept.job].payoutWallet, wallet);
  const pickup = pending("HL-1046", "PICKUP", "human-1", {
    returnTo: "courier",
    payoutWallet: `0x${"cd".repeat(32)}`,
  });
  const collected = applyVerifiedAction(accepted, pickup, "human-1", 200);
  assert.deepEqual(collected.jobs[accept.job], {
    accepted: 100,
    pickedUp: 200,
    payoutWallet: wallet,
  });
});

import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
test("ID tokens require trusted RS256 signatures, exact issuer/audience, expiration and nonce", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const attempt = pending("HL-1046", "ACCEPT");
  const claims = {
    sub: "human-1",
    nonce: attempt.nonce,
    acr: ACR,
    amr: ["pop"],
    auth_time: attempt.started,
  };
  async function token(
    issuer = ISSUER,
    audience = "client",
    expiry = "5m",
    nonce = attempt.nonce,
  ) {
    return new SignJWT({ ...claims, nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey);
  }
  assert.equal(
    await verifyIdToken(await token(), "client", attempt, keySet),
    "human-1",
  );
  for (const invalid of [
    await token("https://attacker.example"),
    await token(ISSUER, "another-client"),
    await token(ISSUER, "client", "-1m"),
    await token(ISSUER, "client", "5m", "wrong-nonce"),
  ])
    await assert.rejects(verifyIdToken(invalid, "client", attempt, keySet));
  const rogue = await generateKeyPair("RS256");
  const forged = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(ISSUER)
    .setAudience("client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(rogue.privateKey);
  await assert.rejects(verifyIdToken(forged, "client", attempt, keySet));
});
