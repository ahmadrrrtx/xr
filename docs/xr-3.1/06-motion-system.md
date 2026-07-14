# XR 3.1G — Motion System

**Date:** 2026-07-14

## Philosophy

Motion should feel **physical**.

Inspired by:
- Linear (best-in-class springs)
- Apple (purposeful micro-interactions)
- Arc & Raycast (speed + delight)
- Framer Motion (spring physics)

## Core Principles

- Use spring animations (stiffness, damping, mass)
- Shared element transitions between sections
- Context-aware reveals
- Parallax on scroll (subtle)
- Reduced motion support (WCAG)

## Animation Library

- Primary: Framer Motion
- 3D: React Three Fiber + drei

## Animation Standards

- Duration: 0.2s – 0.6s
- Easing: Custom spring configs
- Never more than 2 simultaneous animations on screen

## Examples

- Hero 3D orb entrance
- Capability cards that "snap" into place
- Memory timeline scrubbing
- Smooth scroll between sections

No excessive animation. Every motion must serve understanding.