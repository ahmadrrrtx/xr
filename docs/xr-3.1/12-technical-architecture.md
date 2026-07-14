# XR 3.1G — Technical Architecture

**Date:** 2026-07-14

## Stack

- **Framework:** Next.js 15 (App Router)
- **Deployment:** Vercel
- **3D:** React Three Fiber
- **Motion:** Framer Motion
- **Data:** GitHub API (live)
- **Styling:** Tailwind + custom design tokens
- **Analytics:** Vercel Analytics

## Performance

- SSR + streaming where beneficial
- Image optimization (next/image)
- Code splitting
- Lazy loading of heavy 3D sections
- Edge functions for GitHub data

## GitHub Integration

Live data pulled via GitHub REST + GraphQL APIs:
- Stars, forks, releases, contributors, recent commits

## Accessibility & SEO

- Next.js metadata API
- Semantic HTML
- ARIA where needed
- Structured data for rich results

## Repository Rules

- No changes to XR backend, shell, CLI, or runtime
- Website is fully independent frontend