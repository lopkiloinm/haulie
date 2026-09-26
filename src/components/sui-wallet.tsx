"use client";
import dynamic from "next/dynamic";
export const SuiWallet = dynamic(() => import("./sui-wallet-client"), {
  ssr: false,
  loading: () => <span className="wallet-loading">Loading Sui wallet…</span>,
});
