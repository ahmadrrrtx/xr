import { Metadata } from "next";

/** The contact page is a client component, so its metadata lives here. */
export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach the XR project: GitHub issues for questions and bugs, email for everything else, SECURITY.md for disclosures.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
