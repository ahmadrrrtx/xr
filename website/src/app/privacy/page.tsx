import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "XR privacy policy: Personal collects nothing. Business stores only billing, account and team-sync data.",
};

/**
 * `/privacy` — the long-standing URL (it is in contracts and older emails,
 * so it keeps working). The document itself lives at its canonical home,
 * `/legal/privacy`; this route renders the same page rather than a second,
 * drifting copy.
 */
export { default } from "../legal/privacy/page";
