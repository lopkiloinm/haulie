import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ISSUER,
  LIFETIME,
  now,
  pending,
  authorizationUrl,
  verifyIdToken,
  seal,
  unseal,
  applyVerifiedAction,
  type Pending,
  type Session,
} from "@/lib/world-sandbox/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const secure = process.env.NODE_ENV === "production";
const prefix = secure ? "__Host-" : "";
const pendingCookie = `${prefix}haulie-world-pending`;
const sessionCookie = `${prefix}haulie-world-session`;
const options = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
const jobs = ["HL-1046", "HL-1048", "HL-1047", "HL-1045", "HL-1044", "HL-1043"];
function config() {
  return {
    clientId: process.env.WORLD_SANDBOX_CLIENT_ID || "",
    secret: process.env.WORLD_SANDBOX_CLIENT_SECRET || "",
    sessionKey: process.env.WORLD_SANDBOX_SESSION_SECRET || "",
    origin: process.env.WORLD_SANDBOX_ORIGIN || "https://haulie-chi.vercel.app",
  };
}
function ready() {
  const c = config();
  return !!(c.clientId && c.secret && c.sessionKey.length >= 32);
}
function json(data: object, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
async function session(request: NextRequest): Promise<Session> {
  return (
    (await unseal<Session>(
      request.cookies.get(sessionCookie)?.value,
      config().sessionKey,
      "session",
    )) || { jobs: {} }
  );
}
function finish(result: string, job = "HL-1046") {
  const url = new URL("/world-sandbox", config().origin);
  url.searchParams.set("result", result);
  url.searchParams.set("job", job);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(pendingCookie, "", { ...options, maxAge: 0 });
  return response;
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation === "status") {
    const current = ready()
      ? await session(request)
      : ({ jobs: {} } as Session);
    return json({
      configured: ready(),
      connected: !!current.subject,
      jobs: current.jobs,
      environment: "world-sandbox",
    });
  }
  if (operation !== "callback") return json({ error: "Not found." }, 404);
  if (!ready()) return finish("unavailable");
  const c = config();
  const attempt = await unseal<Pending>(
    request.cookies.get(pendingCookie)?.value,
    c.sessionKey,
    "pending",
  );
  const query = request.nextUrl.searchParams;
  if (
    !attempt ||
    query.getAll("state").length !== 1 ||
    query.get("state") !== attempt.state ||
    now() > attempt.started + LIFETIME
  )
    return finish("expired");
  if (query.has("error"))
    return finish(
      query.get("error") === "access_denied" ? "denied" : "failed",
      attempt.job,
    );
  const code = query.get("code");
  if (!code || query.getAll("code").length !== 1 || code.length > 4096)
    return finish("failed", attempt.job);
  try {
    const encode = (value: string) =>
      new URLSearchParams({ v: value }).toString().slice(2);
    const basic = Buffer.from(
      `${encode(c.clientId)}:${encode(c.secret)}`,
    ).toString("base64");
    const result = await fetch(`${ISSUER}/api/v1/token`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${c.origin}/api/world-sandbox/callback`,
        code_verifier: attempt.verifier,
      }),
    });
    if (!result.ok)
      return finish(
        result.status >= 500 ? "unavailable" : "failed",
        attempt.job,
      );
    const tokens = await result.json();
    if (typeof tokens.id_token !== "string" || tokens.id_token.length > 20000)
      return finish("failed", attempt.job);
    const subject = await verifyIdToken(tokens.id_token, c.clientId, attempt);
    // Only the validated provider token can execute these browser-scoped sandbox actions.
    // This separate ledger never assigns live jobs or authorizes Sui payments.
    const updated = applyVerifiedAction(
      await session(request),
      attempt,
      subject,
    );
    const response = finish(
      attempt.stage === "ACCEPT" ? "accepted" : "picked-up",
      attempt.job,
    );
    response.cookies.set(
      sessionCookie,
      await seal(updated, c.sessionKey, "session", 86400),
      { ...options, maxAge: 86400 },
    );
    return response;
  } catch {
    // Do not log codes, tokens, subjects, secrets, or callback query strings.
    return finish("failed", attempt.job);
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const c = config();
  const origin = request.headers.get("origin");
  const permittedOrigin = secure ? c.origin : request.nextUrl.origin;
  if (origin !== permittedOrigin)
    return json({ error: "Request origin rejected." }, 403);
  if (operation === "cancel") {
    const response = json({ cancelled: true });
    response.cookies.set(pendingCookie, "", { ...options, maxAge: 0 });
    return response;
  }
  if (operation !== "start") return json({ error: "Not found." }, 404);
  if (!ready())
    return json(
      {
        error:
          "World sandbox is not configured yet. The app owner must add the registered client credentials.",
      },
      503,
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return json({ error: "JSON required." }, 415);
  const text = await request.text();
  if (text.length > 1024) return json({ error: "Request too large." }, 413);
  const parsed = z
    .object({
      job: z.enum(jobs as [string, ...string[]]),
      stage: z.enum(["ACCEPT", "PICKUP"]),
    })
    .strict()
    .safeParse(
      (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    );
  if (!parsed.success)
    return json(
      { error: "Choose a supported sandbox delivery and action." },
      400,
    );
  const current = await session(request);
  const { job, stage } = parsed.data;
  if (
    stage === "ACCEPT"
      ? !!current.jobs[job]
      : !current.subject || !current.jobs[job] || !!current.jobs[job].pickedUp
  )
    return json(
      { error: "This action is not available for the current delivery state." },
      409,
    );
  const attempt = pending(job, stage, current.subject);
  const response = json({
    url: authorizationUrl(
      attempt,
      c.clientId,
      `${c.origin}/api/world-sandbox/callback`,
    ),
  });
  response.cookies.set(
    pendingCookie,
    await seal(attempt, c.sessionKey, "pending", LIFETIME),
    { ...options, maxAge: LIFETIME },
  );
  return response;
}
