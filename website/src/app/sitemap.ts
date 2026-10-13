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
  // Phase 30 additions. `/download` is an alias for `/downloads` rather than a
  // replacement — both URLs resolve, and both are listed, because a URL that was
  // already in the footer and in people's bookmarks keeps its own weight.
  "/download",
  "/legal",
  "/legal/privacy",
  "/legal/terms",
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
