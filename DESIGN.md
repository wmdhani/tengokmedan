---
schemaVersion: 2
aestheticDirection: Smoked Obsidian & Frosted Daylight Glassmorphism
colorPalette:
  - name: Glass Surface Base (Dark)
    hex: "#0A0E17"
    role: Floating HUD glass base tint (applied at 74% alpha with blur(22px) saturate(180%))
  - name: Glass Surface Base (Light)
    hex: "#FFFFFF"
    role: Frosted Daylight HUD glass base tint (applied at 78% alpha with blur(22px) saturate(180%))
  - name: Text Primary (Dark)
    hex: "#F1F5F9"
    role: Primary legibility hierarchy over smoked glass
  - name: Text Secondary (Dark)
    hex: "#94A3B8"
    role: Secondary route labels, endpoints, and stop metadata
  - name: Text Muted (Dark)
    hex: "#64748B"
    role: Tertiary captions and timestamps
  - name: Accent Primary (Transit Blue)
    hex: "#38BDF8"
    role: Active mode tabs, corridor highlights, and focus rings
  - name: Status Live (Emerald)
    hex: "#10B981"
    role: Live GPS telemetry indicator and active bus status
  - name: Status CCTV (Amber)
    hex: "#F59E0B"
    role: ATCS traffic camera indicator and stream badge
  - name: Status Danger (Rose)
    hex: "#F43F5E"
    role: Stream offline alert and Koridor 4 route color
  - name: Railink Teal (Airport Rail)
    hex: "#009AA6"
    role: Airport rail line casing, train markers, and station badges
typography:
  display: Geist
  body: Geist
  mono: Geist Mono
  scaleRatio: 1.15
layoutPrinciples:
  - 100% full-bleed map canvas (100vw x 100dvh) with zero edge-to-edge opaque chrome
  - Unified Floating Glass Dock (356px desktop left overlay; 3-tier swipeable floating glass bottom sheet on mobile)
  - Strict two-surface backdrop-filter budget (.transit-panel and .map-controls-rail only)
---

# TengokMedan Design System

## 1. Aesthetic Direction & Architectural Thesis

TengokMedan is a real-time civic transit and ATCS traffic camera HUD for commuters in Medan, North Sumatra. The interface treats the interactive MapLibre vector canvas as the primary surface (`100vw x 100dvh`) and suspends all application controls inside two translucent Glassmorphism instruments:

1. **Unified Floating Glass Dock (`.transit-panel`)**: Anchored at `top: 14px; left: 14px; width: 356px` on desktop viewports (`>= 768px`), and adapting to a floating glass bottom sheet (`left: 10px; right: 10px; bottom: 10px`) with three snap states (`collapsed`, `half`, `expanded`) on mobile viewports.
2. **Floating Camera Capsule (`.map-controls-rail`)**: Anchored at `top: 14px; right: 14px`, housing the four spatial map controls (Compass reset, 2D/3D pitch toggle, User GPS locate, and Medan city bounds reset).

No full-width top navigation bar, footer, or opaque sidebar is permitted to frame or crop the map canvas.

## 2. Glassmorphism Materiality & GPU Budget

To preserve 60fps WebGL map rendering and clear visual hierarchy, `backdrop-filter: blur(22px) saturate(180%)` is restricted to the two primary floating containers (`.transit-panel` and `.map-controls-rail`).

- **Dark Theme (Smoked Obsidian, Default)**:
  - Primary HUD surface (`--glass-bg`): `rgba(10, 14, 23, 0.74)`
  - Elevated glass surface (`--glass-bg-elevated`): `rgba(15, 21, 34, 0.84)`
  - Inner card fill (`--surface-card`): `rgba(255, 255, 255, 0.04)`
  - Inner card hover fill (`--surface-card-hover`): `rgba(255, 255, 255, 0.075)`
  - Outer specular border (`--glass-border`): `rgba(255, 255, 255, 0.11)`
  - Inner top highlight (`--glass-highlight`): `rgba(255, 255, 255, 0.08)`
- **Light Theme (Frosted Daylight)**:
  - Primary HUD surface (`--glass-bg`): `rgba(255, 255, 255, 0.78)`
  - Elevated glass surface (`--glass-bg-elevated`): `rgba(255, 255, 255, 0.88)`
  - Inner card fill (`--surface-card`): `rgba(15, 23, 42, 0.038)`
  - Inner card hover fill (`--surface-card-hover`): `rgba(15, 23, 42, 0.07)`
  - Outer specular border (`--glass-border`): `rgba(15, 23, 42, 0.10)`
  - Inner top highlight (`--glass-highlight`): `rgba(255, 255, 255, 0.75)`

Inner elements (`.bus-card`, `.cctv-card`, `.corridor-pill`, `.telemetry-strip`, `.search-box`) never stack additional `backdrop-filter` layers; they achieve depth through translucent `rgba()` fills and `1px solid` borders.

## 3. Color Palette & Corridor Semantics

### UI & Status Tokens

| Token | Dark Value | Light Value | Role |
| :--- | :--- | :--- | :--- |
| `--text-primary` | `#F1F5F9` | `#0F172A` | Primary headings, bus fleet IDs, stop names |
| `--text-secondary` | `#94A3B8` | `#475569` | Route names, next-stop labels, secondary controls |
| `--text-muted` | `#64748B` | `#64748B` | Timestamps, distance units, subtle labels |
| `--accent-primary` | `#38BDF8` | `#0284C7` | Active mode selection, corridor focus, interactive links |
| `--status-live` | `#10B981` | `#059669` | Active GPS feed indicator and moving bus status |
| `--status-cctv` | `#F59E0B` | `#D97706` | ATCS traffic camera badge and active camera markers |
| `--status-danger` | `#F43F5E` | `#E11D48` | Offline stream indicator |

