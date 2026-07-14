import { MetadataRoute } from "next";
import { site } from "@/lib/site";

const ROUTES = [
  "",
  "/features",
  "/marketplace",
  "/models",
  "/enterprise",
  "/security",
  "/pricing",
  "/docs",
  "/blog",
  "/research",
  "/downloads",
  "/community",
  "/roadmap",
  "/changelog",
  "/support",
  "/about",
  "/contact",
  "/status",
  "/careers",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${site.url}${r}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: r === "" ? 1 : 0.7,
  }));
}
