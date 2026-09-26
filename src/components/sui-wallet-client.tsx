"use client";
import { useEffect, useRef, useState } from "react";
import {
  DAppKitProvider,
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import {
  fromBase64,
  isValidSuiAddress,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { ArrowUpRight, Check, Copy, RefreshCw, Wallet } from "lucide-react";
import { dAppKit } from "@/lib/sui/wallet";
import { NATIVE_USDC } from "@/lib/sui/types";
import { formatCoinAmount, parseCoinAmount } from "@/lib/sui/amount";
import "./sui-wallet.css";

type Balance = { address: string; sui: string; usdc: string };
function WalletContent({
  compact = false,
  standalone = false,
  onAccountChange,
}: {
  compact?: boolean;
  standalone?: boolean;
  onAccountChange?: (address: string | null) => void;
}) {
  const Heading = standalone ? "h1" : "h2";
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const kit = useDAppKit();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [coin, setCoin] = useState<"SUI" | "USDC">("SUI");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    digest: string;
    amount: string;
    coin: string;
    recipient: string;
    sender: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const sending = useRef(false);
  const address = account?.address;
  useEffect(() => {
    onAccountChange?.(address ?? null);
  }, [address, onAccountChange]);
  useEffect(() => {
    if (!address || compact) return;
    const controller = new AbortController();
    Promise.all([
      client.getBalance({ owner: address, signal: controller.signal }),
      client.getBalance({
        owner: address,
        coinType: NATIVE_USDC.testnet,
        signal: controller.signal,
      }),
    ])
      .then(([sui, usdc]) => {
        if (!controller.signal.aborted) {
          setBalance({
            address,
            sui: sui.balance.balance,
            usdc: usdc.balance.balance,
          });
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Could not read Sui testnet balances. Refresh to try again.",
          );
      });
    return () => controller.abort();
  }, [address, client, compact, reload]);
  const currentBalance = balance?.address === address ? balance : null;
  function validate() {
    if (!account) throw new Error("Connect your Sui wallet first.");
    if (!account.chains.includes("sui:testnet"))
      throw new Error("Choose a wallet account that supports Sui testnet.");
    if (!isValidSuiAddress(recipient.trim()))
      throw new Error(
        "Enter a full Sui recipient address (0x followed by 64 hexadecimal characters).",
      );
    const units = parseCoinAmount(amount.trim(), coin === "SUI" ? 9 : 6);
    if (!currentBalance)
      throw new Error("Refresh your balance before sending.");
    if (
      units > BigInt(coin === "SUI" ? currentBalance.sui : currentBalance.usdc)
    )
      throw new Error(`Insufficient testnet ${coin}.`);
    if (
      BigInt(currentBalance.sui) === 0n ||
      (coin === "SUI" && units >= BigInt(currentBalance.sui))
    )
      throw new Error("Keep some testnet SUI in your wallet for gas.");
    return {
      units,
      to: normalizeSuiAddress(recipient.trim()),
      sender: account.address,
    };
  }
  async function send() {
    if (sending.current) return;
    let submitted = false;
    try {
      const { units, to, sender } = validate();
      sending.current = true;
      setBusy(true);
      setError("");
      setReceipt(null);
      const tx = new Transaction();
      tx.setSender(sender);
      tx.transferObjects(
        [
          coinWithBalance({
            balance: units,
            ...(coin === "USDC" ? { type: NATIVE_USDC.testnet } : {}),
          }),
        ],
        to,
      );
      const signed = await kit.signTransaction({
        transaction: tx,
        account: account ?? undefined,
      });
      submitted = true;
      const result = await client.executeTransaction({
        transaction: fromBase64(signed.bytes),
        signatures: [signed.signature],
      });
      submitted = false;
      if (result.FailedTransaction)
        throw new Error(
          result.FailedTransaction.status.error?.message ||
            "Transaction failed on Sui.",
        );
      // Display success only after an executed transaction result, never after signature alone.
      setReceipt({
        digest: result.Transaction.digest,
        amount: amount.trim(),
        coin,
        recipient: to,
        sender,
      });
      setReview(false);
      setAmount("");
      setReload((n) => n + 1);
    } catch (e) {
      setError(
        submitted
          ? "The network result is unavailable. Check your wallet transaction history before sending again; the transfer may have completed."
          : e instanceof Error
            ? e.message.slice(0, 250)
            : "Wallet request failed or was rejected. No success was recorded.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (compact)
    return (
      <div className="sui-connect">
        <ConnectButton>
          <span>Connect Sui wallet</span>
        </ConnectButton>
        <small>Sui testnet</small>
      </div>
    );
  return (
    <section className="sui-wallet card" aria-label="Real Sui wallet">
      <div className="sui-wallet-heading">
        <div>
          <Heading>
            <Wallet size={22} /> Sui wallet
          </Heading>
        </div>
        <span className="sui-network">Sui testnet</span>
      </div>
      <div className="sui-connect-row">
        <ConnectButton>
          <span>Connect Sui wallet</span>
        </ConnectButton>
        {address && (
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh on-chain balances"
            onClick={() => {
              setError("");
              setReload((n) => n + 1);
            }}
          >
            <RefreshCw size={17} />
          </button>
        )}
      </div>
      {!account ? (
        <p className="sui-wallet-help">
          On mobile, open Haulie in your wallet’s browser.
        </p>
      ) : (
        <>
          <div className="sui-address">
            <a
              href={`https://suiscan.xyz/testnet/account/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              {address}
              <ArrowUpRight size={14} />
            </a>
            <button
              type="button"
              className="icon-button"
              aria-label="Copy Sui wallet address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address!);
                  setCopied(true);
                } catch {
                  setError(
                    "Could not copy. Select the address to copy it manually.",
                  );
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div className="sui-balances">
            <div>
              <span>SUI</span>
              <strong>
                {currentBalance ? formatCoinAmount(currentBalance.sui, 9) : "—"}
              </strong>
            </div>
            <div>
              <span>USDC</span>
              <strong>
                {currentBalance
                  ? formatCoinAmount(currentBalance.usdc, 6)
                  : "—"}
              </strong>
            </div>
          </div>
          <form
            className="sui-transfer"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                validate();
                setError("");
                setReview(true);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Check transfer details.",
                );
              }
            }}
          >
            <h3>Send payment</h3>
            <p>Direct transfer, separate from delivery escrow.</p>
            <fieldset disabled={busy || review}>
              <label>
                Recipient address
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <div className="sui-amount-row">
                <label>
                  Amount
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  Asset
                  <select
                    value={coin}
                    onChange={(e) => setCoin(e.target.value as "SUI" | "USDC")}
                  >
                    <option>SUI</option>
                    <option>USDC</option>
                  </select>
                </label>
              </div>
            </fieldset>
            {review ? (
              <div className="sui-review">
                <strong>
                  Send {amount} testnet {coin}
                </strong>
                <span>To {recipient}</span>
                <small>
                  Sui testnet · Gas paid in SUI. Confirm details in your wallet.
                </small>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={send}
                >
                  {busy ? "Awaiting confirmation…" : "Approve in wallet"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  Edit payment
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="button button-primary"
                disabled={!currentBalance || busy}
              >
                Review payment <ArrowUpRight size={16} />
              </button>
            )}
          </form>
        </>
      )}
      {error && (
        <p className="sui-wallet-error" role="alert">
          {error}
        </p>
      )}
      {receipt && receipt.sender === address && (
        <div className="sui-receipt" role="status">
          <strong>
            <Check size={16} /> {receipt.amount} {receipt.coin} sent on testnet
          </strong>
          <a
            href={`https://suiscan.xyz/testnet/tx/${receipt.digest}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction <ArrowUpRight size={15} />
          </a>
        </div>
      )}
      <div className="sui-wallet-footer">
        <span>Testnet tokens have no monetary value.</span>
        <a href="https://faucet.sui.io/" target="_blank" rel="noreferrer">
          Get testnet SUI <ArrowUpRight size={13} />
        </a>
      </div>
    </section>
  );
}
export default function SuiWalletClient(props: {
  compact?: boolean;
  standalone?: boolean;
  onAccountChange?: (address: string | null) => void;
}) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <WalletContent {...props} />
    </DAppKitProvider>
  );
}
