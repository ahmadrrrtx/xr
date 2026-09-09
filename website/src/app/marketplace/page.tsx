import { Metadata } from "next";
import { MarketplaceBrowser } from "@/components/MarketplaceBrowser";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Authentic skills and extensions."
        subtitle="Every item here is a real XR skill or plugin bundled in the repository — manifest-declared, permission-scoped, and labeled honestly. No fake popularity metrics: trust is earned, not tallied."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <MarketplaceBrowser />
        </div>
      </section>
    </>
  );
}
