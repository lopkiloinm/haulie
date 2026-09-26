import { expect, test, type Locator, type Page } from "@playwright/test";

// Playwright creates a fresh browser context and empty storage for every test.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A good day to deliver." })).toBeVisible();
});

async function selectRole(dialog: Locator, role: "Merchant" | "Courier" | "Recipient" | "Operator") {
  await dialog.getByRole("button", { name: role, exact: true }).click();
}

async function completeFreshCheck(dialog: Locator, action: string) {
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Same human. New handoff." })).toBeVisible();
  await expect(dialog.getByText("No World ID proof is requested or verified in this demo.")).toBeVisible();
  await dialog.getByRole("button", { name: "Simulate fresh verification", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Same human. New handoff." })).toBeHidden();
}

async function confirmRecipient(dialog: Locator) {
  await selectRole(dialog, "Recipient");
  const confirm = dialog.getByRole("button", { name: "Confirm receipt", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "I have received this parcel." }).check();
  await confirm.click();
  await expect(dialog.getByText("Payout processing", { exact: true })).toBeVisible();
}

async function noPageOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
}

test("new delivery follows every independent verification, handoff, and payment gate", async ({ page }) => {
  await page.getByRole("button", { name: "New delivery", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("What are we delivering?").fill("A carefully tested care package");
  await dialog.getByLabel("Pickup address", { exact: true }).fill("450 Hayes St");
  await dialog.getByLabel("Neighborhood", { exact: true }).nth(0).fill("Hayes Valley");
  await dialog.getByLabel("Delivery address", { exact: true }).fill("890 Valencia St");
  await dialog.getByLabel("Neighborhood", { exact: true }).nth(1).fill("Mission District");
  await dialog.getByLabel("Recipient name").fill("Taylor Example");
  await dialog.getByLabel("Courier fee (demo USDC)").fill("6.25");
  await dialog.getByRole("button", { name: "Review delivery", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "One little check before it goes." })).toBeVisible();
  await expect(dialog.getByText("450 Hayes St", { exact: true })).toBeVisible();
  await expect(dialog.getByText("890 Valencia St", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reserve demo funds & create", exact: true }).click();

  dialog = page.getByRole("dialog", { name: "A carefully tested care package" });
  await expect(dialog.getByText("Finding a courier", { exact: true })).toBeVisible();
  const deliveryReference = (await dialog.locator(".modal-header .mini-label").innerText()).replace("DELIVERY ", "");
  await expect(dialog.getByRole("button", { name: "Process demo payout", exact: true })).toHaveCount(0);
  await selectRole(dialog, "Courier");
  await completeFreshCheck(dialog, "Verify & accept delivery");
  await expect(dialog.getByText("Ready for pickup", { exact: true })).toBeVisible();

  await selectRole(dialog, "Merchant");
  await expect(dialog.getByRole("button", { name: "Waiting for courier verification" })).toBeDisabled();
  await selectRole(dialog, "Courier");
  await completeFreshCheck(dialog, "Verify for this pickup");
  await expect(dialog.getByRole("button", { name: "Pickup check complete", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Ready for pickup", { exact: true })).toBeVisible();

  await selectRole(dialog, "Merchant");
  await dialog.getByRole("button", { name: "Confirm parcel handoff", exact: true }).click();
  await expect(dialog.getByText("On the way", { exact: true })).toBeVisible();
  await confirmRecipient(dialog);
  await dialog.getByRole("button", { name: "Process demo payout", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "A good delivery, all around." })).toBeVisible();
  await expect(dialog.getByText("There is no transaction digest: this is a simulated payment.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Process demo payout", exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: `View delivery ${deliveryReference}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "A carefully tested care package" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Delivered", { exact: true })).toBeVisible();
});

test("dispute freezes a confirmed payment and operator resolution permits a safe retry", async ({ page }) => {
  await page.getByRole("button", { name: "View delivery HL-1048", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A little everyday goodness" });
  await confirmRecipient(dialog);
  await dialog.getByRole("button", { name: "Something not right? Report an issue", exact: true }).click();
  await dialog.getByLabel("Tell us what happened").fill("The recipient reported damage to the outer packaging.");
  await dialog.getByRole("button", { name: "Report & freeze payout", exact: true }).click();
  await expect(dialog.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Payout locked during review", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Process demo payout", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Resolve demo case & resume", exact: true })).toHaveCount(0);

  await selectRole(dialog, "Operator");
  await dialog.getByRole("button", { name: "Resolve demo case & resume", exact: true }).click();
  await expect(dialog.getByText("Payout processing", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Try a failed settlement", exact: true }).click();
  await expect(dialog.getByText("Payout retry", { exact: true })).toBeVisible();
  await expect(dialog.getByText("The recipient confirmed receipt", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry demo payout", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "A good delivery, all around." })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry demo payout", exact: true })).toHaveCount(0);
  await dialog.locator("summary").click();
  await expect(dialog.getByText("Demo payout completed · no on-chain transfer", { exact: true })).toHaveCount(1);
});

test("modal retains keyboard focus through content changes and restores focus on close", async ({ page }) => {
  const open = page.getByRole("button", { name: "View delivery HL-1046", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "The weekend reading list" });
  await selectRole(dialog, "Courier");
  await dialog.getByRole("button", { name: "Verify & accept delivery", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);

  await dialog.getByRole("button", { name: "Close dialog", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("navigation, delivery details, and creation fit a 390px screen", async ({ page }) => {
    await noPageOverflow(page);
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("navigation").getByRole("button", { name: /^Deliveries/ }).click();
    await expect(page.getByRole("heading", { name: "Every delivery. All right here." })).toBeVisible();
    await noPageOverflow(page);
    await page.getByRole("button", { name: "View delivery HL-1048", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "A little everyday goodness" });
    await expect(dialog).toBeVisible();
    await noPageOverflow(page);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await selectRole(dialog, "Recipient");
    await expect(dialog.getByRole("button", { name: "Confirm receipt", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("button", { name: "New delivery", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("What are we delivering?")).toBeVisible();
    await noPageOverflow(page);
  });
});
