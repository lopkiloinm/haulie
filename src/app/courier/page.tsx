import type { Metadata } from "next";
import { HaulieApp } from "@/components/haulie-app";

export const metadata: Metadata = {
  title: "Available deliveries · Haulie Courier",
  description:
    "Find a funded delivery in your neighborhood, complete a fresh verification, and accept the job. Interactive courier demo.",
};

export default function CourierPage() {
  return <HaulieApp key="courier" initialRole="Courier" />;
}
