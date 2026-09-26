import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../../src/app/api/world-sandbox/[operation]/route";
import {
  pending,
  seal,
  unseal,
  type Pending,
  type Session,
} from "../../src/lib/world-sandbox/protocol";

const origin = "https://haulie.example";
const secret = "world-route-test-session-key-".repeat(3);
const cookiePrefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
const pendingCookie = `${cookiePrefix}haulie-world-pending`;
const sessionCookie = `${cookiePrefix}haulie-world-session`;
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});

async function configured(run: () => Promise<void>) {
  const values = {
    WORLD_SANDBOX_CLIENT_ID: "route-test-client",
    WORLD_SANDBOX_CLIENT_SECRET: "route-test-secret",
    WORLD_SANDBOX_SESSION_SECRET: secret,
    WORLD_SANDBOX_ORIGIN: origin,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function startRequest(body: object, cookie?: string) {
  return new NextRequest(`${origin}/api/world-sandbox/start`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function actionRequest(
  operation: "release" | "wallet",
  body: unknown,
  cookie?: string,
  overrides: { origin?: string; contentType?: string; rawBody?: string } = {},
) {
  return new NextRequest(`${origin}/api/world-sandbox/${operation}`, {
    method: "POST",
    headers: {
      Origin: overrides.origin ?? origin,
      "Content-Type": overrides.contentType ?? "application/json",
      ...(cookie ? { Cookie: `${sessionCookie}=${cookie}` } : {}),
    },
    body: overrides.rawBody ?? JSON.stringify(body),
  });
}

test("World start seals an allowed return destination and normalized wallet", async () => {
  await configured(async () => {
    const wallet = `0x${"AB".repeat(32)}`;
    const response = await POST(
      startRequest({
        job: "HL-1046",
        stage: "ACCEPT",
        returnTo: "courier",
        payoutWallet: wallet,
      }),
      context("start"),
    );
    assert.equal(response.status, 200);
    const attempt = await unseal<Pending>(
      response.cookies.get(pendingCookie)?.value,
      secret,
      "pending",
    );
    assert.ok(attempt);
    assert.equal(attempt.returnTo, "courier");
    assert.equal(attempt.payoutWallet, wallet.toLowerCase());
    const authorize = new URL((await response.json()).url);
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      `${origin}/api/world-sandbox/callback`,
    );
    assert.equal(authorize.searchParams.has("payoutWallet"), false);

    const legacy = await POST(
      startRequest({ job: "HL-1046", stage: "ACCEPT" }),
      context("start"),
    );
    const legacyAttempt = await unseal<Pending>(
      legacy.cookies.get(pendingCookie)?.value,
      secret,
      "pending",
    );
    assert.equal(legacyAttempt?.returnTo, "world");
    assert.equal(legacyAttempt?.payoutWallet, undefined);
  });
});

test("World start rejects arbitrary return URLs and malformed wallet addresses", async () => {
  await configured(async () => {
    for (const extra of [
      { returnTo: "https://attacker.example" },
      { returnTo: "//attacker.example" },
      { returnTo: "/courier" },
      { payoutWallet: "0x1" },
      { payoutWallet: `0x${"zz".repeat(32)}` },
      { payoutWallet: `0x${"ab".repeat(33)}` },
    ]) {
      const response = await POST(
        startRequest({ job: "HL-1046", stage: "ACCEPT", ...extra }),
        context("start"),
      );
      assert.equal(response.status, 400);
      assert.equal(response.cookies.has(pendingCookie), false);
    }
  });
});

test("pickup starts with the accepted wallet, ignoring a new wallet preference", async () => {
  await configured(async () => {
    const wallet = `0x${"ab".repeat(32)}`;
    const cookie = await seal(
      {
        subject: "human-1",
        jobs: { "HL-1046": { accepted: 100, payoutWallet: wallet } },
      },
      secret,
      "session",
      86400,
    );
    const response = await POST(
      startRequest(
        {
          job: "HL-1046",
          stage: "PICKUP",
          returnTo: "courier",
          payoutWallet: `0x${"cd".repeat(32)}`,
        },
        `${sessionCookie}=${cookie}`,
      ),
      context("start"),
    );
    assert.equal(response.status, 200);
    const attempt = await unseal<Pending>(
      response.cookies.get(pendingCookie)?.value,
      secret,
      "pending",
    );
    assert.equal(attempt?.payoutWallet, wallet);
    assert.equal(attempt?.subject, "human-1");
  });
});

test("valid pending callbacks return failures to the courier without a session", async () => {
  await configured(async () => {
    const attempt = pending("HL-1046", "ACCEPT", undefined, {
      returnTo: "courier",
    });
    const cookie = await seal(attempt, secret, "pending", 300);
    for (const [query, expected] of [
      [`state=${attempt.state}&error=access_denied`, "denied"],
      [`state=${attempt.state}`, "failed"],
      ["state=wrong&code=invalid", "expired"],
    ]) {
      const response = await GET(
        new NextRequest(`${origin}/api/world-sandbox/callback?${query}`, {
          headers: { Cookie: `${pendingCookie}=${cookie}` },
        }),
        context("callback"),
      );
      const destination = new URL(response.headers.get("location")!);
      assert.equal(destination.origin, origin);
      assert.equal(destination.pathname, "/courier");
      assert.equal(destination.searchParams.get("result"), expected);
      assert.equal(destination.searchParams.get("job"), "HL-1046");
      assert.equal(response.cookies.get(pendingCookie)?.maxAge, 0);
      assert.equal(response.cookies.has(sessionCookie), false);
    }
    const missing = await GET(
      new NextRequest(`${origin}/api/world-sandbox/callback?state=unknown`),
      context("callback"),
    );
    assert.equal(
      new URL(missing.headers.get("location")!).pathname,
      "/world-sandbox",
    );
  });
});

test("release removes only the accepted delivery and retains the verified identity", async () => {
  await configured(async () => {
    const current: Session = {
      subject: "human-1",
      jobs: {
        "HL-1046": { accepted: 100, payoutWallet: `0x${"ab".repeat(32)}` },
        "HL-1048": { accepted: 50, pickedUp: 90 },
      },
    };
    const cookie = await seal(current, secret, "session", 86400);
    const response = await POST(
      actionRequest("release", { job: "HL-1046" }, cookie),
      context("release"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { released: true, job: "HL-1046" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    const saved = response.cookies.get(sessionCookie);
    assert.equal(saved?.httpOnly, true);
    assert.equal(saved?.sameSite, "lax");
    const updated = await unseal<Session>(saved?.value, secret, "session");
    assert.deepEqual(updated, {
      subject: current.subject,
      jobs: { "HL-1048": current.jobs["HL-1048"] },
    });
    const restarted = await POST(
      startRequest(
        { job: "HL-1046", stage: "ACCEPT", returnTo: "courier" },
        `${sessionCookie}=${saved!.value}`,
      ),
      context("start"),
    );
    assert.equal(restarted.status, 200, "released deliveries allow fresh acceptance");
    const attempt = await unseal<Pending>(
      restarted.cookies.get(pendingCookie)?.value,
      secret,
      "pending",
    );
    assert.equal(attempt?.subject, current.subject);
  });
});

test("release rejects missing acceptance, unauthenticated cookies, and confirmed pickup", async () => {
  await configured(async () => {
    const invalid: Array<Session | undefined> = [
      undefined,
      { jobs: { "HL-1046": { accepted: 100 } } },
      { subject: "human-1", jobs: {} },
      { subject: "human-1", jobs: { "HL-1046": { accepted: 0 } } },
      { subject: "human-1", jobs: { "HL-1046": { accepted: 100, pickedUp: 110 } } },
    ];
    for (const current of invalid) {
      const cookie = current
        ? await seal(current, secret, "session", 86400)
        : "invalid-cookie";
      const response = await POST(
        actionRequest("release", { job: "HL-1046" }, cookie),
        context("release"),
      );
      assert.equal(response.status, 409);
      assert.equal(response.cookies.has(sessionCookie), false);
    }
  });
});

test("wallet fills a legacy preference once without changing verification timestamps", async () => {
  await configured(async () => {
    const wallet = `0x${"AB".repeat(32)}`;
    for (const pickedUp of [undefined, 120]) {
      const current: Session = {
        subject: "human-1",
        jobs: {
          "HL-1046": { accepted: 100, ...(pickedUp ? { pickedUp } : {}) },
          "HL-1048": { accepted: 50 },
        },
      };
      const cookie = await seal(current, secret, "session", 86400);
      const response = await POST(
        actionRequest("wallet", { job: "HL-1046", payoutWallet: wallet }, cookie),
        context("wallet"),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        updated: true,
        job: "HL-1046",
        payoutWallet: wallet.toLowerCase(),
      });
      const saved = response.cookies.get(sessionCookie)?.value;
      const updated = await unseal<Session>(saved, secret, "session");
      assert.deepEqual(updated, {
        ...current,
        jobs: {
          ...current.jobs,
          "HL-1046": { ...current.jobs["HL-1046"], payoutWallet: wallet.toLowerCase() },
        },
      });
      for (const replacement of [wallet, `0x${"cd".repeat(32)}`]) {
        const repeated = await POST(
          actionRequest("wallet", { job: "HL-1046", payoutWallet: replacement }, saved),
          context("wallet"),
        );
        assert.equal(repeated.status, 409, "existing preferences cannot be replaced");
        assert.equal(repeated.cookies.has(sessionCookie), false);
      }
    }
  });
});

test("wallet rejects requests without an accepted delivery and signed World identity", async () => {
  await configured(async () => {
    const payoutWallet = `0x${"ab".repeat(32)}`;
    for (const current of [
      undefined,
      { jobs: { "HL-1046": { accepted: 100 } } },
      { subject: "human-1", jobs: {} },
      { subject: "human-1", jobs: { "HL-1046": { accepted: 0 } } },
    ] as Array<Session | undefined>) {
      const cookie = current
        ? await seal(current, secret, "session", 86400)
        : "invalid-cookie";
      const response = await POST(
        actionRequest("wallet", { job: "HL-1046", payoutWallet }, cookie),
        context("wallet"),
      );
      assert.equal(response.status, 409);
      assert.equal(response.cookies.has(sessionCookie), false);
    }
  });
});

test("release and wallet reject cross-origin, malformed, oversized, and unexpected input", async () => {
  await configured(async () => {
    const cookie = await seal(
      { subject: "human-1", jobs: { "HL-1046": { accepted: 100 } } },
      secret,
      "session",
      86400,
    );
    for (const operation of ["release", "wallet"] as const) {
      const body = {
        job: "HL-1046",
        ...(operation === "wallet" ? { payoutWallet: `0x${"ab".repeat(32)}` } : {}),
      };
      const invalid = [
        { body, overrides: { origin: "https://attacker.example" }, status: 403 },
        { body, overrides: { contentType: "text/plain" }, status: 415 },
        { body, overrides: { rawBody: "{" }, status: 400 },
        { body, overrides: { rawBody: " ".repeat(1025) }, status: 413 },
        { body: {}, status: 400 },
        { body: { ...body, job: "HL-9999" }, status: 400 },
        { body: { ...body, subject: "human-2" }, status: 400 },
      ];
      for (const input of invalid) {
        const response = await POST(
          actionRequest(operation, input.body, cookie, input.overrides),
          context(operation),
        );
        assert.equal(response.status, input.status);
        assert.equal(response.cookies.has(sessionCookie), false);
      }
    }
    for (const payoutWallet of [undefined, "0x1", `0x${"zz".repeat(32)}`, 42]) {
      const response = await POST(
        actionRequest("wallet", { job: "HL-1046", payoutWallet }, cookie),
        context("wallet"),
      );
      assert.equal(response.status, 400);
      assert.equal(response.cookies.has(sessionCookie), false);
    }
  });
});
