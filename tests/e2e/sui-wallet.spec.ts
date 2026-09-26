import { test, expect } from "@playwright/test";
const address = `0x${"a".repeat(64)}`;

test("real wallet UI discovers Wallet Standard accounts, reads balances, and handles rejected signing", async ({
  page,
}) => {
  await page.addInitScript((address) => {
    const account = {
      address,
      publicKey: new Uint8Array(32),
      chains: ["sui:testnet"],
      features: ["sui:signTransaction"],
    };
    const wallet = {
      version: "1.0.0",
      name: "Test Sui Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["sui:testnet"],
      accounts: [account],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "sui:signTransaction": {
          version: "2.0.0",
          signTransaction: async () => {
            throw new Error("User rejected the wallet request.");
          },
        },
      },
    };
    const register = ({
      register,
    }: {
      register: (...wallets: unknown[]) => void;
    }) => register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e) =>
      register((e as CustomEvent).detail),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", { detail: register }),
    );
  }, address);
  // Explicit transport fixture: protobuf GetBalanceResponse with balance=2,000,000,000.
  // This test does not claim to execute an on-chain transaction.
  await page.route("https://fullnode.testnet.sui.io/**", async (route) => {
    if (!route.request().url().endsWith("/GetBalance")) return route.abort();
    const message = Buffer.from([0x0a, 6, 0x18, 0x80, 0xa8, 0xd6, 0xb9, 7]);
    const frame = Buffer.alloc(5);
    frame.writeUInt32BE(message.length, 1);
    const trailer = Buffer.from("grpc-status: 0\r\n");
    const trailerFrame = Buffer.alloc(5);
    trailerFrame[0] = 0x80;
    trailerFrame.writeUInt32BE(trailer.length, 1);
    await route.fulfill({
      status: 200,
      contentType: "application/grpc-web+proto",
      body: Buffer.concat([frame, message, trailerFrame, trailer]),
    });
  });
  await page.goto("/world-sandbox");
  await page
    .getByRole("button", { name: "Connect Sui wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Test Sui Wallet" }).click();
  await expect(
    page.getByRole("link", { name: address, exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review payment" }),
  ).toBeEnabled();
  await page.getByLabel("Recipient address").fill("invalid");
  await page.getByLabel("Amount", { exact: true }).fill("0.1");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(
    page.getByRole("region", { name: "Real Sui wallet" }).getByRole("alert"),
  ).toContainText("Enter a full Sui recipient");
  await page.getByLabel("Recipient address").fill(address);
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(
    page.getByText("Send 0.1 testnet SUI", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(
    page.getByRole("region", { name: "Real Sui wallet" }).getByRole("alert"),
  ).toContainText("User rejected");
  await expect(
    page.getByRole("link", { name: "View transaction" }),
  ).toHaveCount(0);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
