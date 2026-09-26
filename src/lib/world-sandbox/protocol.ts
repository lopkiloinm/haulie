import { createHash, randomBytes } from "node:crypto";
import {
  createRemoteJWKSet,
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

export const ISSUER = "https://sandbox.auth.world.org";
export const ACR = "https://world.org/oidc/acr/orb-v3";
export const LIFETIME = 300;
export type Stage = "ACCEPT" | "PICKUP";
export type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  started: number;
  job: string;
  stage: Stage;
  subject?: string;
};
export type Session = {
  subject?: string;
  jobs: Record<string, { accepted: number; pickedUp?: number }>;
};
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
  timeoutDuration: 8000,
  cooldownDuration: 30000,
  cacheMaxAge: 600000,
});
export const now = () => Math.floor(Date.now() / 1000);
export const random = () => randomBytes(32).toString("base64url");
export function pending(job: string, stage: Stage, subject?: string): Pending {
  return {
    state: random(),
    nonce: random(),
    verifier: random(),
    started: now(),
    job,
    stage,
    subject,
  };
}
export function authorizationUrl(
  attempt: Pending,
  clientId: string,
  callback: string,
) {
  const url = new URL(`${ISSUER}/api/v1/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    scope: "openid",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: createHash("sha256")
      .update(attempt.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    max_age: "0",
    prompt: "login",
    acr_values: ACR,
  }).toString();
  return url.toString();
}
export function validateClaims(
  claims: JWTPayload,
  attempt: Pending,
  time = now(),
) {
  if (
    !claims.sub ||
    claims.sub.length > 512 ||
    claims.nonce !== attempt.nonce ||
    claims.acr !== ACR ||
    !Array.isArray(claims.amr) ||
    !claims.amr.includes("pop") ||
    typeof claims.auth_time !== "number" ||
    !Number.isInteger(claims.auth_time) ||
    claims.auth_time < attempt.started - 5 ||
    claims.auth_time > time + 5 ||
    time - claims.auth_time > LIFETIME ||
    time > attempt.started + LIFETIME ||
    (attempt.subject && claims.sub !== attempt.subject)
  ) {
    throw new Error("World authentication does not match this fresh request.");
  }
  return claims.sub;
}
export async function verifyIdToken(
  token: string,
  clientId: string,
  attempt: Pending,
  keySet: JWTVerifyGetKey = keys,
) {
  const { payload } = await jwtVerify(token, keySet, {
    issuer: ISSUER,
    audience: clientId,
    algorithms: ["RS256"],
    clockTolerance: 5,
    requiredClaims: [
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "nonce",
      "auth_time",
      "acr",
      "amr",
    ],
    maxTokenAge: LIFETIME,
  });
  if (
    Array.isArray(payload.aud) &&
    payload.aud.length > 1 &&
    payload.azp !== clientId
  )
    throw new Error("Unexpected authorized party.");
  return validateClaims(payload, attempt);
}
function key(secret: string) {
  if (secret.length < 32)
    throw new Error("Sandbox session key is not configured.");
  return createHash("sha256").update(secret).digest();
}
export async function seal(
  value: object,
  secret: string,
  purpose: string,
  seconds: number,
) {
  return new EncryptJWT({ data: value })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("haulie-world-sandbox")
    .setAudience(purpose)
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .encrypt(key(secret));
}
export async function unseal<T>(
  value: string | undefined,
  secret: string,
  purpose: string,
): Promise<T | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, key(secret), {
      issuer: "haulie-world-sandbox",
      audience: purpose,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    return payload.data as T;
  } catch {
    return null;
  }
}
export function applyVerifiedAction(
  session: Session,
  attempt: Pending,
  subject: string,
  time = now(),
): Session {
  if (
    (session.subject && session.subject !== subject) ||
    (attempt.subject && attempt.subject !== subject)
  )
    throw new Error("Use the same World identity that accepted this delivery.");
  const previous = session.jobs[attempt.job];
  if (attempt.stage === "ACCEPT" && previous)
    throw new Error("Delivery already accepted.");
  if (
    attempt.stage === "PICKUP" &&
    (!previous || previous.pickedUp || !session.subject)
  )
    throw new Error("Accept the delivery before confirming pickup.");
  return {
    subject,
    jobs: {
      ...session.jobs,
      [attempt.job]:
        attempt.stage === "ACCEPT"
          ? { accepted: time }
          : { ...previous, pickedUp: time },
    },
  };
}
