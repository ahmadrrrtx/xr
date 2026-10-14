import { Metadata } from "next";
import { MarketplaceBrowser } from "@/components/MarketplaceBrowser";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Skills and extensions for XR. Bundled items ship with the app; community items are reviewed before they list.",
};

export default function MarketplacePage() {
  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Skills and extensions for everything."
        subtitle="Browse the bundled skills, plugins and MCP servers. Install with one command. Build your own in minutes."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <MarketplaceBrowser />
        </div>
      </section>
    </>
  );
}
