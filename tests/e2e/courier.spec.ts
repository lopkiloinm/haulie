import { expect, test, type Locator, type Page } from "@playwright/test";
import { INITIAL_STATE, STORAGE_KEY, type DemoState } from "../../src/lib/demo";

const offerTitle = "The weekend reading list";
const offerId = "HL-1046";

async function storedDelivery(page: Page, id = offerId) {
  const state = await page.evaluate(
    ({ key, initial }) =>
      JSON.parse(
        localStorage.getItem(key) || JSON.stringify(initial),
      ) as DemoState,
    { key: STORAGE_KEY, initial: INITIAL_STATE },
  );
  return state.jobs.find((job) => job.id === id)!;
}

async function completeProof(dialog: Locator) {
  await expect(
    dialog.getByRole("heading", { name: "Same human. New handoff." }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Simulate fresh verification", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Same human. New handoff." }),
  ).toBeHidden();
}

async function navigateCourier(page: Page, name: string) {
  const navigation = page.getByRole("navigation");
  const openNavigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await navigation
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
}

test("courier discovers a funded offer and accepts it only after a fresh check", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Courier workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/courier$/);
  await expect(
    page.getByRole("heading", { name: "Your next delivery awaits." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Available deliveries", exact: true }),
  ).toBeVisible();
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await expect(offer).toContainText("Demo funds reserved");
  await expect(offer).toContainText("Hayes Valley");
  await expect(offer).toContainText("SoMa");
  await expect(offer).toContainText("5.50");
  await expect(offer).toContainText("Within 1 hour");

  await offer
    .getByRole("button", { name: "View details", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: offerTitle, exact: true });
  await expect(
    dialog.getByRole("button", {
      name: "Verify & accept delivery",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();

  await offer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: offerTitle, exact: true });
  await expect(
    dialog.getByText(
      "No World ID proof is requested or verified in this demo.",
    ),
  ).toBeVisible();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  expect((await storedDelivery(page)).courier).toBeUndefined();
  await completeProof(dialog);
  await expect(
    dialog.getByText("Ready for pickup", { exact: true }),
  ).toBeVisible();
  const accepted = await storedDelivery(page);
  expect(accepted.courier).toBe("Jamie Chen");
  expect(accepted.acceptVerified).toBe(true);
  expect(accepted.pickupVerified).not.toBe(true);
  expect(accepted.payoutWallet).toBe("jamie.sui (demo)");
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();

  await expect(offer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `View delivery ${offerId}`, exact: true }),
  ).toBeVisible();
  for (const otherCourier of ["HL-1047", "HL-1045", "HL-1043"])
    await expect(
      page.getByRole("button", {
        name: `View delivery ${otherCourier}`,
        exact: true,
      }),
    ).toHaveCount(0);

  await navigateCourier(page, "My deliveries");
  for (const ownDelivery of [offerId, "HL-1048", "HL-1044"])
    await expect(
      page.getByRole("button", {
        name: `View delivery ${ownDelivery}`,
        exact: true,
      }),
    ).toBeVisible();
  for (const otherCourier of ["HL-1047", "HL-1045", "HL-1043"])
    await expect(
      page.getByRole("button", {
        name: `View delivery ${otherCourier}`,
        exact: true,
      }),
    ).toHaveCount(0);

  for (const section of ["Earnings", "Activity"]) {
    await navigateCourier(page, section);
    for (const ownDelivery of [offerId, "HL-1048", "HL-1044"])
      await expect(
        page.getByRole("main").getByRole("button", {
          name: new RegExp(ownDelivery),
        }).first(),
      ).toBeVisible();
    for (const otherCourier of ["HL-1047", "HL-1045", "HL-1043"])
      await expect(
        page.getByRole("main").getByRole("button", {
          name: new RegExp(otherCourier),
        }),
      ).toHaveCount(0);
  }

  await page.reload();
  await expect(page).toHaveURL(/\/courier$/);
  await expect(
    page.getByRole("article", { name: offerTitle, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `View delivery ${offerId}`, exact: true }),
  ).toBeVisible();
});

