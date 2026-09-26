import type { Metadata } from "next";
import { HaulieApp } from "@/components/haulie-app";

export const metadata: Metadata = {
  title: "Available deliveries · Haulie Courier",
  description:
    "Find nearby deliveries and manage your route, verification, and wallet in one workspace.",
};

export default function CourierPage() {
  return <HaulieApp key="courier" initialRole="Courier" />;
}
