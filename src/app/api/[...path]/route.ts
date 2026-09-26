import { z, ZodError } from "zod";
import {
  authenticate,
  assertSameOrigin,
  login,
  logoutCookie,
} from "@/lib/server/auth";
import { db, rateLimit } from "@/lib/server/db";
import { ApiError, requireCondition } from "@/lib/server/errors";
import * as service from "@/lib/server/service";
import {
  escrowConfigurationReady,
  prepareEscrowFunding,
} from "@/lib/sui/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const uuid = z.string().uuid();
const address = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);
const digest = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/);
const text = z.string().trim().min(2).max(250);
const jobInput = z
  .object({
    parcelCategory: text.max(80),
    pickupArea: text.max(80),
    destinationArea: text.max(80),
    pickupAddress: text,
    destinationAddress: text,
    feeUsdc: z
      .string()
      .regex(/^[1-9][0-9]{0,10}$/)
      .refine((value) => BigInt(value) <= 10_000_000_000n),
    deliveryDeadline: z.string().datetime({ offset: true }),
    cancellationRules: text.max(1000),
  })
  .strict();

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}
async function body(request: Request) {
  requireCondition(
    request.headers.get("content-type")?.startsWith("application/json"),
    "INVALID_CONTENT_TYPE",
    "Send an application/json request.",
    415,
  );
  requireCondition(
    Number(request.headers.get("content-length") ?? "0") <= 65_536,
    "BODY_TOO_LARGE",
    "Request body is too large.",
    413,
  );
  const reader = request.body?.getReader();
  requireCondition(
    reader,
    "INVALID_JSON",
    "A JSON request body is required.",
    400,
  );
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.length;
    if (size > 65_536) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
    parts.push(result.value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }
}

