import { chromium, expect } from "@playwright/test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";

// Opt-in smoke test: ephemeral TESTNET wallet only; never loads user keys.
if (process.env.SUI_LIVE_TEST !== "1")
  throw new Error("Set SUI_LIVE_TEST=1 to use the public testnet faucet.");
const signer = new Ed25519Keypair();
const address = signer.toSuiAddress();
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
const balanceOnly = process.env.SUI_BALANCE_ONLY === "1";
if (!balanceOnly)
  await requestSuiFromFaucetV2({
    host: getFaucetHost("testnet"),
    recipient: address,
  });
console.log(
  balanceOnly ? "Ephemeral unfunded wallet:" : "Ephemeral test wallet funded:",
  address,
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  let reject = true;
  await page.exposeFunction("signTestTransaction", async (json: string) => {
    if (reject) throw new Error("User rejected the wallet request.");
    const transaction = Transaction.from(json);
    return signer.signTransaction(await transaction.build({ client }));
  });
  const registerWallet = ({
    address,
    publicKey,
  }: {
    address: string;
    publicKey: number[];
  }) => {
    const account = {
      address,
      publicKey: new Uint8Array(publicKey),
      chains: ["sui:testnet"],
      features: ["sui:signTransaction"],
    };
    const wallet = {
      version: "1.0.0",
      name: "Haulie Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["sui:testnet"],
      accounts: [account],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {},
        },
        "sui:signTransaction": {
          version: "2.0.0",
          signTransaction: async ({
            transaction,
          }: {
            transaction: { toJSON: () => Promise<string> };
          }) => {
            return (
              window as unknown as {
                signTestTransaction: (json: string) => Promise<unknown>;
              }
            ).signTestTransaction(await transaction.toJSON());
          },
        },
      },
    };
    const register = ({
      register,
    }: {
      register: (...wallets: unknown[]) => void;
    }) => register(wallet);
    window.addEventListener("wallet-standard:app-ready", (event) =>
      register((event as CustomEvent).detail),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: register,
      }),
    );
  };
  // tsx preserves function names using __name; provide it inside the isolated browser fixture.
  await page.addInitScript({
    content: `globalThis.__name = (value) => value; (${registerWallet.toString()})(${JSON.stringify({ address, publicKey: Array.from(signer.getPublicKey().toRawBytes()) })});`,
  });
  await page.goto(
    `${process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000"}/world-sandbox`,
  );
  await page
    .getByRole("button", { name: "Connect Sui wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Haulie Test Wallet" }).click();
  await expect(
    page.getByRole("link", { name: address, exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review payment" }),
  ).toBeEnabled({ timeout: 20000 });
  if (balanceOnly) {
    console.log(
      "Wallet Standard connection and live testnet balance queries: PASS",
    );
  } else {
    await page.getByLabel("Recipient address").fill(address);
    await page.getByLabel("Amount", { exact: true }).fill("0.001");
    await page.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: "Approve in wallet" }).click();
    await expect(
      page.getByRole("region", { name: "Real Sui wallet" }).getByRole("alert"),
    ).toContainText("User rejected");
    await expect(
      page.getByText("sent on testnet", { exact: false }),
    ).toHaveCount(0);
    console.log("Wallet rejection: no success reported PASS");
    reject = false;
    await page.getByRole("button", { name: "Approve in wallet" }).click();
    await expect(page.getByText("0.001 SUI sent on testnet")).toBeVisible({
      timeout: 45000,
    });
    const href = await page
      .getByRole("link", { name: "View transaction" })
      .getAttribute("href");
    const digest = href!.split("/").pop()!;
    const verified = await client.waitForTransaction({ digest });
    if (verified.FailedTransaction)
      throw new Error("Chain verification failed.");
    console.log("Real testnet transaction confirmed:", href);
  }
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: "/tmp/haulie-sui-wallet.png", fullPage: true });
} finally {
  await browser.close();
}
