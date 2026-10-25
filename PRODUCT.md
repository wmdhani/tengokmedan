# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Commuters and citizens navigating Medan who need live electric bus positions, corridor arrival estimates (ETAs), nearest transit stops, and real-time Dishub ATCS intersection camera streams on desktop or mobile devices.

## Product Purpose
TengokMedan provides a unified, map-first view of Medan's public electric bus network (Corridors K1 through K5) and Dishub Medan ATCS traffic cameras. Success means a commuter can identify the nearest stop, verify incoming bus ETAs, or inspect road traffic conditions within seconds without losing sight of the map canvas.

## Positioning
Combines smooth 60fps interpolated 3D/2D MapLibre GL vector tracking of Medan's electric bus fleet with 187+ Dishub ATCS live HLS intersection feeds in a single lightweight, offline-resilient Progressive Web App.

## Operating Context
Used on mobile phones at sunny roadside bus stops in Medan as well as desktop browsers before commuting. Network conditions vary, requiring automatic fallback from local PMTiles (`medan.pmtiles`) to Carto raster tiles and from live gateway APIs to cached local JSON datasets.

## Capabilities and Constraints
- Live tracking and bearing interpolation for 5 electric bus corridors (`K1` Amplas - Pinang Baris, `K2` J-City - Plaza Medan Fair, `K3` Belawan - Lap. Merdeka, `K4` Pasar Induk - Lap. Merdeka, `K5` Bandar Khalipah - Lap. Merdeka).
- Station proximity calculation (Haversine distance and walking time) and upcoming stop ETA timelines.
- Clustered and individual Dishub Medan ATCS CCTV markers with multi-angle HLS video streaming (`hls.js` and native HLS support).
- Zero-framework vanilla HTML5, CSS3, and ES6+ JavaScript served via FastAPI (`backend/main.py`).
- Multi-modal transit tracking: Real-time telemetry for Bus Listrik corridors (K1-K5) and timetable dead-reckoning tracking along continuous OSM track geometry for Kereta Api Bandara (KA Bandara Kualanamu & KA Sri Lelawangsa Binjai/Kuala Bingai) with fare schedules, station departure boards, and direct reservation integration.

## Brand Commitments
- Product name: **TengokMedan**.
- Visual system: Minimalist, map-centric Glassmorphism (`Smoked Obsidian` dark mode default with a working `Frosted Daylight` light mode toggle).
- Glass hierarchy: `backdrop-filter` blur is reserved for the two primary floating HUD containers (the unified floating dock and the floating map camera control capsule), while nested cards use lightweight semi-transparent fills and 1px specular borders.
- Typography: `Geist` for UI labels and `Geist Mono` (`tabular-nums`) for fleet IDs, speeds, distances, and ETAs.

## Evidence on Hand
- Route geometries and metadata: `frontend/data/routes.json`, `frontend/data/routes_geojson.json`.
- Station catalog: `frontend/data/stations.json`.
- Bus fleet snapshot fallback: `frontend/data/sample_buses.json`.
- Railink station catalog, timetable, and corridor geometry: `frontend/data/railink_stations.json`, `frontend/data/railink_schedule.json`, `frontend/data/railink_corridor.geojson`.
- Dishub Medan ATCS camera catalog: `frontend/data/cctv_medan.json`.
- Vector basemap archive: `backend/static/maps/medan.pmtiles`.

## Product Principles
1. **Map Visibility First:** Every pixel of opaque chrome steals spatial context. Keep the map full-bleed (`100vw` by `100dvh`) and float all controls in compact, collapsible translucent HUD layers.
2. **One Signal Per Metric:** Never repeat the same count or status badge across multiple headers, strips, and cards.
3. **Graceful Degradation:** Always fall back cleanly when live APIs, WebGL features, or PMTiles are unreachable.

## Accessibility & Inclusion
- WCAG AA contrast ratios (minimum 4.5:1 for normal text and 3:1 for large text) across both dark and light glass themes.
- Full keyboard navigation (`Tab`, `Enter`, `Escape` to close active detail views or collapse the sheet) and visible focus rings.
- Minimum 44px touch targets on mobile viewports.
