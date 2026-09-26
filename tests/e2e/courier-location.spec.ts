import { expect, test, type Page } from "@playwright/test";
import { INITIAL_STATE, STORAGE_KEY, type DemoState } from "../../src/lib/demo";

const forum = { latitude: 35.66694, longitude: 139.74944, accuracy: 20 };
const london = { latitude: 51.5074, longitude: -0.1278, accuracy: 20 };
const offerTitle = "The weekend reading list";

async function expectCenter(page: Page, expected: { latitude: number; longitude: number }) {
  const canvas = page.locator(".courier-map-canvas");
  await expect.poll(async () => {
    const latitude = Number(await canvas.getAttribute("data-latitude"));
    const longitude = Number(await canvas.getAttribute("data-longitude"));
    return Math.abs(latitude - expected.latitude) < 0.025 && Math.abs(longitude - expected.longitude) < 0.025;
  }).toBe(true);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function useDeviceLocation(page: Page) {
  await page.getByRole("button", { name: "Find my location", exact: true }).click();
}

async function installDeniedLocation(page: Page) {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (_success: PositionCallback, failure?: PositionErrorCallback) => {
          requests += 1;
          document.documentElement.dataset.locationRequests = String(requests);
          queueMicrotask(() => failure?.({ code: 1, message: "Permission denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
          return requests;
        },
        clearWatch: () => {},
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8S0AAAAASUVORK5CYII=", "base64"),
  }));
  await page.route("https://api.slush.app/api/wallet/metadata", (route) => route.fulfill({
    json: { id: "com.mystenlabs.suiwallet.web", walletName: "Slush", icon: "data:image/svg+xml;base64,", enabled: true },
  }));
  await page.route("**/api/world-sandbox/status", (route) => route.fulfill({
    json: { configured: true, connected: false, jobs: {} },
  }));
});

