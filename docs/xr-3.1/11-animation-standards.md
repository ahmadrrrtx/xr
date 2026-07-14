# XR 3.1G — Animation Standards

**Date:** 2026-07-14

## Library

Framer Motion + React Spring where needed.

## Rules

1. Spring physics preferred over easing
2. All interactive elements have micro-feedback
3. Scroll-triggered reveals use `whileInView`
4. 3D animations respect `prefers-reduced-motion`
5. Maximum 2 concurrent major animations

## Examples

- Button hover: scale(1.02) + spring
- Section reveal: opacity + y translate
- 3D orb: gentle rotation + breathing scale

Standards will be enforced in code review.