### Trans Metro Deli Corridor Tokens

| Corridor | Route | Hex |
| :--- | :--- | :--- |
| **K1** | Terminal Pinang Baris to Terminal Amplas | `#10B981` |
| **K2** | Terminal Amplas to Lapangan Merdeka | `#3B82F6` |
| **K3** | Belawan to Lapangan Merdeka | `#F59E0B` |
| **K4** | Medan Tuntungan to Lapangan Merdeka | `#EF4444` |
| **K5** | Tembung to Lapangan Merdeka | `#8B5CF6` |

## 4. Typography & Scannable Hierarchy

- **Sans-Serif (`--font-sans`)**: `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` for UI labels, stop names, and intersection titles.
- **Monospace (`--font-mono`)**: `'Geist Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace` with `font-variant-numeric: tabular-nums` for fleet codes (`BUS 1-002`), speeds (`29 km/h`), ETAs (`3 mnt`), and distance readouts (`140m`).
- **Type Scale & Floor**:
  - Brand Title (`.brand-title`): `15px` (`0.9375rem`), weight `700`, tracking `-0.02em`
  - Detail Title (`.detail-title`): `15px` (`0.9375rem`), weight `650`, tracking `-0.015em`
  - Card Primary Label (`.bus-id`, `.cctv-card-name`): `13px` (`0.8125rem`), weight `600`
  - Secondary Body & Controls (`.mode-tab`, `.search-input`, `.next-stop-name`): `12px` to `12.5px`
  - Minimum Functional Text Floor: `11px` (`0.6875rem`) across all badges (`.mode-tab-badge`, `.route-badge--sm`, `.cctv-live-badge`, `.maplibregl-ctrl-attrib`). No text below `11px` is permitted.
- **No Eyebrow Kickers**: Headings (`h1`, `h2`) never have small uppercase kicker text stacked above them. Route badges sit inline beside the heading inside `.detail-title-row`.

## 5. Layout, Spatial Architecture & Responsive Adaptation

- **Desktop (`>= 768px`)**:
  - `.transit-panel` floats at `top: 14px; left: 14px; width: 356px; max-height: calc(100dvh - 28px)` with `border-radius: 18px`.
  - `#btn-dock-collapse` collapses `.dock-collapsible` (`max-height: 0; opacity: 0`) so the dock condenses into a single compact header pill when the user wants unobstructed map visibility.
  - Camera `flyTo` and `fitBounds` calls offset left padding (`left: 390`) when the desktop dock is expanded so centered markers appear in the open map area to the right of the dock.
- **Mobile (`<= 767px`)**:
  - `.transit-panel` floats above the bottom edge (`left: 10px; right: 10px; bottom: 10px; border-radius: 20px`) with touch-drag and tap-to-cycle snap states: `data-sheet="collapsed"` (`86px`), `data-sheet="half"` (`46dvh`), and `data-sheet="expanded"` (`84dvh`).
  - All mobile interactive controls enforce a minimum `44px` hit target (`min-height: 44px; min-width: 44px`).

## 6. Core Component Specifications

- **Dock Header (`.dock-header`)**: Houses the brand mark, `.live-status-pill` (live GPS status dot + active unit counter), theme toggle (`#btn-theme`), and desktop dock collapse toggle (`#btn-dock-collapse`).
- **Mode Switcher (`.mode-switcher`)**: Two-tab segmented control inside a translucent trough (`Bus Listrik` and `CCTV (187)`).
- **Search & Corridor Filter (`.dock-toolbar`)**: Translucent search input with instant clear button (`#btn-clear-search`) and a single-row horizontal pill strip for Corridors K1 through K5.
- **Bus Card (`.bus-card`)**: Compact 2-line glass card displaying corridor badge (`K1`), fleet number (`BUS 1-002`), tabular speed readout (`29 km/h`), and next stop with ETA (`Menuju Halte Putri Hijau · 2 mnt`).
- **Bus Detail View (`renderBusDetail`)**: Inline header with back button, corridor badge, fleet title, and `3D Ikuti` camera button; a single-line horizontal `.telemetry-strip` (`Kecepatan`, `Status`, `Halte Berikutnya`); and a vertical `.route-timeline` of upcoming stops.
- **CCTV Detail View (`renderCctvDetail`)**: Inline header with back button, `LIVE ATCS` badge, intersection title, multi-angle switcher tabs (`.cctv-cam-tabs`), 16:9 HLS video container (`.cctv-player-wrapper`), and a minimal stream toolbar with `Muat Ulang` reload button.

## 7. Motion & Interaction States

- **Easing**: `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` for dock collapse, bottom-sheet snap transitions (`320ms`), and card hover elevation (`150ms`).
- **Focus & Selection**: Keyboard focus uses `:focus-visible` with `2px solid var(--accent-primary)` and `outline-offset: 2px`. Browser surfaces (`::selection`, `caret-color`, custom thin scrollbars, and `color-scheme`) are styled to match the active glass theme.

## 8. Anti-Patterns & Guardrails

- Never introduce opaque panel backgrounds (`#111827`, `#ffffff` at 100% alpha) that block the map canvas.
- Never apply `backdrop-filter` to individual list cards, badges, or buttons inside `.transit-panel`.
- Never re-introduce multi-card KPI summary strips above the list, redundant status badge rows at the bottom of bus cards, or non-functional "Lihat Siaran" dummy buttons on CCTV cards.
- Never place uppercase kicker labels above `h1` or `h2` headings.
