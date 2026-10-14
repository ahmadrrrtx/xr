import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "XR terms of service: the local software is MIT-licensed; these terms govern the hosted Business service.",
};

/**
 * `/terms` — the long-standing URL (it is in contracts and older emails, so
 * it keeps working). The document itself lives at its canonical home,
 * `/legal/terms`; this route renders the same page rather than a second,
 * drifting copy.
 */
export { default } from "../legal/terms/page";
