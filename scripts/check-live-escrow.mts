import { chromium, expect, type Page } from "@playwright/test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

// Opt-in end-to-end check of a real SUI courier fee on the deployed app:
// merchant funds → World-verified courier accepts → World pickup → merchant
// signs handoff → recipient confirms → escrow pays the courier wallet.
// Spends about 0.012 testnet SUI from SUI_DEMO_MERCHANT_PRIVATE_KEY.
const base = process.env.PLAYWRIGHT_BASE_URL || "https://haulie-chi.vercel.app";
const signer = Ed25519Keypair.fromSecretKey(
  process.env.SUI_DEMO_MERCHANT_PRIVATE_KEY ?? "",
);
const address = signer.toSuiAddress();
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
const title = "The weekend reading list";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.exposeFunction("haulieSignTransaction", async (json: string) => {
    const tx = Transaction.from(json);
    return signer.signTransaction(await tx.build({ client }));
  });
  await context.exposeFunction("haulieSignMessage", async (bytes: number[]) =>
    signer.signPersonalMessage(new Uint8Array(bytes)),
  );
  // tsx preserves function names using __name; provide it inside the browser.
  await context.addInitScript({ content: "globalThis.__name = (value) => value;" });
  await context.addInitScript(
    ({ address, publicKey }) => {
      const account = {
        address,
        publicKey: new Uint8Array(publicKey),
        chains: ["sui:testnet"],
        features: ["sui:signTransaction", "sui:signPersonalMessage"],
      };
      const bridge = window as unknown as {
        haulieSignTransaction: (json: string) => Promise<unknown>;
        haulieSignMessage: (bytes: number[]) => Promise<unknown>;
      };
      const wallet = {
        version: "1.0.0",
        name: "Haulie Live Check Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        chains: ["sui:testnet"],
        accounts: [account],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
          "sui:signTransaction": {
            version: "2.0.0",
            signTransaction: async ({ transaction }: { transaction: { toJSON: () => Promise<string> } }) =>
              bridge.haulieSignTransaction(await transaction.toJSON()),
          },
          "sui:signPersonalMessage": {
            version: "1.1.0",
            signPersonalMessage: async ({ message }: { message: Uint8Array }) =>
              bridge.haulieSignMessage(Array.from(message)),
          },
        },
      };
      const register = ({ register }: { register: (...w: unknown[]) => void }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    },
    { address, publicKey: Array.from(signer.getPublicKey().toRawBytes()) },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => console.log("Browser error:", error.message));

  async function connect(scope: Page | ReturnType<Page["getByRole"]>) {
    const button = scope.getByRole("button", { name: "Connect Sui wallet" }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.getByRole("button", { name: /Haulie Live Check Wallet/ }).click();
    }
  }
  async function openMerchantDetail() {
    await page.goto(`${base}/`);
    await page
      .getByRole("complementary", { name: "Main navigation" })
      .getByRole("button", { name: /^Deliveries/ })
      .click();
    await page.locator("button.delivery-id", { hasText: "HL-1046" }).first().click();
    return page.getByRole("dialog", { name: title });
  }
  async function stored() {
    return page.evaluate(() =>
      JSON.parse(localStorage.getItem("haulie-demo-v1")!).jobs.find(
        (job: { id: string }) => job.id === "HL-1046",
      ),
    ).catch(() => ({}));
  }

  let dialog = await openMerchantDetail();
  await dialog.getByRole("button", { name: "Merchant", exact: true }).click();
  await connect(dialog);
  await dialog.getByRole("button", { name: /^Lock .* fee on Sui$/ }).click();
  await expect(dialog.getByText("Courier fee locked on Sui")).toBeVisible({ timeout: 60_000 });
  console.log("funded escrow", (await stored()).chain.escrowId);

  await page.goto(`${base}/courier`);
  await connect(page.getByRole("complementary", { name: "Deliveries and connections" }));
  const card = page.getByRole("article", { name: title });
  await card.getByRole("button", { name: /HL-1046/ }).click();
  await card.getByRole("button", { name: "Accept delivery" }).click();
  await page.getByRole("button", { name: "Continue with World" }).click();
  await page.waitForURL(/\/courier\?.*result=/, { timeout: 60_000, waitUntil: "commit" });
  await expect.poll(async () => (await stored()).chain?.assigned, { timeout: 60_000 }).toBe(true);
  console.log("assigned on chain");

  await page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }).click();
  await card.getByRole("button", { name: /HL-1046/ }).click();
  await card.getByRole("button", { name: "Verify pickup" }).click();
  await page.getByRole("button", { name: "Continue with World" }).click();
  await page.waitForURL(/\/courier\?.*result=/, { timeout: 60_000, waitUntil: "commit" });
  await expect.poll(async () => (await stored()).pickupVerified, { timeout: 30_000 }).toBe(true);
  console.log("World pickup verified");

  dialog = await openMerchantDetail();
  await dialog.getByRole("button", { name: "Merchant", exact: true }).click();
  await dialog.getByRole("button", { name: "Sign handoff" }).click();
  await expect.poll(async () => (await stored()).status, { timeout: 60_000 }).toBe("PICKED_UP");
  console.log("handoff signed, custody on chain");

  await dialog.getByRole("button", { name: "Recipient", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "I have received this parcel." }).check();
  await dialog.getByRole("button", { name: "Confirm receipt & pay courier" }).click();
  await expect(dialog.getByText("Delivery complete")).toBeVisible({ timeout: 60_000 });
  const job = await stored();
  for (const event of job.events.filter((e: { digest?: string }) => e.digest))
    console.log(`  ${event.title}: https://suiscan.xyz/testnet/tx/${event.digest}`);
  await page.screenshot({ path: "/tmp/haulie-live-escrow.png" });
} finally {
  await browser.close();
}