async function handle(request: Request, path: string[]) {
  const route = path.join("/");
  if (request.method === "GET" && route === "health") {
    const database = Boolean(process.env.DATABASE_URL);
    const world = [
      "WORLD_APP_ID",
      "WORLD_RP_ID",
      "WORLD_SIGNING_KEY",
      "WORLD_ENVIRONMENT",
      "WORLD_ENROLLMENT_ACTION",
    ].every((key) => Boolean(process.env[key]));
    const auth = Boolean(
      process.env.APP_ORIGIN &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32,
    );
    const payments = escrowConfigurationReady();
    return json({
      application: "Haulie",
      mode: database && world && auth && payments ? "configured" : "demo",
      services: { database, world, auth, payments },
      note: "Configuration presence is not a live integration or database connectivity check.",
    });
  }
  if (request.method === "POST") assertSameOrigin(request);
  if (request.method === "POST" && route === "auth/session") {
    const input = z
      .object({ accountId: uuid, accessToken: z.string().min(32).max(512) })
      .strict()
      .parse(await body(request));
    const result = await login(input.accountId, input.accessToken);
    return json(result.actor, 200, { "set-cookie": result.cookie });
  }
  if (request.method === "POST" && route === "auth/logout")
    return json({ signedOut: true }, 200, { "set-cookie": logoutCookie });
  if (
    request.method === "POST" &&
    path[0] === "recipient" &&
    path.length === 2
  ) {
    const id = uuid.parse(path[1]);
    const input = z
      .object({
        token: z.string().min(40).max(100),
        action: z.enum(["confirm", "dispute"]),
        reason: z.string().trim().min(5).max(2000).optional(),
      })
      .strict()
      .parse(await body(request));
    return json(
      await service.recipientAction(
        id,
        input.token,
        input.action,
        input.reason,
      ),
    );
  }
  const actor = await authenticate(request);
  await rateLimit(actor.id, "authenticated-api", 100);
  if (request.method === "GET") {
    if (route === "auth/session") return json(actor);
    if (route === "jobs") return json({ jobs: await service.listJobs(actor) });
    if (path[0] === "jobs" && path.length === 2)
      return json(await service.getJob(actor, uuid.parse(path[1])));
    if (path[0] === "jobs" && path.length === 3 && path[2] === "events") {
      const result = await service.getJob(actor, uuid.parse(path[1]));
      // A short SSE response reconnects cleanly on serverless Vercel; the event ID lets clients deduplicate.
      const cursor = Number(request.headers.get("last-event-id") ?? "0");
      const events = result.events.filter((event) => Number(event.id) > cursor);
      const stream = `retry: 5000\n\n${events.map((event) => `id: ${event.id}\nevent: timeline\ndata: ${JSON.stringify(event)}\n\n`).join("")}: reconnect for updates\n\n`;
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      });
    }
    if (route === "courier/profile") {
      requireCondition(
        actor.role === "courier",
        "FORBIDDEN",
        "A courier account is required.",
        403,
      );
      const rows =
        await db()`SELECT account_status, unique_human_verified_at, wallet_address, wallet_bound_at, service_area, vehicle_type, contact_method, rules_accepted_at, world_session_id IS NOT NULL AS session_enrolled FROM couriers WHERE id = ${actor.id}`;
      return json(rows[0] ?? null);
    }
  }
  if (request.method !== "POST")
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "This method is not supported.",
    );
  const raw = await body(request);
  if (route === "jobs") {
    requireCondition(
      actor.role === "merchant",
      "FORBIDDEN",
      "A merchant account is required.",
      403,
    );
    return json(await service.createJob(actor, jobInput.parse(raw)), 201);
  }
  if (route === "world/requests") {
    requireCondition(
      actor.role === "courier",
      "FORBIDDEN",
      "A courier account is required.",
      403,
    );
    const input = z
      .object({
        stage: z.enum([
          "ENROLL_UNIQUENESS",
          "ENROLL_SESSION",
          "ACCEPT_JOB",
          "CONFIRM_PICKUP",
        ]),
        jobId: uuid.nullable().default(null),
      })
      .strict()
      .parse(raw);
    return json(
      await service.createProofRequest(actor, input.stage, input.jobId),
      201,
    );
  }
  if (route === "world/verify") {
    requireCondition(
      actor.role === "courier",
      "FORBIDDEN",
      "A courier account is required.",
      403,
    );
    const input = z
      .object({ requestId: uuid, proof: z.unknown() })
      .strict()
      .parse(raw);
    return json(
      await service.consumeProof(actor, input.requestId, input.proof),
    );
  }
  if (route === "wallet/challenge" || route === "wallet/bind") {
    requireCondition(
      actor.role === "courier",
      "FORBIDDEN",
      "A courier account is required.",
      403,
    );
    if (route.endsWith("challenge"))
      return json(
        await service.createWalletChallenge(
          actor,
          z.object({ walletAddress: address }).strict().parse(raw)
            .walletAddress,
        ),
      );
    const input = z
      .object({ challengeId: uuid, signature: z.string().min(20).max(8192) })
      .strict()
      .parse(raw);
    return json(
      await service.bindWallet(actor, input.challengeId, input.signature),
    );
  }
  if (route === "courier/profile") {
    requireCondition(
      actor.role === "courier",
      "FORBIDDEN",
      "A courier account is required.",
      403,
    );
    const input = z
      .object({
        serviceArea: text,
        vehicleType: z.enum([
          "bicycle",
          "cargo_bicycle",
          "scooter",
          "car",
          "van",
        ]),
        contactMethod: text,
        acceptsDeliveryRules: z.literal(true),
      })
      .strict()
      .parse(raw);
    await db()`UPDATE couriers SET service_area = ${input.serviceArea}, vehicle_type = ${input.vehicleType}, contact_method = ${input.contactMethod}, rules_accepted_at = now() WHERE id = ${actor.id}`;
    return json({ saved: true });
  }
  if (path[0] === "jobs" && path.length === 3) {
    const id = uuid.parse(path[1]),
      action = path[2];
    if (action === "prepare-funding") {
      const { job } = await service.getJob(actor, id);
      requireCondition(
        actor.role === "merchant" &&
          job.merchant_id === actor.id &&
          job.state === "DRAFT" &&
          actor.wallet_address,
        "FUNDING_FORBIDDEN",
        "Only the merchant can prepare funding for its draft delivery.",
        403,
      );
      return json(
        await prepareEscrowFunding({
          jobId: id,
          amount: String(job.fee_usdc),
          merchantWallet: actor.wallet_address,
        }),
      );
    }
    if (action === "fund") {
      const input = z.object({ escrowId: address, digest }).strict().parse(raw);
      return json(
        await service.fundJob(actor, id, input.escrowId, input.digest),
      );
    }
    if (action === "pickup")
      return json(await service.merchantPickup(actor, id));
    if (action === "recipient-link")
      return json(await service.createRecipientLink(actor, id));
    if (action === "dispute")
      return json(
        await service.openDispute(
          actor,
          id,
          z
            .object({ reason: z.string().trim().min(5).max(2000) })
            .strict()
            .parse(raw).reason,
        ),
      );
    if (action === "settle") return json(await service.settleJob(actor, id));
    if (action === "unassign")
      return json(await service.unassignJob(actor, id));
    if (action === "refund") return json(await service.refundJob(actor, id));
    if (action === "attempt")
      return json(await service.attemptedDelivery(actor, id));
    if (action === "resolve") {
      const input = z
        .object({
          payCourier: z.boolean(),
          resolution: z.string().trim().min(10).max(2000),
        })
        .strict()
        .parse(raw);
      return json(
        await service.resolveDispute(
          actor,
          id,
          input.payCourier,
          input.resolution,
        ),
      );
    }
  }
  throw new ApiError(404, "NOT_FOUND", "API endpoint not found.");
}

async function route(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    return await handle(request, (await context.params).path);
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.code, message: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: "INVALID_INPUT",
          message: "Check the submitted fields.",
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    )
      return json(
        {
          error: "CONFLICT",
          message:
            "This action, proof, or transaction has already been recorded.",
        },
        409,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "CONFIGURATION_REQUIRED"
    )
      return json(
        {
          error: "NOT_CONFIGURED",
          message: "Live escrow services have not been configured.",
        },
        503,
      );
    // Do not log proof bodies, session IDs, tokens, addresses, or database connection details.
    console.error(
      "Haulie API request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error: "SERVICE_UNAVAILABLE",
        message:
          "The request could not be completed. No success is implied; retry or contact the operator.",
      },
      503,
    );
  }
}

export { route as GET, route as POST };
