import { writeFileSync } from "node:fs";
import { chromium, expect, type Locator } from "@playwright/test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

// Records a silent 1280x720 walkthrough of a real SUI-fee delivery on the
// deployed app, pacing each scene for narration. Writes the video to
// /tmp/haulie-demo/ and scene timestamps to /tmp/haulie-demo/timeline.json.
// Spends about 0.012 testnet SUI from SUI_DEMO_MERCHANT_PRIVATE_KEY.
const base = process.env.PLAYWRIGHT_BASE_URL || "https://haulie-chi.vercel.app";
const out = "/tmp/haulie-demo";
const signer = Ed25519Keypair.fromSecretKey(
  process.env.SUI_DEMO_MERCHANT_PRIVATE_KEY ?? "",
);
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
const title = "The weekend reading list";
const size = { width: 1280, height: 720 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: out, size },
  geolocation: { latitude: 35.66694, longitude: 139.74944, accuracy: 20 },
  permissions: ["geolocation"],
});
await context.exposeFunction("haulieSignTransaction", async (json: string) =>
  signer.signTransaction(await Transaction.from(json).build({ client })),
);
await context.exposeFunction("haulieSignMessage", async (bytes: number[]) =>
  signer.signPersonalMessage(new Uint8Array(bytes)),
);
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
      name: "Test Wallet",
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

    // Visible cursor, click ripple, and a scene caption that survives navigation.
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = `
        #demo-cursor{position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(40,91,64,.35);border:2px solid #285b40;pointer-events:none;transition:transform .12s}
        #demo-cursor.down{transform:scale(.7)}
        .demo-ripple{position:fixed;z-index:2147483646;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #285b40;pointer-events:none;animation:demo-ripple .5s ease-out forwards}
        @keyframes demo-ripple{from{opacity:.9;transform:scale(.3)}to{opacity:0;transform:scale(1.4)}}
        #demo-caption{position:fixed;z-index:2147483645;left:50%;top:10px;transform:translateX(-50%);max-width:70%;padding:7px 14px;border-radius:999px;background:rgba(25,57,44,.92);color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.18)}
        #demo-caption:empty{display:none}`;
      document.head.append(style);
      const cursor = Object.assign(document.createElement("div"), { id: "demo-cursor" });
      const caption = Object.assign(document.createElement("div"), { id: "demo-caption" });
      caption.textContent = sessionStorage.getItem("demo-caption") ?? "";
      document.body.append(cursor, caption);
      addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });
      addEventListener("mousedown", (e) => {
        cursor.classList.add("down");
        const ripple = Object.assign(document.createElement("div"), { className: "demo-ripple" });
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.append(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
      addEventListener("mouseup", () => cursor.classList.remove("down"));
    });
  },
  { address: signer.toSuiAddress(), publicKey: Array.from(signer.getPublicKey().toRawBytes()) },
);

const page = await context.newPage();
page.setDefaultTimeout(45_000);
const started = Date.now();
const timeline: { at: string; seconds: number; scene: string }[] = [];
const wait = (ms: number) => page.waitForTimeout(ms);
const clock = () => {
  const s = Math.round((Date.now() - started) / 1000);
  return { s, at: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
};
async function scene(name: string, caption: string) {
  const { s, at } = clock();
  timeline.push({ at, seconds: s, scene: name });
  console.log(at, name);
  await page.evaluate((text) => {
    sessionStorage.setItem("demo-caption", text);
    const el = document.getElementById("demo-caption");
    if (el) el.textContent = text;
  }, caption).catch(() => {});
}
async function click(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
    await wait(350);
  }
  await target.click();
  await wait(400);
}
async function stored() {
  return page
    .evaluate(() =>
      JSON.parse(localStorage.getItem("haulie-demo-v1") ?? "{}").jobs?.find(
        (job: { id: string }) => job.id === "HL-1046",
      ),
    )
    .catch(() => undefined);
}
async function connectWallet(scope: Locator) {
  const button = scope.getByRole("button", { name: "Connect Sui wallet" }).first();
  if (await button.isVisible().catch(() => false)) {
    await click(button);
    await click(page.getByRole("button", { name: /Test Wallet/ }));
  }
}
async function openDelivery() {
  await page.goto(`${base}/`);
  await click(
    page.getByRole("complementary", { name: "Main navigation" }).getByRole("button", { name: /^Deliveries/ }),
  );
  await wait(800);
  await click(page.locator("button.delivery-id", { hasText: "HL-1046" }).first());
  return page.getByRole("dialog", { name: title });
}

