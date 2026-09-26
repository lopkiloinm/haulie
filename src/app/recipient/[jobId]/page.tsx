import type { Metadata } from "next";
import RecipientConfirmation from "@/components/recipient-confirmation";
import "./recipient.css";

export const metadata: Metadata = {
  title: "Confirm your delivery · Haulie",
  description:
    "Securely confirm your Haulie delivery or report an issue to the merchant.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RecipientPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <RecipientConfirmation jobId={jobId} />;
}
