import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { NATIVE_USDC } from "../src/lib/sui/types";

// Testnet only. Run `sui move build --path contracts/haulie` first; the Sui CLI's
// own publish command still uses JSON-RPC, which public fullnodes have retired.
const SUI_COIN = "0x2::sui::SUI";
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
const operator = Ed25519Keypair.fromSecretKey(
  process.env.SUI_OPERATOR_PRIVATE_KEY ?? "",
);
const sender = operator.toSuiAddress();

async function execute(tx: Transaction) {
  tx.setSender(sender);
  const result = await client.signAndExecuteTransaction({
    signer: operator,
    transaction: tx,
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind !== "Transaction")
    throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
  await client.waitForTransaction({ digest: result.Transaction.digest });
  const created = result.Transaction.effects.changedObjects
    .filter((object) => object.idOperation === "Created")
    .map((object) => ({
      id: object.objectId,
      type:
        object.outputState === "PackageWrite"
          ? "package"
          : result.Transaction.objectTypes[object.objectId],
    }));
  return { digest: result.Transaction.digest, created };
}

const modules = [
  readFileSync("contracts/haulie/build/haulie/bytecode_modules/escrow.mv"),
].map((bytes) => bytes.toString("base64"));
const publishTx = new Transaction();
const upgradeCap = publishTx.publish({ modules, dependencies: ["0x1", "0x2"] });
publishTx.transferObjects([upgradeCap], sender);
const published = await execute(publishTx);
const packageId = published.created.find((o) => o.type === "package")!.id;
const operatorCapId = published.created.find((o) =>
  o.type?.endsWith("::escrow::OperatorCap"),
)!.id;

const configTx = new Transaction();
for (const coinType of [NATIVE_USDC.testnet, SUI_COIN]) {
  configTx.moveCall({
    target: `${packageId}::escrow::create_config`,
    typeArguments: [coinType],
    arguments: [configTx.object(operatorCapId)],
  });
}
const configs = await execute(configTx);
const configFor = (coinSuffix: string) =>
  configs.created.find((o) => o.type?.endsWith(`${coinSuffix}>`))!.id;

console.log(`publish digest: ${published.digest}`);
console.log(`configs digest: ${configs.digest}`);
console.log(`SUI_ESCROW_PACKAGE_ID=${packageId}`);
console.log(`SUI_OPERATOR_CAP_ID=${operatorCapId}`);
console.log(`SUI_ESCROW_CONFIG_ID=${configFor("::usdc::USDC")}`);
console.log(`SUI_DEMO_CONFIG_ID=${configFor("::sui::SUI")}`);
