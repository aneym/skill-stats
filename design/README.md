# KINETIC — the design system

`kinetic.css` is the **canonical portable copy** of the Kinetic design system for new
standalone projects (dashboards, tools, sites). Source of truth for the flagship app lives
in studio (`src/ui/tokens.stylex.ts`); this file is its framework-free CSS-custom-property
port. Extracted 2026-07-08.

## The laws (non-negotiable)

1. **Two-tone monochrome.** `#02040A` native dark is the one true brand black; light mode
   is the paper inversion (`#F4F3F0`). Surfaces separate by hairline + a value step —
   **never drop shadows** (the single `--k-shadow-lg` exists only for overlays floating
   over text).
2. **The accent is ink.** Zero hue, maximum contrast. Links, focus, active states, primary
   actions: ink block, paper text. If you're reaching for a brand color, stop.
3. **Chroma is meaning.** Only destructive red (`--k-bad-*`) and completion green
   (`--k-confirm-*`, completion moments only) carry color. good/warn/info are neutral
   tiers — hierarchy from darkness and fill strength.
4. **Shape lock.** 2px corners or full pills. Nothing between.
5. **Hierarchy = size + alpha, not boldness.** Display weight stays 400. The text ramp
   (`ink → ink-soft → muted → dim → faint`) does the work.
6. **Mono is earned.** `--k-font-mono` for genuine code, timestamps, annotations,
   numerals — with `tabular-nums`. Never for decoration.
7. **Motion is gentle.** 120–400ms, the standard easings, reduced-motion collapse always.
   The 4s breathe pulse: at most two per page.
8. **If a value isn't a token, it doesn't ship.**

## Usage

```html
<link rel="stylesheet" href="kinetic.css" />
<body class="k-base">…</body>
```

Or inline the file (single-file/zero-asset pages — as skill-stats' dashboard does).
Follow-system is the default (`color-scheme: light dark`); force with
`<html data-theme="dark">`. Polysans is the brand display face but is self-hosted on
kinetic.nyc and **not bundled** — the stack degrades to Inter/system cleanly.

`light-dark()` requires 2024+ browsers (Safari 17.5+, Chrome 123+). These are local
tools; that floor is acceptable and keeps the file to one declaration per token.
