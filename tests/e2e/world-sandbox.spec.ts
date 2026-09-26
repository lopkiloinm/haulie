import { test, expect } from "@playwright/test";

test("sandbox never treats a success query parameter as verified identity", async ({
  page,
}) => {
  await page.route("**/api/world-sandbox/status", (route) =>
    route.fulfill({ json: { configured: false, connected: false, jobs: {} } }),
  );
  await page.goto("/world-sandbox?result=accepted");
  await expect(
    page.getByText("Connection awaiting setup.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept with World sandbox" }),
  ).toBeDisabled();
  await expect(
    page.getByText("World verified your fresh sign-in.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Available to accept", { exact: true }),
  ).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("official World sandbox accepts, verifies fresh pickup, and rejects callback replay", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.WORLD_SANDBOX_LIVE_TEST !== "1",
    "Opt in against the configured deployment; uses official sandbox test identities.",
  );
  test.setTimeout(90000);
  let callback = "";
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/world-sandbox/callback" &&
      url.searchParams.has("code")
    )
      callback = request.url();
  });
  await page.goto("/world-sandbox");
  await page.getByRole("button", { name: "Accept with World sandbox" }).click();
  await expect(
    page.getByRole("button", { name: "Verify pickup with World" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Verify pickup with World" }).click();
  await expect(page.getByText("Both World checks complete")).toBeVisible({
    timeout: 30000,
  });
  const before = await (
    await context.request.get("/api/world-sandbox/status")
  ).json();
  expect(before.connected).toBe(true);
  expect(before.jobs["HL-1046"].pickedUp).toBeGreaterThanOrEqual(
    before.jobs["HL-1046"].accepted,
  );
  expect(callback).not.toBe("");
  const replay = await context.request.get(callback, { maxRedirects: 0 });
  expect(replay.headers().location).toContain("result=expired");
  const after = await (
    await context.request.get("/api/world-sandbox/status")
  ).json();
  expect(after).toEqual(before);
});

test("official sandbox cancellation, denial and wrong state leave the protected order untouched", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.WORLD_SANDBOX_LIVE_TEST !== "1",
    "Opt in against the configured deployment.",
  );
  test.setTimeout(90000);
  const origin = new URL(baseURL!).origin;
  for (const scenario of ["denied", "cancelled", "wrong-state"]) {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      const result = await context.request.post("/api/world-sandbox/start", {
        headers: { Origin: origin },
        data: { job: "HL-1046", stage: "ACCEPT" },
      });
      expect(result.status()).toBe(200);
      const authorization = new URL((await result.json()).url);
      if (scenario === "denied")
        await page.goto(
          `/api/world-sandbox/callback?error=access_denied&state=${authorization.searchParams.get("state")}`,
        );
      if (scenario === "wrong-state")
        await page.goto("/api/world-sandbox/callback?code=invalid&state=wrong");
      if (scenario === "cancelled") {
        expect(
          (
            await context.request.post("/api/world-sandbox/cancel", {
              headers: { Origin: origin },
            })
          ).status(),
        ).toBe(200);
        await page.goto(authorization.toString());
        await page.waitForURL(`${origin}/world-sandbox**`, { timeout: 30000 });
      }
      const status = await (
        await context.request.get("/api/world-sandbox/status")
      ).json();
      expect(status.jobs).toEqual({});
      expect(status.connected).toBe(false);
    } finally {
      await context.close();
    }
  }
});
