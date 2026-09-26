import { createHmac, timingSafeEqual } from "node:crypto";
import { db, rateLimit } from "./db";
import { digestToken } from "./domain";
import { ApiError, requiredEnv, requireCondition } from "./errors";

export type Role = "merchant" | "courier" | "operator";
export interface Actor {
  id: string;
  role: Role;
  wallet_address: string | null;
  display_name: string;
}
const COOKIE = "__Host-haulie-session";

export function sessionSignature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
function signingSecret() {
  const value = requiredEnv("SESSION_SECRET");
  requireCondition(
    value.length >= 32,
    "NOT_CONFIGURED",
    "Session signing is not configured.",
    503,
  );
  return value;
}
export function secureEqual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertSameOrigin(request: Request) {
  const expected = new URL(requiredEnv("APP_ORIGIN")).origin;
  requireCondition(
    request.headers.get("origin") === expected,
    "INVALID_ORIGIN",
    "The request must originate from this application.",
    403,
  );
  requireCondition(
    request.headers.get("sec-fetch-site") !== "cross-site",
    "INVALID_ORIGIN",
    "Cross-site requests are not permitted.",
    403,
  );
}

export async function login(accountId: string, token: string) {
  await rateLimit(digestToken(accountId), "login", 8);
  const rows =
    await db()`SELECT id, role, display_name, access_token_hash, session_version FROM accounts WHERE id = ${accountId} AND status = 'active'`;
  const account = rows[0];
  requireCondition(
    account && secureEqual(digestToken(token), account.access_token_hash),
    "INVALID_CREDENTIALS",
    "The account credentials are invalid.",
    401,
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: account.id,
      version: account.session_version,
      exp: Math.floor(Date.now() / 1000) + 28_800,
    }),
  ).toString("base64url");
  const cookie = `${COOKIE}=${payload}.${sessionSignature(payload, signingSecret())}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
  return {
    actor: {
      id: account.id,
      role: account.role,
      display_name: account.display_name,
    },
    cookie,
  };
}

export async function authenticate(
  request: Request,
  roles?: Role[],
): Promise<Actor> {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  requireCondition(
    cookie && cookie.length < 2048,
    "UNAUTHENTICATED",
    "Sign in to continue.",
    401,
  );
  const [payload, signature, extra] = cookie.split(".");
  requireCondition(
    payload &&
      signature &&
      !extra &&
      secureEqual(signature, sessionSignature(payload, signingSecret())),
    "UNAUTHENTICATED",
    "This session is invalid.",
    401,
  );
  let claims: { sub: string; version: number; exp: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "UNAUTHENTICATED", "This session is invalid.");
  }
  requireCondition(
    typeof claims.sub === "string" &&
      /^[0-9a-f-]{36}$/i.test(claims.sub) &&
      Number.isInteger(claims.version) &&
      claims.exp > Date.now() / 1000,
    "UNAUTHENTICATED",
    "This session has expired.",
    401,
  );
  const rows =
    await db()`SELECT id, role, display_name, wallet_address FROM accounts WHERE id = ${claims.sub} AND status = 'active' AND session_version = ${claims.version}`;
  const actor = rows[0] as Actor | undefined;
  requireCondition(
    actor,
    "UNAUTHENTICATED",
    "This account session has been revoked.",
    401,
  );
  requireCondition(
    !roles || roles.includes(actor.role),
    "FORBIDDEN",
    "This account cannot perform that action.",
    403,
  );
  return actor;
}

export const logoutCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
