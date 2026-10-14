import { Metadata } from "next";

/** The enterprise page is a client component, so its metadata lives here. */
export const metadata: Metadata = {
  title: "Enterprise",
  description:
    "XR for organizations: self-hosted control plane, custom DPA, invoicing and onboarding — and what is not built yet.",
};

export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
