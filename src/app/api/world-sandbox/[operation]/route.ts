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
import {
  cookieOptions as options,
  pendingCookie,
  readWorldSession as session,
  secure,
  sessionCookie,
  worldConfig as config,
  worldReady as ready,
} from "@/lib/world-sandbox/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const jobs = ["HL-1046", "HL-1048", "HL-1047", "HL-1045", "HL-1044", "HL-1043"];
const jobSchema = z.enum(jobs as [string, ...string[]]);
const walletSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((address) => address.toLowerCase());
function json(data: object, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
function finish(
  result: string,
  job = "HL-1046",
  returnTo: Pending["returnTo"] = "world",
) {
  const url = new URL(
    returnTo === "courier" ? "/courier" : "/world-sandbox",
    config().origin,
  );
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
  const c = config();
  const attempt = await unseal<Pending>(
    request.cookies.get(pendingCookie)?.value,
    c.sessionKey,
    "pending",
  );
  if (!ready())
    return finish("unavailable", attempt?.job, attempt?.returnTo);
  const query = request.nextUrl.searchParams;
  if (
    !attempt ||
    now() > attempt.started + LIFETIME
  )
    return finish("expired");
  if (
    query.getAll("state").length !== 1 ||
    query.get("state") !== attempt.state
  )
    return finish("expired", attempt.job, attempt.returnTo);
  if (query.has("error"))
    return finish(
      query.get("error") === "access_denied" ? "denied" : "failed",
      attempt.job,
      attempt.returnTo,
    );
  const code = query.get("code");
  if (!code || query.getAll("code").length !== 1 || code.length > 4096)
    return finish("failed", attempt.job, attempt.returnTo);
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
        attempt.returnTo,
      );
    const tokens = await result.json();
    if (typeof tokens.id_token !== "string" || tokens.id_token.length > 20000)
      return finish("failed", attempt.job, attempt.returnTo);
    const subject = await verifyIdToken(tokens.id_token, c.clientId, attempt);
    // Only the validated provider token can record these browser-scoped actions.
    // /api/escrow relies on this record before assigning or moving a Sui escrow.
    const updated = applyVerifiedAction(
      await session(request),
      attempt,
      subject,
    );
    const response = finish(
      attempt.stage === "ACCEPT" ? "accepted" : "picked-up",
      attempt.job,
      attempt.returnTo,
    );
    response.cookies.set(
      sessionCookie,
      await seal(updated, c.sessionKey, "session", 86400),
      { ...options, maxAge: 86400 },
    );
    return response;
  } catch {
    // Do not log codes, tokens, subjects, secrets, or callback query strings.
    return finish("failed", attempt.job, attempt.returnTo);
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
  if (!["start", "release", "wallet"].includes(operation))
    return json({ error: "Not found." }, 404);
  if (!ready())
    return json(
      {
        error: "World verification is not configured.",
      },
      503,
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return json({ error: "JSON required." }, 415);
  const text = await request.text();
  if (text.length > 1024) return json({ error: "Request too large." }, 413);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (operation === "release" || operation === "wallet") {
    const schema = operation === "release"
      ? z.object({ job: jobSchema }).strict()
      : z.object({ job: jobSchema, payoutWallet: walletSchema }).strict();
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return json({ error: "Choose a supported delivery and wallet." }, 400);
    const current = await session(request);
    const { job } = parsed.data;
    const accepted = current.jobs[job];
    if (
      !current.subject ||
      !accepted ||
      !Number.isSafeInteger(accepted.accepted) ||
      accepted.accepted <= 0
    )
      return json({ error: "Verify and accept this delivery first." }, 409);

    const nextJobs = { ...current.jobs };
    let response: NextResponse;
    if (operation === "release") {
      if (accepted.pickedUp !== undefined)
        return json({ error: "This delivery can no longer be cancelled." }, 409);
      delete nextJobs[job];
      response = json({ released: true, job });
    } else {
      if (accepted.payoutWallet !== undefined)
        return json({ error: "A wallet has already been selected for this delivery." }, 409);
      const payoutWallet = "payoutWallet" in parsed.data
        ? parsed.data.payoutWallet
        : undefined;
      if (typeof payoutWallet !== "string")
        return json({ error: "Choose a valid Sui wallet." }, 400);
      // Add a delivery preference only: no ownership proof, transfer, or payment authorization.
      nextJobs[job] = { ...accepted, payoutWallet };
      response = json({ updated: true, job, payoutWallet });
    }
    response.cookies.set(
      sessionCookie,
      await seal({ ...current, jobs: nextJobs }, c.sessionKey, "session", 86400),
      { ...options, maxAge: 86400 },
    );
    return response;
  }

  const parsed = z
    .object({
      job: jobSchema,
      stage: z.enum(["ACCEPT", "PICKUP"]),
      returnTo: z.enum(["courier", "world"]).default("world"),
      payoutWallet: walletSchema.optional(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return json(
      { error: "Choose a supported delivery, action, and wallet." },
      400,
    );
  const current = await session(request);
  const { job, stage, returnTo, payoutWallet } = parsed.data;
  if (
    stage === "ACCEPT"
      ? !!current.jobs[job]
      : !current.subject || !current.jobs[job] || !!current.jobs[job].pickedUp
  )
    return json(
      { error: "This action is not available for the current delivery state." },
      409,
    );
  const attempt = pending(job, stage, current.subject, {
    returnTo,
    // This is a delivery preference, not proof of wallet ownership or payment authority.
    payoutWallet:
      stage === "ACCEPT" ? payoutWallet : current.jobs[job].payoutWallet,
  });
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