test("the venue opens with local deliveries without requesting device location", async ({ page }) => {
  await installDeniedLocation(page);
  await page.goto("/courier");
  await expectCenter(page, forum);
  expect(await page.locator("html").getAttribute("data-location-requests")).toBeNull();
  expect(Number(await page.locator(".courier-map-canvas").getAttribute("data-zoom"))).toBe(15);
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText("Toranomon Hills Forum");
  await expect(offer).toContainText("Kamiyacho");
  await expect(page.getByRole("button", { name: "Toranomon Hills Forum pickup area, 1 delivery", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your location", exact: true })).toHaveCount(0);
});

for (const [city, location, expectedOffers] of [["Forum", forum, 1], ["London", london, 0]] as const) {
  test(`${city} device location stays centered through search, refresh, and resize`, async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(location);
    await page.goto("/courier");
    await useDeviceLocation(page);
    const map = page.getByRole("region", { name: "Delivery area map" });
    await expect(map).toBeVisible();
    await expectCenter(page, location);
    await expect(page.getByText("Near you", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Delivery area", exact: true })).toHaveValue("nearby");
    await expect(page.getByRole("article")).toHaveCount(expectedOffers);
    await page.getByRole("searchbox", { name: "Search delivery areas" }).fill("books");
    await expectCenter(page, location);
    await page.getByRole("searchbox", { name: "Search delivery areas" }).clear();
    const refreshed = page.waitForResponse("**/api/world-sandbox/status");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await expectCenter(page, location);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(map).toBeVisible();
      await expectCenter(page, location);
      await expectNoOverflow(page);
    }
    await expect(page.getByRole("article")).toHaveCount(expectedOffers);
  });
}

test("All areas shows Tokyo deliveries from London only after an explicit choice", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(london);
  await page.goto("/courier");
  await useDeviceLocation(page);
  await expectCenter(page, london);
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Delivery area", exact: true }).selectOption("all");
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText("Toranomon Hills Forum");
  await expect(offer).toContainText("Kamiyacho");
  await expectCenter(page, london);
  await offer.getByRole("button", { name: /HL-1046/ }).click();
  await expectCenter(page, forum);
  await expect(page.getByRole("button", { name: "Kamiyacho drop-off area for HL-1046", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Delivery area", exact: true }).selectOption("nearby");
  await expect(offer).toHaveCount(0);
  await expectCenter(page, london);
  await page.getByRole("combobox", { name: "Delivery area", exact: true }).selectOption("all");
  await offer.getByRole("button", { name: /HL-1046/ }).click();
  await expectCenter(page, forum);
  await useDeviceLocation(page);
  await expectCenter(page, london);
  await page.getByRole("button", { name: "Back to Toranomon Hills Forum", exact: true }).click();
  await expectCenter(page, forum);
  await expect(offer).toBeVisible();
  await expect(page.getByRole("img", { name: "Your location", exact: true })).toHaveCount(0);
});

test("returning from Wallet obtains a fresh opted-in device location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(forum);
  await page.goto("/courier");
  await useDeviceLocation(page);
  await expect(page.getByText("Near you", { exact: true })).toBeVisible();
  await expectCenter(page, forum);
  await page.getByRole("navigation").getByRole("button", { name: "Wallet", exact: true }).click();
  await expect(page.getByRole("region", { name: "Real Sui wallet", exact: true })).toBeVisible();
  await expect(page.locator(".courier-map-canvas")).toHaveCount(0);
  await context.setGeolocation(london);
  await page.getByRole("navigation").getByRole("button", { name: "Find deliveries", exact: true }).click();
  await expectCenter(page, london);
  await expect(page.getByText("Near you", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("denied device location keeps the Forum map and its deliveries available on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeniedLocation(page);
  await page.goto("/courier");
  await useDeviceLocation(page);
  await expect(page.getByRole("region", { name: "Delivery area map" })).toContainText("Using Toranomon Hills Forum");
  await expectCenter(page, forum);
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your location", exact: true })).toHaveCount(0);
  const before = Number(await page.locator("html").getAttribute("data-location-requests"));
  await page.getByRole("button", { name: "Retry location", exact: true }).click();
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-location-requests"))).toBeGreaterThan(before);
  await expectCenter(page, forum);
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  await expectNoOverflow(page);
});

test("an unavailable device position retains the Forum area and offers retry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(null);
  await page.goto("/courier");
  await useDeviceLocation(page);
  await expect(page.getByRole("button", { name: "Retry location", exact: true })).toBeVisible();
  await expectCenter(page, forum);
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your location", exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
});

test("saved sample routes move to Tokyo while progress, World records, wallets, and custom orders survive", async ({ page }) => {
  const state = structuredClone(INITIAL_STATE);
  const source = state.jobs.find((job) => job.id === "HL-1046")!;
  const custom = { ...source, id: "HL-2077", title: "My custom route", pickup: "Hayes Valley", destination: "SoMa", pickupAddress: "My pickup, San Francisco", destinationAddress: "My drop-off, San Francisco" };
  const wallet = `0x${"b".repeat(64)}`;
  const accepted = 1_790_460_000;
  Object.assign(source, {
    pickup: "Hayes Valley", destination: "SoMa", pickupAddress: "450 Hayes St, San Francisco", destinationAddress: "830 Folsom St, San Francisco",
    status: "ASSIGNED", courier: "Jamie Chen", initials: "JC", acceptVerified: true, pickupVerified: true,
    payoutWallet: wallet, worldAcceptedAt: accepted, worldPickedUpAt: accepted + 60,
    events: [{ title: "World acceptance verified", actor: "Courier", at: new Date(accepted * 1000).toISOString() }, { title: "World pickup verified", actor: "Courier", at: new Date((accepted + 60) * 1000).toISOString() }],
  });
  state.jobs.push(custom);
  state.businessName = "My saved workspace";
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: STORAGE_KEY, state });
  await page.route("**/api/world-sandbox/status", (route) => route.fulfill({
    json: { configured: true, connected: true, jobs: { "HL-1046": { accepted, pickedUp: accepted + 60, payoutWallet: wallet } } },
  }));
  await page.goto("/courier");
  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await expect(offer).toContainText("Toranomon Hills Forum");
  await expect(offer).toContainText("Kamiyacho");
  await offer.getByRole("button", { name: /HL-1046/ }).click();
  await offer.getByRole("button", { name: "Details", exact: true }).click();
  const detail = page.getByRole("dialog", { name: offerTitle, exact: true });
  await expect(detail).toContainText(wallet);
  await expect(detail).toContainText("Pickup check complete");
  await detail.getByRole("button", { name: "Close dialog", exact: true }).click();
  // Saving an unrelated preference serializes the migrated display state without resetting it.
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: "Save changes", exact: true }).click();
  const saved: DemoState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  const migrated = saved.jobs.find((job) => job.id === "HL-1046")!;
  expect(migrated).toMatchObject({ pickup: "Toranomon Hills Forum", destination: "Kamiyacho", status: "ASSIGNED", payoutWallet: wallet, worldAcceptedAt: accepted, worldPickedUpAt: accepted + 60, acceptVerified: true, pickupVerified: true, events: source.events });
  expect(saved.jobs.find((job) => job.id === custom.id)).toEqual(custom);
  expect(saved.businessName).toBe("My saved workspace");
  await page.reload();
  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toContainText("Toranomon Hills Forum");
});
