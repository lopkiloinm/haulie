import { expect, test, type Page } from "@playwright/test";
import { INITIAL_STATE, STORAGE_KEY, type DemoState } from "../../src/lib/demo";

const offerTitle = "The weekend reading list";
const offerId = "HL-1046";
const address = `0x${"a".repeat(64)}`;
const acceptedAt = 1_790_460_000;
test.use({
  permissions: ["geolocation"],
  geolocation: { latitude: 35.66694, longitude: 139.74944, accuracy: 20 },
});
type WorldStatus = {
  configured: boolean;
  connected: boolean;
  jobs: Record<string, { accepted: number; pickedUp?: number; payoutWallet?: string }>;
};

async function storedDelivery(page: Page, id = offerId) {
  const state = await page.evaluate(
    ({ key, initial }) => JSON.parse(localStorage.getItem(key) || JSON.stringify(initial)) as DemoState,
    { key: STORAGE_KEY, initial: INITIAL_STATE },
  );
  return state.jobs.find((job) => job.id === id)!;
}

async function mockWorld(page: Page, initial: WorldStatus = { configured: true, connected: false, jobs: {} }) {
  let status = initial;
  await page.route("**/api/world-sandbox/status", (route) => route.fulfill({ json: status }));
  return (next: WorldStatus) => { status = next; };
}

async function registerWallet(page: Page) {
  await page.addInitScript((address) => {
    const account = { address, publicKey: new Uint8Array(32), chains: ["sui:testnet"], features: ["sui:signTransaction"] };
    const wallet = {
      version: "1.0.0", name: "Test Sui Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["sui:testnet"], accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "sui:signTransaction": { version: "2.0.0", signTransaction: async () => { throw new Error("Signing is outside this connection fixture."); } },
      },
    };
    const register = ({ register }: { register: (...wallets: unknown[]) => void }) => register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  }, address);
}

async function navigateCourier(page: Page, name: string) {
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  // Map interactions use one local pixel; never bulk-download public map tiles in tests.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8S0AAAAASUVORK5CYII=", "base64"),
  }));
});

