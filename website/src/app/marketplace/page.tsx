import { Metadata } from "next";
import { MarketplaceBrowser } from "@/components/MarketplaceBrowser";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Skills and extensions for everything."
        subtitle="Browse 12,000+ verified skills and extensions. Install with one command. Build your own in minutes."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <MarketplaceBrowser />
        </div>
      </section>
    </>
  );
}