try {
  await page.goto(`${base}/courier`);
  await scene("intro", "Haulie · a verified human at every handoff, paid on Sui");
  await wait(9000);
  await click(page.getByRole("button", { name: "Find my location", exact: true }));
  await wait(9000);

  let dialog = await openDelivery();
  await scene("merchant-funds", "1 · Merchant locks the courier fee in a Sui escrow");
  await click(dialog.getByRole("button", { name: "Merchant", exact: true }));
  await wait(3500);
  await connectWallet(dialog);
  await wait(1500);
  await click(dialog.getByRole("button", { name: /^Lock .* fee on Sui$/ }));
  await expect(dialog.getByText("Courier fee locked on Sui")).toBeVisible({ timeout: 60_000 });
  await wait(9000);

  await page.goto(`${base}/courier`);
  await scene("courier-accepts", "2 · Courier accepts only after a fresh World ID check");
  await connectWallet(page.getByRole("complementary", { name: "Deliveries and connections" }));
  const card = page.getByRole("article", { name: title });
  await click(card.getByRole("button", { name: /HL-1046/ }));
  await wait(3500);
  await click(card.getByRole("button", { name: "Accept delivery" }));
  await wait(5000);
  await click(page.getByRole("button", { name: "Continue with World" }));
  await page.waitForURL(/\/courier\?.*result=/, { timeout: 60_000, waitUntil: "commit" });
  await scene("assigned-on-chain", "Verified · the server assigns the escrow to the courier's wallet");
  await expect.poll(async () => (await stored())?.chain?.assigned, { timeout: 60_000 }).toBe(true);
  await wait(7000);

  await scene("pickup", "3 · At pickup, the same World identity must verify again");
  await click(page.getByRole("group", { name: "Delivery view" }).getByRole("button", { name: /^Assigned/ }));
  await click(card.getByRole("button", { name: /HL-1046/ }));
  await wait(2500);
  await click(card.getByRole("button", { name: "Verify pickup" }));
  await wait(3000);
  await click(page.getByRole("button", { name: "Continue with World" }));
  await page.waitForURL(/\/courier\?.*result=/, { timeout: 60_000, waitUntil: "commit" });
  await expect.poll(async () => (await stored())?.pickupVerified, { timeout: 30_000 }).toBe(true);
  await wait(6000);

  dialog = await openDelivery();
  await scene("handoff", "4 · Merchant signs the handoff with the funding wallet");
  await click(dialog.getByRole("button", { name: "Merchant", exact: true }));
  await wait(4000);
  await click(dialog.getByRole("button", { name: "Sign handoff" }));
  await expect.poll(async () => (await stored())?.status, { timeout: 60_000 }).toBe("PICKED_UP");
  await wait(6000);

  await scene("recipient-pays", "5 · Recipient confirms, and the escrow pays the courier instantly");
  await click(dialog.getByRole("button", { name: "Recipient", exact: true }));
  await wait(2500);
  await click(dialog.getByRole("checkbox", { name: "I have received this parcel." }));
  await wait(1500);
  await click(dialog.getByRole("button", { name: "Confirm receipt & pay courier" }));
  await expect(dialog.getByText("Delivery complete")).toBeVisible({ timeout: 60_000 });
  await wait(6000);
  await click(dialog.getByText("Delivery activity"));
  await dialog.locator(".audit-log").scrollIntoViewIfNeeded();
  await wait(9000);

  const job = await stored();
  const payout = job.events.findLast((e: { digest?: string }) => e.digest).digest;
  await page.goto(`https://suiscan.xyz/testnet/tx/${payout}`, { waitUntil: "domcontentloaded" });
  await scene("suiscan", "The payout is a real Sui testnet transaction");
  await wait(12000);

  await page.goto(`${base}/custody`);
  await scene("custody", "Each parcel's custody and payment history, read live from Sui");
  await wait(6000);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 260);
    await wait(2500);
  }
  await page.mouse.wheel(0, -5000);
  await wait(3000);
  await scene("close", "haulie-chi.vercel.app · github.com/lopkiloinm/haulie");
  await wait(12000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  const path = await video?.path();
  writeFileSync(`${out}/timeline.json`, JSON.stringify({ video: path, timeline }, null, 2));
  console.log("video", path);
}
