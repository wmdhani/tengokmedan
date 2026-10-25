---
version: 1
slug: "frontend-index-html"
primary_target: "frontend/index.html"
related_targets: ["frontend/style.css","frontend/app.js"]
---

# Surface Brief: TengokMedan Live Map HUD

## Scope & Mode
- **Surface:** `frontend/index.html`, `frontend/style.css`, `frontend/app.js`
- **Mode:** Operate
- **Audience & Job:** Medan commuters and citizens tracking live electric bus corridors (K1-K5) and Dishub ATCS traffic cameras in real time.

## Direction contract

THESIS: A 100% full-bleed vector map of Medan where all navigation, search, corridor filtering, and telemetry float inside a single collapsible glass dock and a compact camera capsule, refusing the opaque top navbar and full-height split sidebar that box in the map.

OWN-WORLD: Smoked Obsidian (`rgba(12, 16, 24, 0.72)`) and Frosted Daylight (`rgba(255, 255, 255, 0.78)`) translucent glass HUD shells with `backdrop-filter: blur(20px) saturate(180%)`, 1px specular top/outer borders, lightweight translucent inner cards (`rgba(255, 255, 255, 0.04)` dark / `rgba(15, 23, 42, 0.035)` light), `Geist` UI labels paired with `Geist Mono` tabular numerals, and color-coded corridor pills (`K1` `#0284c7`, `K2` `#059669`, `K3` `#d97706`, `K4` `#1d5fbf`, `K5` `#e11d48`).

STORY: Commuters immediately see live buses moving across Medan's corridors on an unobstructed canvas, filter by corridor or search a stop in one tap, and inspect arrival ETAs or live ATCS camera feeds without losing map context.

FIRST VIEWPORT: Full-viewport (`100vw` by `100dvh`) interactive MapLibre GL canvas; top-left floating glass dock (`352px` wide on desktop, collapsible to a compact header bar; swipeable 3-tier glass bottom sheet on mobile) housing brand identity, live counter pill, theme and collapse buttons, Bus/CCTV mode switcher, search input, horizontal corridor pills, and streamlined single-card list items; top-right floating glass camera capsule housing compass, 2D/3D pitch toggle, GPS locator, and Medan center reset.

FORM: User-pinned Glassmorphism HUD Dock (1 of 1), `seed: none (unavailable)`

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
