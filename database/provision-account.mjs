import { randomBytes, randomUUID, createHash } from "node:crypto";
import postgres from "postgres";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf("=");
  return [arg.slice(0, separator), arg.slice(separator + 1)];
}));
if (!["merchant", "courier", "operator"].includes(args["--role"]) || !args["--name"] || !process.env.DATABASE_URL) {
  console.error('Usage: node --env-file=.env.local database/provision-account.mjs --role=courier --name="Pilot Courier" [--wallet=0x...]');
  process.exit(1);
}
const wallet = args["--wallet"];
if (wallet && !/^0x[0-9a-f]{1,64}$/i.test(wallet)) throw new Error("Invalid merchant wallet address");
if (args["--role"] === "merchant" && !wallet) throw new Error("Provision merchants only after verifying control of their funding wallet; pass --wallet");
if (args["--role"] !== "merchant" && wallet) throw new Error("Couriers must bind wallets by signing the application's fresh challenge");
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: process.env.DATABASE_LOCAL_INSECURE === "true" && process.env.NODE_ENV !== "production" ? false : "require" });
try {
  const id = randomUUID(), token = randomBytes(32).toString("base64url");
  await sql.begin(async tx => {
    await tx`INSERT INTO accounts(id,role,display_name,access_token_hash,wallet_address) VALUES (${id},${args["--role"]},${args["--name"]},${createHash("sha256").update(token).digest("hex")},${wallet ? `0x${wallet.slice(2).toLowerCase().padStart(64, "0")}` : null})`;
    if (args["--role"] === "courier") await tx`INSERT INTO couriers(id) VALUES (${id})`;
  });
  console.log(JSON.stringify({ accountId: id, accessToken: token, note: "Deliver this one-time credential securely to the intended pilot account holder. It is shown only here." }, null, 2));
} finally { await sql.end(); }