test("courier cannot verify pickup or cancel another courier's assignment", async ({
  page,
}) => {
  await page.goto("/");
  const original = await storedDelivery(page, "HL-1047");
  await page
    .getByRole("button", { name: "View delivery HL-1047", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Fresh blooms for Olivia", exact: true });
  await dialog.getByRole("button", { name: "Courier", exact: true }).click();
  await expect(
    dialog.getByText(/This delivery is assigned to Sam Rivera/),
  ).toBeVisible();
  await expect(
    dialog.getByText(/You’re viewing as Jamie Chen; only the assigned courier/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Verify for this pickup", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Cancel assignment before pickup", exact: true }),
  ).toHaveCount(0);
  expect(await storedDelivery(page, "HL-1047")).toEqual(original);
});

test("cancelling before handoff reoffers the funded delivery and requires new checks", async ({
  page,
}) => {
  await page.goto("/courier");
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  await offer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: offerTitle, exact: true });
  await completeProof(dialog);
  await dialog
    .getByRole("button", { name: "Verify for this pickup", exact: true })
    .click();
  await completeProof(dialog);
  expect((await storedDelivery(page)).pickupVerified).toBe(true);
  await dialog
    .getByRole("button", {
      name: "Cancel assignment before pickup",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText("Finding a courier", { exact: true }),
  ).toBeVisible();
  const cancelled = await storedDelivery(page);
  expect(cancelled.status).toBe("FUNDED");
  expect(cancelled.fee).toBe(5.5);
  expect(cancelled.courier).toBeUndefined();
  expect(cancelled.payoutWallet).toBeUndefined();
  expect(cancelled.acceptVerified).toBe(false);
  expect(cancelled.pickupVerified).toBe(false);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(offer).toBeVisible();
  await expect(
    page.getByRole("button", { name: `View delivery ${offerId}`, exact: true }),
  ).toHaveCount(0);

  await offer
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  await completeProof(dialog);
  await dialog.getByRole("button", { name: "Merchant", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "Waiting for courier verification",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await storedDelivery(page)).pickupVerified).toBe(false);
});

test("courier can inspect offers but needs enrollment and a wallet to accept", async ({
  page,
}) => {
  await page.goto("/courier");
  const offer = page.getByRole("article", { name: offerTitle, exact: true });
  const accept = offer.getByRole("button", {
    name: "Accept delivery",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Demo enrolled", exact: true })
    .click();
  await expect(accept).toBeDisabled();
  await expect(
    offer.getByRole("button", { name: "View details", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Try demo enrollment", exact: true })
    .click();
  await expect(accept).toBeEnabled();
  await page
    .getByRole("button", { name: "Demo wallet connected", exact: true })
    .click();
  await expect(accept).toBeDisabled();
  expect((await storedDelivery(page)).status).toBe("FUNDED");
  await page
    .getByRole("button", { name: "Connect demo wallet", exact: true })
    .click();
  await expect(accept).toBeEnabled();
});

test.describe("courier on mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("offer acceptance and personal deliveries fit a phone screen", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: "Courier workspace", exact: true })
      .click();
    await expect(page).toHaveURL(/\/courier$/);
    await expectNoOverflow(page);
    const offer = page.getByRole("article", { name: offerTitle, exact: true });
    await offer
      .getByRole("button", { name: "Accept delivery", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: offerTitle, exact: true });
    await expectNoOverflow(page);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await completeProof(dialog);
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(offer).toHaveCount(0);
    await navigateCourier(page, "My deliveries");
    await expect(
      page.getByRole("button", {
        name: `View delivery ${offerId}`,
        exact: true,
      }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await navigateCourier(page, "Find deliveries");
    await expect(
      page.getByRole("heading", { name: "Available deliveries", exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
  });
});