test("map markers, selection, and search expose the relevant delivery", async ({ page }) => {
  await mockWorld(page);
  const state = structuredClone(INITIAL_STATE);
  const offer = state.jobs.find((job) => job.id === offerId)!;
  state.jobs.push({ ...offer, id: "HL-1050", title: "Neighborhood groceries", pickup: "Atago", destination: "Azabudai Hills" });
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: STORAGE_KEY, state });
  await page.goto("/courier");
  const map = page.getByRole("region", { name: "Delivery area map" });
  await expect(map).toBeVisible();
  const first = page.getByRole("article", { name: offerTitle, exact: true });
  await expect(first.getByRole("button", { name: new RegExp(offerId) })).toHaveAttribute("aria-pressed", "true");
  await expect(map.getByRole("button", { name: "Kamiyacho drop-off area for HL-1046" })).toBeVisible();
  await map.getByRole("button", { name: "Atago pickup area, 1 delivery" }).click();
  const second = page.getByRole("article", { name: "Neighborhood groceries", exact: true });
  await expect(second.getByRole("button", { name: /HL-1050/ })).toHaveAttribute("aria-pressed", "true");
  await expect(second.getByRole("button", { name: "Accept delivery", exact: true })).toBeVisible();
  await expect(map.getByRole("button", { name: "Azabudai Hills drop-off area for HL-1050" })).toBeVisible();
  await first.getByRole("button", { name: new RegExp(offerId) }).click();
  await expect(first.getByRole("button", { name: new RegExp(offerId) })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox", { name: "Search delivery areas" }).fill("azabudai");
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  await page.getByRole("searchbox", { name: "Search delivery areas" }).fill("no such neighborhood");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
  await expect(map.getByRole("button", { name: /pickup area,/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search delivery areas" }).clear();
  await expect(first).toBeVisible();
});

test("acceptance requires Sui connection and verified World status before assignment", async ({ page }) => {
  const setWorld = await mockWorld(page);
  await registerWallet(page);
  const requests: unknown[] = [];
  await page.route("**/api/world-sandbox/start", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "World temporarily unavailable." } });
  });
  await page.goto("/courier");
  await page.getByRole("article", { name: offerTitle, exact: true }).getByRole("button", { name: "Accept delivery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Accept delivery", exact: true });
  await expect(dialog.getByRole("button", { name: "Continue with World", exact: true })).toBeDisabled();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  await dialog.getByRole("button", { name: "Connect Sui wallet", exact: true }).click();
  await page.getByRole("button", { name: "Test Sui Wallet" }).click();
  await expect(dialog.getByRole("button", { name: "Continue with World", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Continue with World", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("World temporarily unavailable.");
  expect(requests).toEqual([{ job: offerId, stage: "ACCEPT", returnTo: "courier", payoutWallet: address }]);
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  expect((await storedDelivery(page)).courier).toBeUndefined();

  // Only the authenticated status response can project an accepted assignment.
  setWorld({ configured: true, connected: true, jobs: { [offerId]: { accepted: acceptedAt, payoutWallet: address } } });
  await page.reload();
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toHaveCount(0);
  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  const accepted = await storedDelivery(page);
  expect(accepted.status).toBe("ASSIGNED");
  expect(accepted.courier).toBe("Jamie Chen");
  expect(accepted.payoutWallet).toBe(address);
  expect(accepted.acceptVerified).toBe(true);
  expect(accepted.pickupVerified).toBe(false);
  await navigateCourier(page, "My deliveries");
  for (const own of [offerId, "HL-1048", "HL-1044"])
    await expect(page.getByRole("button", { name: `View delivery ${own}`, exact: true })).toBeVisible();
  for (const other of ["HL-1047", "HL-1045", "HL-1043"])
    await expect(page.getByRole("button", { name: `View delivery ${other}`, exact: true })).toHaveCount(0);
});

test("pickup requests a fresh World check and never substitutes for merchant handoff", async ({ page }) => {
  const record = { accepted: acceptedAt, payoutWallet: address };
  const setWorld = await mockWorld(page, { configured: true, connected: true, jobs: { [offerId]: record } });
  const requests: unknown[] = [];
  await page.route("**/api/world-sandbox/start", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try verification again." } });
  });
  await page.goto("/courier");
  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await offer.getByRole("button", { name: new RegExp(offerId) }).click();
  await offer.getByRole("button", { name: "Verify pickup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Verify pickup", exact: true });
  await expect(dialog).toContainText("same World identity");
  await dialog.getByRole("button", { name: "Continue with World", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Try verification again.");
  expect(requests).toEqual([{ job: offerId, stage: "PICKUP", returnTo: "courier" }]);
  expect((await storedDelivery(page)).pickupVerified).toBe(false);
  setWorld({ configured: true, connected: true, jobs: { [offerId]: { ...record, pickedUp: acceptedAt + 60 } } });
  await page.reload();
  await expect.poll(async () => (await storedDelivery(page)).pickupVerified).toBe(true);
  expect((await storedDelivery(page)).status).toBe("ASSIGNED");
  expect((await storedDelivery(page)).payoutWallet).toBe(address);
});

test("forged success parameters cannot assign an unverified delivery", async ({ page }) => {
  await mockWorld(page);
  await page.goto(`/courier?result=accepted&job=${offerId}`);
  await expect(page).toHaveURL(/\/courier$/);
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  expect((await storedDelivery(page)).courier).toBeUndefined();
  await expect(page.getByText("Delivery accepted.", { exact: true })).toHaveCount(0);
});

test("an existing World identity can attach its Sui wallet through the server", async ({ page }) => {
  const setWorld = await mockWorld(page, { configured: true, connected: true, jobs: { [offerId]: { accepted: acceptedAt } } });
  await registerWallet(page);
  const requests: unknown[] = [];
  await page.route("**/api/world-sandbox/wallet", async (route) => {
    requests.push(route.request().postDataJSON());
    setWorld({ configured: true, connected: true, jobs: { [offerId]: { accepted: acceptedAt, payoutWallet: address } } });
    await route.fulfill({ json: { updated: true } });
  });
  await page.goto("/courier");
  await page.getByRole("article", { name: offerTitle, exact: true }).getByRole("button", { name: "Accept delivery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "World verification", exact: true });
  await expect(dialog.getByRole("button", { name: "Use this wallet", exact: true })).toBeDisabled();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  await dialog.getByRole("button", { name: "Connect Sui wallet", exact: true }).click();
  await page.getByRole("button", { name: "Test Sui Wallet" }).click();
  await dialog.getByRole("button", { name: "Use this wallet", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toEqual([{ job: offerId, payoutWallet: address }]);
  expect((await storedDelivery(page)).status).toBe("ASSIGNED");
  expect((await storedDelivery(page)).payoutWallet).toBe(address);
});

test("cancelling a World assignment must release the server record before reoffering", async ({ page }) => {
  const setWorld = await mockWorld(page, { configured: true, connected: true, jobs: { [offerId]: { accepted: acceptedAt, payoutWallet: address } } });
  let shouldRelease = false;
  const requests: unknown[] = [];
  await page.route("**/api/world-sandbox/release", async (route) => {
    requests.push(route.request().postDataJSON());
    if (!shouldRelease) {
      await route.fulfill({ status: 503, json: { error: "Could not release the assignment." } });
      return;
    }
    setWorld({ configured: true, connected: true, jobs: {} });
    await route.fulfill({ json: { released: true } });
  });
  await page.goto("/courier");
  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await offer.getByRole("button", { name: new RegExp(offerId) }).click();
  await offer.getByRole("button", { name: "Details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: offerTitle, exact: true });
  await expect(dialog.getByRole("button", { name: "Merchant", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel assignment", exact: true }).click();
  await expect(page.getByText("Could not release the assignment.", { exact: true })).toBeVisible();
  expect((await storedDelivery(page)).status).toBe("ASSIGNED");
  shouldRelease = true;
  await dialog.getByRole("button", { name: "Cancel assignment", exact: true }).click();
  await expect.poll(async () => (await storedDelivery(page)).status).toBe("FUNDED");
  expect(requests).toEqual([{ job: offerId }, { job: offerId }]);
  expect((await storedDelivery(page)).payoutWallet).toBeUndefined();
  await page.reload();
  await expect(page.getByRole("article", { name: offerTitle, exact: true })).toBeVisible();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
});

test("an unavailable World service prevents acceptance even with a connected wallet", async ({ page }) => {
  await mockWorld(page, { configured: false, connected: false, jobs: {} });
  await registerWallet(page);
  await page.goto("/courier");
  await page.getByRole("article", { name: offerTitle, exact: true }).getByRole("button", { name: "Accept delivery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Accept delivery", exact: true });
  await dialog.getByRole("button", { name: "Connect Sui wallet", exact: true }).click();
  await page.getByRole("button", { name: "Test Sui Wallet" }).click();
  await expect(dialog).toContainText("World verification is currently unavailable.");
  await expect(dialog.getByRole("button", { name: "Continue with World", exact: true })).toBeDisabled();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
});

test("courier map, delivery cards, and navigation fit mobile, tablet, and short desktop screens", async ({ page }) => {
  await mockWorld(page);
  await page.goto("/courier");
  for (const [width, height] of [[360, 800], [390, 844], [768, 900], [1024, 768], [1440, 900], [1024, 450], [1440, 400]]) {
    await page.setViewportSize({ width, height });
    await expectNoOverflow(page);
    const map = page.getByRole("region", { name: "Delivery area map" });
    await expect(map).toBeVisible();
    const bounds = await map.boundingBox();
    expect(bounds!.width).toBeGreaterThan(200);
    expect(bounds!.height).toBeGreaterThan(200);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const open = page.getByRole("button", { name: "Open navigation", exact: true });
    if (await open.isVisible()) await open.click();
    const sidebar = page.getByRole("complementary", { name: "Main navigation" });
    await sidebar.getByRole("button", { name: /^Courier\s+Workspace/ }).click();
    await expect(sidebar.getByRole("button", { name: "Operator", exact: true })).toBeVisible();
    const sidebarWidth = await sidebar.evaluate((node) => ({ width: node.clientWidth, content: node.scrollWidth }));
    expect(sidebarWidth.content).toBeLessThanOrEqual(sidebarWidth.width);
    await sidebar.getByRole("button", { name: "Courier", exact: true }).click();
    await expectNoOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("article", { name: offerTitle, exact: true }).getByRole("button", { name: "Accept delivery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Accept delivery", exact: true });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expectNoOverflow(page);
});
