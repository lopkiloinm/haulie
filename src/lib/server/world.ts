import { signRequest } from "@worldcoin/idkit-core/signing";
import { z } from "zod";
import {
  proofIdentifier,
  type Stage,
  type VerificationRequest,
} from "./domain";
import { ApiError, requiredEnv, requireCondition } from "./errors";

const hex = z
  .string()
  .regex(/^0x[0-9a-f]+$/i)
  .max(1024);
const proofResponse = z
  .object({
    identifier: z.literal("proof_of_human"),
    issuer_schema_id: z.literal(1),
    proof: z.array(hex).min(1).max(32),
    nullifier: hex.optional(),
    session_nullifier: z.tuple([hex, hex]).optional(),
  })
  .passthrough();
const proofPayload = z
  .object({
    protocol_version: z.literal("4.0"),
    nonce: z.string().min(1).max(1024),
    environment: z.enum(["staging", "production"]),
    action: z.string().max(256).optional(),
    session_id: z.string().startsWith("session_").max(512).optional(),
    responses: z.array(proofResponse).length(1),
  })
  .passthrough();

export function worldConfig() {
  const environment = requiredEnv("WORLD_ENVIRONMENT");
  requireCondition(
    environment === "staging" || environment === "production",
    "NOT_CONFIGURED",
    "World ID environment must be configured explicitly.",
    503,
  );
  const appId = requiredEnv("WORLD_APP_ID"),
    rpId = requiredEnv("WORLD_RP_ID");
  requireCondition(
    /^app_[a-zA-Z0-9]+$/.test(appId) && /^rp_[a-zA-Z0-9]+$/.test(rpId),
    "NOT_CONFIGURED",
    "World ID application identifiers are invalid.",
    503,
  );
  return { environment, appId, rpId };
}

export function createWorldContext(stage: Stage) {
  const config = worldConfig();
  const action =
    stage === "ENROLL_UNIQUENESS"
      ? requiredEnv("WORLD_ENROLLMENT_ACTION")
      : undefined;
  // Sessions MUST be signed without an action. Every call generates a fresh nonce.
  const result = signRequest({
    signingKeyHex: requiredEnv("WORLD_SIGNING_KEY"),
    ...(action ? { action } : {}),
  });
  return {
    ...config,
    action: action ?? null,
    context: {
      rp_id: config.rpId,
      nonce: result.nonce,
      created_at: result.createdAt,
      expires_at: result.expiresAt,
      signature: result.sig,
    },
    expiresAt: new Date(
      Math.min(result.expiresAt * 1000, Date.now() + 5 * 60_000),
    ),
  };
}

export function validateWorldContext(
  raw: unknown,
  expected: VerificationRequest,
) {
  const payload = proofPayload.parse(raw);
  requireCondition(
    payload.nonce === expected.nonce &&
      payload.environment === expected.environment,
    "WRONG_CONTEXT",
    "The World proof does not match this request or environment.",
    403,
  );
  if (expected.stage === "ENROLL_UNIQUENESS") {
    requireCondition(
      payload.action === expected.action &&
        !payload.session_id &&
        payload.responses[0].nullifier,
      "WRONG_PROOF_TYPE",
      "A fresh enrollment uniqueness proof is required.",
      400,
    );
  } else {
    requireCondition(
      !payload.action &&
        payload.session_id &&
        payload.responses[0].session_nullifier,
      "WRONG_PROOF_TYPE",
      "A fresh session proof is required.",
      400,
    );
    if (expected.expected_session_id)
      requireCondition(
        payload.session_id === expected.expected_session_id,
        "WRONG_SESSION",
        "This proof belongs to a different enrolled World ID session.",
        403,
      );
  }
  return payload;
}

export async function verifyWorldProof(
  raw: unknown,
  expected: VerificationRequest,
) {
  const payload = validateWorldContext(raw, expected);
  const config = worldConfig();
  requireCondition(
    expected.environment === config.environment,
    "ENVIRONMENT_CHANGED",
    "Create a new proof request for the current environment.",
  );
  let response: Response;
  try {
    response = await fetch(
      `https://developer.world.org/api/v4/verify/${config.rpId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(raw),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
  } catch {
    throw new ApiError(
      503,
      "WORLD_UNAVAILABLE",
      "World ID verification is temporarily unavailable.",
    );
  }
  requireCondition(
    response.ok,
    "PROOF_REJECTED",
    "World ID rejected this proof.",
    422,
  );
  const result = (await response.json()) as {
    success?: boolean;
    environment?: string;
    session_id?: string;
    action?: string;
    results?: { identifier?: string; success?: boolean }[];
  };
  requireCondition(
    result.success === true &&
      result.environment === config.environment &&
      result.results?.some(
        (item) => item.identifier === "proof_of_human" && item.success === true,
      ),
    "PROOF_REJECTED",
    "World ID did not verify the required human credential.",
    422,
  );
  const isSession = expected.stage !== "ENROLL_UNIQUENESS";
  if (isSession)
    requireCondition(
      result.session_id === payload.session_id,
      "WRONG_SESSION",
      "The verified World ID session does not match.",
      403,
    );
  else
    requireCondition(
      result.action === expected.action,
      "WRONG_CONTEXT",
      "The verified enrollment action does not match.",
      403,
    );
  const proof = payload.responses[0];
  return {
    type: isSession ? ("session" as const) : ("uniqueness" as const),
    identifier: isSession
      ? proofIdentifier("session", proof.session_nullifier!)
      : proofIdentifier("uniqueness", proof.nullifier!),
    sessionId: result.session_id ?? null,
  };
}
