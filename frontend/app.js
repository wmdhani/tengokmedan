/**
 * Pelacak armada Bus Listrik Kota Medan dan CCTV ATCS secara real-time di peta 3D.
 */
(() => {
  "use strict";

  function resolveApiBaseUrl() {
    const { protocol, hostname, port } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isExternalDevServer = protocol === "file:" || (isLocalHost && port !== "8000");
    return isExternalDevServer ? "http://localhost:8000/api/v1" : "/api/v1";
  }

  function resolvePmtilesUrl() {
    const { protocol, hostname, port, origin } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isExternalDevServer = protocol === "file:" || (isLocalHost && port !== "8000");
    const base = isExternalDevServer ? "http://localhost:8000" : origin;
    return `${base}/static/maps/medan.pmtiles`;
  }

  let pmtilesProtocolInstance = null;

  function ensurePmtilesProtocol() {
    const pmtilesLib = window.pmtiles || (typeof pmtiles !== "undefined" ? pmtiles : null);
    const maplibreLib = window.maplibregl || (typeof maplibregl !== "undefined" ? maplibregl : null);

    if (!pmtilesLib || !maplibreLib) {
      return false;
    }

    if (!pmtilesProtocolInstance) {
      try {
        pmtilesProtocolInstance = new pmtilesLib.Protocol();
        maplibreLib.addProtocol("pmtiles", pmtilesProtocolInstance.tile);
      } catch {
        // Abaikan jika protokol sudah terdaftar sebelumnya
      }
    }
    return true;
  }

  const CONFIG = Object.freeze({
    apiBaseUrl: resolveApiBaseUrl(),
    directApiBaseUrl: "https://buslistrikmedan.com/api",
    osrmBaseUrl: "https://router.project-osrm.org/route/v1/driving",
    osrmMaxWaypoints: 90,
    pmtilesUrl: resolvePmtilesUrl(),
    glyphsUrl: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    pollIntervalMs: 6500,
    tweenDurationMs: 6000,
    geolocationTimeoutMs: 8000,
    toastDurationMs: 4000,
    walkingSpeedKmPerMin: 0.075,
    maxUpcomingStops: 8,
    defaultLineId: "10011001",
  });

  const CAMERA = Object.freeze({
    center: [98.6722, 3.5952],
    zoom: 12.8,
    minZoom: 10.8,
    initialBearing: -10,
    pitch3d: 45,
    focusPitch: 55,
    userZoom: 15.5,
    busZoom: 15.2,
    stopZoom: 16,
  });

  const ALL_CORRIDORS = "ALL";

  const ROUTES = Object.freeze({
    "10011001": { code: "K1", color: "#0284c7", name: "Amplas - Pinang Baris" },
    "10011003": { code: "K2", color: "#059669", name: "J-City - Plaza Medan Fair" },
    "10011004": { code: "K3", color: "#d97706", name: "Belawan - Lap. Merdeka" },
    "10011005": { code: "K4", color: "#1d5fbf", name: "Pasar Induk - Lap. Merdeka" },
    "10011006": { code: "K5", color: "#e11d48", name: "Bandar Khalipah - Lap. Merdeka" },
  });

  const FALLBACK_ROUTE = Object.freeze({ code: "BUS", color: "#0ea5e9", name: "Koridor Umum" });

  const SOURCE = Object.freeze({
    routes: "routes-data",
    stations: "stations-data",
    buses: "buses-data",
    cctv: "cctv-data",
    railCorridor: "rail-corridor-data",
    railStations: "rail-stations-data",
    railTrains: "rail-trains-data",
  });

  const LAYER = Object.freeze({
    routesGlow: "routes-glow",
    routesCasing: "routes-casing",
    routesLine: "routes-line",
    stations: "stations-layer",
    busesHeading: "buses-heading",
    buses: "buses-layer",
    cctvClusters: "cctv-clusters",
    cctvClusterCount: "cctv-cluster-count",
    cctvPins: "cctv-pins",
    railGlow: "rail-glow",
    railCasing: "rail-casing",
    railLine: "rail-line",
    railStations: "rail-stations",
    railStationsLabel: "rail-stations-label",
    railTrains: "rail-trains",
    railTrainsHeading: "rail-trains-heading",
  });

  const GEOLOCATION_ERRORS = Object.freeze({
    1: "Izin lokasi tidak diberikan. Harap aktifkan izin lokasi di pengaturan browser.",
    2: "Lokasi tidak ditemukan. Coba lagi di tempat terbuka.",
    3: "Pencarian lokasi terlalu lama. Periksa internet Anda lalu coba lagi.",
  });

  const state = {
    theme: localStorage.getItem("tengokmedan-theme") || "dark",
    activeMode: "bus",
    transitSubmode: "bus",
    buses: [],
    stations: [],
    cctvLocations: [],
    trainSchedule: null,
    trainStations: [],
    trainCorridorGeojson: null,
    trainCorridorCoords: [],
    trains: [],
    selectedTrainId: null,
    selectedTrainStation: null,
    trainDirectionFilter: ALL_CORRIDORS,
    isFollowingTrain: false,
    selectedCctvId: null,
    selectedCctvCameraIndex: 0,
    cctvStatus: "loading",
    hlsInstance: null,
    busStatus: "loading",
    selectedCorridor: ALL_CORRIDORS,
    selectedBusId: null,
    selectedStation: null,
    isFollowingBus: false,
    searchQuery: "",
    is3D: false,
    isDockCollapsed: false,
    sheetTier: "collapsed",
    userCoords: null,
    userMarker: null,
    nearestStop: null,
    cache: {
      [SOURCE.routes]: [],
      [SOURCE.stations]: [],
      [SOURCE.buses]: [],
      [SOURCE.cctv]: [],
      [SOURCE.railCorridor]: [],
      [SOURCE.railStations]: [],
      [SOURCE.railTrains]: [],
    },
    usedFallbackBasemap: false,
  };

  // Target interpolasi posisi per armada (key: CarNo)
  const tween = {
    states: new Map(),
    frameId: null,
  };

  const poller = {
    timerId: null,
    inFlight: false,
  };

  const dom = {
    busStat: document.getElementById("stat-bus"),
    btn3d: document.getElementById("btn-3d"),
    btnGps: document.getElementById("btn-gps"),
    btnDockCollapse: document.getElementById("btn-dock-collapse"),
    compassNeedle: document.getElementById("compass-needle"),
    bottomSheet: document.getElementById("bottom-sheet"),
    sheetToggle: document.getElementById("sheet-toggle"),
    corridorPills: document.getElementById("corridor-pills"),
    corridorFilterWrap: document.querySelector(".corridor-filter-wrap"),
    sheetContent: document.getElementById("sheet-content"),
    searchInput: document.getElementById("search-input"),
    btnClearSearch: document.getElementById("btn-clear-search"),
    toast: document.getElementById("toast"),
    tabBus: document.getElementById("tab-bus"),
    tabCctv: document.getElementById("tab-cctv"),
    cctvBadgeCount: document.getElementById("cctv-badge-count"),
    transitSubmodeSelector: document.getElementById("transit-submode-selector"),
    btnSubmodeBus: document.getElementById("btn-submode-bus"),
    btnSubmodeTrain: document.getElementById("btn-submode-train"),
  };

  /** @type {maplibregl.Map | null} */
  let map = null;
  let toastTimerId = null;

  const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
  }

  function toNumber(value, fallback = 0) {
    const number = parseFloat(value);
    return Number.isFinite(number) ? number : fallback;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (start, end, progress) => start + (end - start) * progress;
  function lerpAngle(start, end, progress) {
    let diff = (end - start) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return (start + diff * progress + 360) % 360;
  }
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  function haversineKm(lat1, lng1, lat2, lng2) {
    const EARTH_RADIUS_KM = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function computeBearing(startLng, startLat, endLng, endLat) {
    const dLng = toRadians(endLng - startLng);
    const lat1 = toRadians(startLat);
    const lat2 = toRadians(endLat);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return Math.round((bearing + 360) % 360);
  }

  function getCoordinates(item) {
    const lng = parseFloat(item?.Longitude);
    const lat = parseFloat(item?.Latitude);
    const isValid = Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0;
    return isValid ? [lng, lat] : null;
  }

  const getRouteMeta = (routeId) => ROUTES[String(routeId)] ?? FALLBACK_ROUTE;
  const getBusId = (bus) => String(bus.CarNo);
  const getBusRouteId = (bus) => String(bus.Routeid || bus.Lineid || "");
  const findBusById = (busId) => state.buses.find((bus) => getBusId(bus) === String(busId));

  function getStationLineId(station) {
    return String(
      station.Lineid || station.Routeid || station.lineid || station.Routes?.[0] || CONFIG.defaultLineId,
    );
  }

  function getVisibleBuses() {
    let list = state.buses;
    if (state.selectedCorridor !== ALL_CORRIDORS) {
      list = list.filter((bus) => getBusRouteId(bus) === state.selectedCorridor);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter((bus) => {
        const carNo = String(bus.CarNo || "").toLowerCase();
        const route = getRouteMeta(getBusRouteId(bus));
        const routeName = (route.name + " " + route.code).toLowerCase();
        const nextStop = String(bus.Stations?.[0]?.Stationname || "").toLowerCase();
        return carNo.includes(q) || routeName.includes(q) || nextStop.includes(q);
      });
    }
    return list;
  }

  function getVisibleCctvLocations() {
    let list = state.cctvLocations;
    const query = state.searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((loc) => {
        const name = String(loc.name || "").toLowerCase();
        const desc = String(loc.description || "").toLowerCase();
        const camAliases = Array.isArray(loc.cameras)
          ? loc.cameras.map((c) => String(c.alias || c.name || "").toLowerCase()).join(" ")
          : "";
        return name.includes(query) || desc.includes(query) || camAliases.includes(query);
      });
    }
    return list;
  }

  function getSpeedStatus(speed) {
    const value = toNumber(speed);
    const isLight = state.theme === "light";
    if (value <= 0) {
      return {
        label: "Berhenti",
        color: isLight ? "#475569" : "#94a3b8",
        bg: isLight ? "rgba(100, 116, 139, 0.12)" : "rgba(148, 163, 184, 0.14)",
      };
    }
    if (value < 12) {
      return {
        label: "Padat",
        color: isLight ? "#dc2626" : "#fca5a5",
        bg: isLight ? "rgba(220, 38, 38, 0.12)" : "rgba(248, 113, 113, 0.16)",
      };
    }
    if (value <= 25) {
      return {
        label: "Sedang",
        color: isLight ? "#b45309" : "#fbbf24",
        bg: isLight ? "rgba(180, 83, 9, 0.12)" : "rgba(251, 191, 36, 0.16)",
      };
    }
    return {
      label: "Lancar",
      color: isLight ? "#047857" : "#34d399",
      bg: isLight ? "rgba(4, 120, 87, 0.12)" : "rgba(52, 211, 153, 0.16)",
    };
  }

  const formatSpeed = (speed) => Math.round(toNumber(speed));
  const formatEtaMinutes = (minutes) => Math.max(1, Math.round(toNumber(minutes, 1)));
  const featureCollection = (features) => ({ type: "FeatureCollection", features });
  const getActivePitch = (pitch3d = CAMERA.pitch3d) => (state.is3D ? pitch3d : 0);

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} saat memuat ${url}`);
    }
    return response.json();
  }

  function getFallbackRasterStyle(theme) {
    const isLight = theme === "light";
    const tileSubdomain = isLight ? "light_all" : "dark_all";
    return {
      version: 8,
      name: `Fallback Raster (${isLight ? "Light" : "Dark"})`,
      sources: {
        "carto-raster": {
          type: "raster",
          tiles: [
            `https://a.basemaps.cartocdn.com/rastertiles/${tileSubdomain}/{z}/{x}/{y}.png`,
            `https://b.basemaps.cartocdn.com/rastertiles/${tileSubdomain}/{z}/{x}/{y}.png`,
            `https://c.basemaps.cartocdn.com/rastertiles/${tileSubdomain}/{z}/{x}/{y}.png`,
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &bull; &copy; OpenStreetMap',
        },
      },
      layers: [
        {
          id: "carto-raster-layer",
          type: "raster",
          source: "carto-raster",
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };
  }

  function getProtomapsStyle(theme) {
    const isLight = theme === "light";
    const pmtilesUrl = resolvePmtilesUrl();

    return {
      version: 8,
      name: `Protomaps Medan (${isLight ? "Muted Pastel" : "Dark"})`,
      glyphs: CONFIG.glyphsUrl,
      sources: {
        protomaps: {
          type: "vector",
          url: `pmtiles://${pmtilesUrl}`,
          attribution:
            '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &bull; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>',
        },
      },
      layers: [
        {
          id: "base-background",
          type: "background",
          paint: {
            "background-color": isLight ? "#f8fafc" : "#08090d",
          },
        },
        {
          id: "base-earth",
          type: "fill",
          source: "protomaps",
          "source-layer": "earth",
          paint: {
            "fill-color": isLight ? "#f8fafc" : "#08090d",
          },
        },
        {
          id: "base-urban",
          type: "fill",
          source: "protomaps",
          "source-layer": "landuse",
          filter: [
            "in",
            "kind",
            "residential", "commercial", "industrial", "retail", "institutional", "education"
          ],
          paint: {
            "fill-color": isLight ? "#f1f5f9" : "#0d1117",
            "fill-opacity": isLight ? 0.7 : 0.6,
          },
        },
        {
          id: "base-greenery",
          type: "fill",
          source: "protomaps",
          "source-layer": "landuse",
          filter: [
            "in",
            "kind",
            "park", "garden", "grass", "pitch", "golf_course", "playground",
            "forest", "wood", "meadow", "scrub", "nature_reserve", "village_green", "cemetery"
          ],
          paint: {
            "fill-color": isLight ? "#d4ecd2" : "#13231e",
            "fill-opacity": isLight ? 0.75 : 0.8,
          },
        },
        {
          id: "base-greenery-outline",
          type: "line",
          source: "protomaps",
          "source-layer": "landuse",
          filter: [
            "in",
            "kind",
            "park", "garden", "grass", "pitch", "golf_course", "playground",
            "forest", "wood", "meadow", "scrub", "nature_reserve", "village_green", "cemetery"
          ],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isLight ? "rgba(74, 138, 90, 0.28)" : "rgba(52, 211, 153, 0.20)",
            "line-width": 0.8,
          },
        },
        {
          id: "base-water",
          type: "fill",
          source: "protomaps",
          "source-layer": "water",
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          paint: {
            "fill-color": isLight ? "#bfe3f2" : "#14202e",
          },
        },
        {
          id: "base-waterway-line",
          type: "line",
          source: "protomaps",
          "source-layer": "water",
          filter: ["==", ["geometry-type"], "LineString"],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isLight ? "#9ec5e8" : "#13202e",
            "line-opacity": isLight ? 0.7 : 0.65,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 0.5,
              13, 1.1,
              16, 2.0,
            ],
          },
        },
        {
          id: "base-water-outline",
          type: "line",
          source: "protomaps",
          "source-layer": "water",
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isLight ? "rgba(14, 116, 144, 0.22)" : "rgba(56, 189, 248, 0.15)",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 0.4,
              14, 0.8,
            ],
          },
        },
        {
          id: "base-buildings",
          type: "fill",
          source: "protomaps",
          "source-layer": "buildings",
          minzoom: 13,
          paint: {
            "fill-color": isLight ? "#edf2f7" : "#111827",
            "fill-opacity": 0.5,
          },
        },
        {
          id: "base-roads-casing",
          type: "line",
          source: "protomaps",
          "source-layer": "roads",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isLight ? "#e2e8f0" : "#1e293b",
            "line-width": [
              "interpolate",
              ["exponential", 1.5],
              ["zoom"],
              10, 1.2,
              13, 2.5,
              16, 7.5,
            ],
          },
        },
        {
          id: "base-roads",
          type: "line",
          source: "protomaps",
          "source-layer": "roads",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isLight ? "#ffffff" : "#161e2e",
            "line-width": [
              "interpolate",
              ["exponential", 1.5],
              ["zoom"],
              10, 0.8,
              13, 1.8,
              16, 5.5,
            ],
          },
        },
        {
          id: "base-road-labels",
          type: "symbol",
          source: "protomaps",
          "source-layer": "roads",
          minzoom: 11,
          filter: [
            "all",
            ["has", "name"],
            ["in", "kind", "highway", "major_road"],
          ],
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11, 9,
              15, 11.5,
            ],
            "text-letter-spacing": 0.04,
            "text-optional": true,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": isLight ? "#64748b" : "#94a3b8",
            "text-halo-color": isLight ? "#ffffff" : "#08090d",
            "text-halo-width": 1.5,
          },
        },
        {
          id: "base-road-labels-local",
          type: "symbol",
          source: "protomaps",
          "source-layer": "roads",
          minzoom: 14,
          filter: [
            "all",
            ["has", "name"],
            ["!in", "kind", "highway", "major_road"],
          ],
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              14, 9,
              16, 10.5,
            ],
            "text-letter-spacing": 0.03,
            "text-optional": true,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": isLight ? "#94a3b8" : "#64748b",
            "text-halo-color": isLight ? "#ffffff" : "#08090d",
            "text-halo-width": 1.5,
          },
        },
        {
          id: "base-places",
          type: "symbol",
          source: "protomaps",
          "source-layer": "places",
          minzoom: 10,
          maxzoom: 14,
          filter: [
            "all",
            ["has", "name"],
            ["in", "kind", "city", "town", "district"],
          ],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 10.5,
              14, 12.5,
            ],
            "text-transform": "uppercase",
            "text-letter-spacing": 0.08,
            "text-max-width": 8,
            "text-optional": true,
            "text-allow-overlap": false,
            "text-variable-anchor": ["center", "top", "bottom"],
          },
          paint: {
            "text-color": isLight ? "#64748b" : "#94a3b8",
            "text-halo-color": isLight ? "#ffffff" : "#08090d",
            "text-halo-width": 1.5,
          },
        },
        {
          id: "base-places-detailed",
          type: "symbol",
          source: "protomaps",
          "source-layer": "places",
          minzoom: 14,
          filter: [
            "all",
            ["has", "name"],
            ["in", "kind", "city", "town", "district", "neighbourhood", "suburb", "quarter"],
          ],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              14, 11,
              16, 13,
            ],
            "text-transform": "uppercase",
            "text-letter-spacing": 0.06,
            "text-max-width": 9,
            "text-optional": true,
            "text-allow-overlap": false,
            "text-variable-anchor": ["center", "top", "bottom"],
          },
          paint: {
            "text-color": isLight ? "#64748b" : "#94a3b8",
            "text-halo-color": isLight ? "#ffffff" : "#08090d",
            "text-halo-width": 1.5,
          },
        },
      ],
    };
  }

  function isMapStyleReady() {
    if (!map || !map.style) return false;
    try {
      return Boolean(map.style._loaded || map.isStyleLoaded());
    } catch {
      return false;
    }
  }

  function updateBasemapTheme(newTheme) {
    if (!isMapStyleReady()) return false;
    if (state.usedFallbackBasemap) {
      map.setStyle(getFallbackRasterStyle(newTheme));
      map.once("styledata", () => {
        registerTransitLayers();
        applyCorridorFilter();
        restoreCachedSources();
        restartAnimation();
      });
      return true;
    }
    if (!map.getLayer("base-background")) return false;

    const isLight = newTheme === "light";
    try {
      map.setPaintProperty("base-background", "background-color", isLight ? "#f8fafc" : "#08090d");
      if (map.getLayer("base-earth")) {
        map.setPaintProperty("base-earth", "fill-color", isLight ? "#f8fafc" : "#08090d");
      }
      if (map.getLayer("base-urban")) {
        map.setPaintProperty("base-urban", "fill-color", isLight ? "#f1f5f9" : "#0d1117");
        map.setPaintProperty("base-urban", "fill-opacity", isLight ? 0.7 : 0.6);
      }
      if (map.getLayer("base-greenery")) {
        map.setPaintProperty("base-greenery", "fill-color", isLight ? "#d4ecd2" : "#13231e");
        map.setPaintProperty("base-greenery", "fill-opacity", isLight ? 0.75 : 0.8);
      }
      if (map.getLayer("base-greenery-outline")) {
        map.setPaintProperty("base-greenery-outline", "line-color", isLight ? "rgba(74, 138, 90, 0.28)" : "rgba(52, 211, 153, 0.20)");
      }
      if (map.getLayer("base-water")) {
        map.setPaintProperty("base-water", "fill-color", isLight ? "#bfe3f2" : "#14202e");
      }
      if (map.getLayer("base-waterway-line")) {
        map.setPaintProperty("base-waterway-line", "line-color", isLight ? "#9ec5e8" : "#13202e");
        map.setPaintProperty("base-waterway-line", "line-opacity", isLight ? 0.7 : 0.65);
      }
      if (map.getLayer("base-water-outline")) {
        map.setPaintProperty("base-water-outline", "line-color", isLight ? "rgba(14, 116, 144, 0.22)" : "rgba(56, 189, 248, 0.15)");
      }
      if (map.getLayer("base-buildings")) {
        map.setPaintProperty("base-buildings", "fill-color", isLight ? "#edf2f7" : "#111827");
      }
      if (map.getLayer("base-roads-casing")) {
        map.setPaintProperty("base-roads-casing", "line-color", isLight ? "#e2e8f0" : "#1e293b");
      }
      if (map.getLayer("base-roads")) {
        map.setPaintProperty("base-roads", "line-color", isLight ? "#ffffff" : "#161e2e");
      }
      if (map.getLayer("base-road-labels")) {
        map.setPaintProperty("base-road-labels", "text-color", isLight ? "#64748b" : "#94a3b8");
        map.setPaintProperty("base-road-labels", "text-halo-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer("base-road-labels-local")) {
        map.setPaintProperty("base-road-labels-local", "text-color", isLight ? "#94a3b8" : "#64748b");
        map.setPaintProperty("base-road-labels-local", "text-halo-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer("base-places")) {
        map.setPaintProperty("base-places", "text-color", isLight ? "#64748b" : "#94a3b8");
        map.setPaintProperty("base-places", "text-halo-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer("base-places-detailed")) {
        map.setPaintProperty("base-places-detailed", "text-color", isLight ? "#64748b" : "#94a3b8");
        map.setPaintProperty("base-places-detailed", "text-halo-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer(LAYER.routesCasing)) {
        map.setPaintProperty(LAYER.routesCasing, "line-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer(LAYER.stations)) {
        map.setPaintProperty(LAYER.stations, "circle-stroke-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer(LAYER.busesHeading)) {
        map.setPaintProperty(LAYER.busesHeading, "icon-halo-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer(LAYER.cctvClusters)) {
        map.setPaintProperty(LAYER.cctvClusters, "circle-stroke-color", isLight ? "#ffffff" : "#08090d");
      }
      if (map.getLayer(LAYER.cctvPins)) {
        map.setPaintProperty(LAYER.cctvPins, "circle-stroke-color", isLight ? "#ffffff" : "#08090d");
      }
      return true;
    } catch (error) {
      console.warn("[Tema] Gagal memperbarui properti cat peta:", error);
      return false;
    }
  }

  function ensureHeadingIcon(instance) {
    if (!instance) return;
    try {
      if (instance.hasImage("heading-cone")) return;
      const canvas = document.createElement("canvas");
      canvas.width = 36;
      canvas.height = 36;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(18, 5);
      ctx.lineTo(29, 27);
      ctx.lineTo(18, 20);
      ctx.lineTo(7, 27);
      ctx.closePath();
      ctx.fill();

      const imageData = ctx.getImageData(0, 0, 36, 36);
      instance.addImage("heading-cone", imageData, { sdf: true });
    } catch (err) {
      console.warn("[Icon] Gagal mendaftarkan ikon penunjuk arah:", err);
    }
  }

  function getBasemapStyle(theme) {
    if (state.usedFallbackBasemap) {
      return getFallbackRasterStyle(theme);
    }
    if (ensurePmtilesProtocol()) {
      return getProtomapsStyle(theme);
    }
    state.usedFallbackBasemap = true;
    return getFallbackRasterStyle(theme);
  }

  function createMap() {
    ensurePmtilesProtocol();
    const initialStyle = getBasemapStyle(state.theme);
    const instance = new maplibregl.Map({
      container: "map",
      style: initialStyle,
      center: CAMERA.center,
      zoom: CAMERA.zoom,
      minZoom: CAMERA.minZoom,
      maxBounds: [
        [98.35, 3.32],
        [98.98, 3.82],
      ],
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    return instance;
  }

  function registerTransitLayers() {
    if (!isMapStyleReady()) return;

    ensureHeadingIcon(map);

    Object.values(SOURCE).forEach((sourceId) => {
      if (!map.getSource(sourceId)) {
        if (sourceId === SOURCE.cctv) {
          map.addSource(sourceId, {
            type: "geojson",
            data: featureCollection(state.cache[sourceId] || []),
            cluster: true,
            clusterMaxZoom: 13,
            clusterRadius: 45,
          });
        } else {
          map.addSource(sourceId, {
            type: "geojson",
            data: featureCollection(state.cache[sourceId] || []),
          });
        }
      }
    });

    const isLight = state.theme === "light";
    const busVisibility = state.activeMode === "bus" ? "visible" : "none";
    const cctvVisibility = state.activeMode === "cctv" ? "visible" : "none";

    if (!map.getLayer(LAYER.routesGlow)) {
      map.addLayer({
        id: LAYER.routesGlow,
        type: "line",
        source: SOURCE.routes,
        layout: { "line-join": "round", "line-cap": "round", visibility: busVisibility },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 15, 8],
          "line-opacity": 0.35,
          "line-blur": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 4],
        },
      });
    }

    if (!map.getLayer(LAYER.routesCasing)) {
      map.addLayer({
        id: LAYER.routesCasing,
        type: "line",
        source: SOURCE.routes,
        layout: { "line-join": "round", "line-cap": "round", visibility: busVisibility },
        paint: {
          "line-color": isLight ? "#ffffff" : "#08090d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.8, 14, 5.5, 16, 7],
          "line-opacity": 0.75,
        },
      });
    }

    if (!map.getLayer(LAYER.routesLine)) {
      map.addLayer({
        id: LAYER.routesLine,
        type: "line",
        source: SOURCE.routes,
        layout: { "line-join": "round", "line-cap": "round", visibility: busVisibility },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 3.2, 16, 4.5],
          "line-opacity": 0.95,
        },
      });
    }

    if (!map.getLayer(LAYER.stations)) {
      map.addLayer({
        id: LAYER.stations,
        type: "circle",
        source: SOURCE.stations,
        layout: { visibility: busVisibility },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 3.5, 16, 5],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": isLight ? "#ffffff" : "#08090d",
        },
      });
    }

    if (!map.getLayer(LAYER.buses)) {
      map.addLayer({
        id: LAYER.buses,
        type: "circle",
        source: SOURCE.buses,
        layout: { visibility: busVisibility },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 15, 9.5],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "speedColor"],
          "circle-pitch-alignment": "map",
        },
      });
    }

    if (!map.getLayer(LAYER.busesHeading)) {
      map.addLayer({
        id: LAYER.busesHeading,
        type: "symbol",
        source: SOURCE.buses,
        filter: ["all", [">", ["get", "speed"], 0], ["has", "bearing"]],
        layout: {
          "icon-image": "heading-cone",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.42, 14, 0.58, 16, 0.78],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-offset": [0, 0],
          visibility: busVisibility,
        },
        paint: {
          "icon-color": "#ffffff",
          "icon-halo-color": isLight ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.75)",
          "icon-halo-width": 1.2,
        },
      });
    }

    if (!map.getLayer(LAYER.cctvClusters)) {
      map.addLayer({
        id: LAYER.cctvClusters,
        type: "circle",
        source: SOURCE.cctv,
        filter: ["has", "point_count"],
        layout: { visibility: cctvVisibility },
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#6366f1",
            10,
            "#4f46e5",
            25,
            "#4338ca",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            24,
            25,
            30,
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": isLight ? "#ffffff" : "#08090d",
        },
      });
    }

    if (!map.getLayer(LAYER.cctvClusterCount)) {
      map.addLayer({
        id: LAYER.cctvClusterCount,
        type: "symbol",
        source: SOURCE.cctv,
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          visibility: cctvVisibility,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
    }

    if (!map.getLayer(LAYER.cctvPins)) {
      map.addLayer({
        id: LAYER.cctvPins,
        type: "circle",
        source: SOURCE.cctv,
        filter: ["!", ["has", "point_count"]],
        layout: { visibility: cctvVisibility },
        paint: {
          "circle-color": "#6366f1",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 14, 7.5, 16, 10],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": isLight ? "#ffffff" : "#08090d",
        },
      });
    }

    if (!map.getLayer(LAYER.railGlow)) {
      map.addLayer({
        id: LAYER.railGlow,
        type: "line",
        source: SOURCE.railCorridor,
        layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
        paint: {
          "line-color": "#009aa6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 10],
          "line-opacity": 0.6,
          "line-blur": 3,
        },
      });
    }

    if (!map.getLayer(LAYER.railCasing)) {
      map.addLayer({
        id: LAYER.railCasing,
        type: "line",
        source: SOURCE.railCorridor,
        layout: { "line-join": "round", "line-cap": "round", visibility: "visible" },
        paint: {
          "line-color": isLight ? "#ffffff" : "#08090d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
          "line-opacity": 0.5,
        },
      });
    }

    if (!map.getLayer(LAYER.railLine)) {
      map.addLayer({
        id: LAYER.railLine,
        type: "line",
        source: SOURCE.railCorridor,
        layout: { "line-join": "round", "line-cap": "round", visibility: "visible" },
        paint: {
          "line-color": "#009aa6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 4],
          "line-opacity": 0.4,
          "line-dasharray": [3, 2],
        },
      });
    }

    if (!map.getLayer(LAYER.railStations)) {
      map.addLayer({
        id: LAYER.railStations,
        type: "circle",
        source: SOURCE.railStations,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 6, 16, 8],
          "circle-color": "#009aa6",
          "circle-stroke-width": 2,
          "circle-stroke-color": isLight ? "#ffffff" : "#08090d",
          "circle-opacity": 0.6,
        },
      });
    }

    if (!map.getLayer(LAYER.railStationsLabel)) {
      map.addLayer({
        id: LAYER.railStationsLabel,
        type: "symbol",
        source: SOURCE.railStations,
        layout: {
          "text-field": "{short_name}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 12],
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          visibility: "none",
        },
        paint: {
          "text-color": isLight ? "#0f172a" : "#f1f5f9",
          "text-halo-color": isLight ? "rgba(255, 255, 255, 0.85)" : "rgba(8, 9, 13, 0.85)",
          "text-halo-width": 1.5,
        },
      });
    }

    if (!map.getLayer(LAYER.railTrains)) {
      map.addLayer({
        id: LAYER.railTrains,
        type: "circle",
        source: SOURCE.railTrains,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 14, 10, 16, 13],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
          "circle-pitch-alignment": "map",
        },
      });
    }

    if (!map.getLayer(LAYER.railTrainsHeading)) {
      map.addLayer({
        id: LAYER.railTrainsHeading,
        type: "symbol",
        source: SOURCE.railTrains,
        layout: {
          "icon-image": "heading-cone",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.45, 14, 0.65, 16, 0.9],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": "{trip_id}",
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, -1.8],
          "text-anchor": "bottom",
          visibility: "none",
        },
        paint: {
          "icon-color": "#ffffff",
          "text-color": "#ffffff",
          "text-halo-color": isLight ? "rgba(0, 0, 0, 0.65)" : "rgba(0, 0, 0, 0.85)",
          "text-halo-width": 1.5,
        },
      });
    }

    updateLayerVisibility();
  }

  function updateLayerVisibility() {
    if (!map) return;

    const isCctvMode = state.activeMode === "cctv";
    const isTransitMode = !isCctvMode;
    const isBusSubmode = isTransitMode && state.transitSubmode === "bus";
    const isTrainSubmode = isTransitMode && state.transitSubmode === "train";

    const cctvVisibility = isCctvMode ? "visible" : "none";
    [
      LAYER.cctvClusters,
      LAYER.cctvClusterCount,
      LAYER.cctvPins,
    ].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", cctvVisibility);
        } catch {
          // Abaikan jika style sedang transisi
        }
      }
    });

    if (isCctvMode) {
      [
        LAYER.routesGlow,
        LAYER.routesCasing,
        LAYER.routesLine,
        LAYER.stations,
        LAYER.buses,
        LAYER.busesHeading,
        LAYER.railGlow,
        LAYER.railCasing,
        LAYER.railLine,
        LAYER.railStations,
        LAYER.railStationsLabel,
        LAYER.railTrains,
        LAYER.railTrainsHeading,
      ].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          try {
            map.setLayoutProperty(layerId, "visibility", "none");
          } catch {
            // Abaikan jika style sedang transisi
          }
        }
      });
      return;
    }

    if (isBusSubmode) {
      [
        LAYER.routesGlow,
        LAYER.routesCasing,
        LAYER.routesLine,
        LAYER.stations,
        LAYER.buses,
        LAYER.busesHeading,
      ].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          try {
            map.setLayoutProperty(layerId, "visibility", "visible");
          } catch {
            // Abaikan jika style sedang transisi
          }
        }
      });
      if (map.getLayer(LAYER.routesLine)) {
        try {
          map.setPaintProperty(LAYER.routesLine, "line-opacity", 0.95);
        } catch { }
      }

      // Tampilkan rel secara halus di latar belakang
      if (map.getLayer(LAYER.railGlow)) {
        try { map.setLayoutProperty(LAYER.railGlow, "visibility", "none"); } catch { }
      }
      if (map.getLayer(LAYER.railCasing)) {
        try {
          map.setLayoutProperty(LAYER.railCasing, "visibility", "visible");
          map.setPaintProperty(LAYER.railCasing, "line-opacity", 0.45);
        } catch { }
      }
      if (map.getLayer(LAYER.railLine)) {
        try {
          map.setLayoutProperty(LAYER.railLine, "visibility", "visible");
          map.setPaintProperty(LAYER.railLine, "line-opacity", 0.35);
        } catch { }
      }
      if (map.getLayer(LAYER.railStations)) {
        try {
          map.setLayoutProperty(LAYER.railStations, "visibility", "visible");
          map.setPaintProperty(LAYER.railStations, "circle-opacity", 0.55);
        } catch { }
      }
      if (map.getLayer(LAYER.railStationsLabel)) {
        try { map.setLayoutProperty(LAYER.railStationsLabel, "visibility", "none"); } catch { }
      }
      if (map.getLayer(LAYER.railTrains)) {
        try { map.setLayoutProperty(LAYER.railTrains, "visibility", "none"); } catch { }
      }
      if (map.getLayer(LAYER.railTrainsHeading)) {
        try { map.setLayoutProperty(LAYER.railTrainsHeading, "visibility", "none"); } catch { }
      }
    } else if (isTrainSubmode) {
      // Redupkan bus agar koridor kereta menonjol
      if (map.getLayer(LAYER.routesGlow)) {
        try { map.setLayoutProperty(LAYER.routesGlow, "visibility", "none"); } catch { }
      }
      if (map.getLayer(LAYER.routesCasing)) {
        try {
          map.setLayoutProperty(LAYER.routesCasing, "visibility", "visible");
          map.setPaintProperty(LAYER.routesCasing, "line-opacity", 0.2);
        } catch { }
      }
      if (map.getLayer(LAYER.routesLine)) {
        try {
          map.setLayoutProperty(LAYER.routesLine, "visibility", "visible");
          map.setPaintProperty(LAYER.routesLine, "line-opacity", 0.18);
        } catch { }
      }
      if (map.getLayer(LAYER.stations)) {
        try {
          map.setLayoutProperty(LAYER.stations, "visibility", "visible");
          map.setPaintProperty(LAYER.stations, "circle-opacity", 0.25);
        } catch { }
      }
      if (map.getLayer(LAYER.buses)) {
        try { map.setLayoutProperty(LAYER.buses, "visibility", "none"); } catch { }
      }
      if (map.getLayer(LAYER.busesHeading)) {
        try { map.setLayoutProperty(LAYER.busesHeading, "visibility", "none"); } catch { }
      }

      // Tonjolkan rel dan kereta aktif
      if (map.getLayer(LAYER.railGlow)) {
        try {
          map.setLayoutProperty(LAYER.railGlow, "visibility", "visible");
          map.setPaintProperty(LAYER.railGlow, "line-opacity", 0.65);
        } catch { }
      }
      if (map.getLayer(LAYER.railCasing)) {
        try {
          map.setLayoutProperty(LAYER.railCasing, "visibility", "visible");
          map.setPaintProperty(LAYER.railCasing, "line-opacity", 0.85);
        } catch { }
      }
      if (map.getLayer(LAYER.railLine)) {
        try {
          map.setLayoutProperty(LAYER.railLine, "visibility", "visible");
          map.setPaintProperty(LAYER.railLine, "line-opacity", 1.0);
        } catch { }
      }
      if (map.getLayer(LAYER.railStations)) {
        try {
          map.setLayoutProperty(LAYER.railStations, "visibility", "visible");
          map.setPaintProperty(LAYER.railStations, "circle-opacity", 1.0);
        } catch { }
      }
      if (map.getLayer(LAYER.railStationsLabel)) {
        try { map.setLayoutProperty(LAYER.railStationsLabel, "visibility", "visible"); } catch { }
      }
      if (map.getLayer(LAYER.railTrains)) {
        try { map.setLayoutProperty(LAYER.railTrains, "visibility", "visible"); } catch { }
      }
      if (map.getLayer(LAYER.railTrainsHeading)) {
        try { map.setLayoutProperty(LAYER.railTrainsHeading, "visibility", "visible"); } catch { }
      }
    }
  }

  function restoreCachedSources() {
    if (!isMapStyleReady()) return;
    Object.values(SOURCE).forEach((sourceId) => {
      const cached = state.cache[sourceId];
      if (Array.isArray(cached) && cached.length > 0) {
        const source = map.getSource(sourceId);
        if (source) source.setData(featureCollection(cached));
      }
    });
  }

  function setSourceData(sourceId, features) {
    state.cache[sourceId] = features;
    if (!isMapStyleReady()) return;
    const source = map.getSource(sourceId);
    if (source) source.setData(featureCollection(features));
  }

  function applyCorridorFilter() {
    if (!map) return;
    const filter =
      state.selectedCorridor === ALL_CORRIDORS
        ? null
        : ["==", ["to-string", ["get", "lineId"]], state.selectedCorridor];

    [LAYER.routesGlow, LAYER.routesCasing, LAYER.routesLine, LAYER.stations].forEach((layerId) => {
      if (map.getLayer(layerId)) map.setFilter(layerId, filter);
    });
  }

  function updatePitchButton() {
    if (!dom.btn3d) return;
    dom.btn3d.classList.toggle("is-active", state.is3D);
    dom.btn3d.setAttribute("aria-pressed", String(state.is3D));
    const textSpan = dom.btn3d.querySelector(".ctrl-text");
    if (textSpan) {
      textSpan.textContent = state.is3D ? "3D" : "2D";
    }
  }

  function togglePitch() {
    state.is3D = !state.is3D;
    updatePitchButton();
    map.easeTo({ pitch: getActivePitch(), duration: 600 });
  }

  function resetNorth() {
    map.easeTo({ bearing: 0, duration: 800 });
  }

  function resetCamera() {
    state.selectedBusId = null;
    state.isFollowingBus = false;
    map.flyTo({
      center: CAMERA.center,
      zoom: CAMERA.zoom,
      pitch: getActivePitch(),
      bearing: 0,
      duration: 1000,
    });
    renderSheetContent();
  }

  function buildStationFeatures(stations) {
    return stations.flatMap((station) => {
      const coordinates = getCoordinates(station);
      if (!coordinates) return [];

      const lineId = getStationLineId(station);
      return [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties: {
            name: station.Stationname || "Halte",
            index: parseInt(station.Stationindex, 10) || 0,
            lineId,
            color: getRouteMeta(lineId).color,
          },
        },
      ];
    });
  }

  async function loadRoutesFeatures() {
    try {
      const data = await fetchJson("./data/routes_geojson.json");
      if (Array.isArray(data?.features) && data.features.length > 0) {
        return data.features;
      }
    } catch {
      try {
        const data = await fetchJson(`${CONFIG.apiBaseUrl}/routes-geojson`);
        if (Array.isArray(data?.features) && data.features.length > 0) {
          return data.features;
        }
      } catch (err) {
        console.warn("[Rute] routes_geojson.json tidak dapat dimuat:", err);
      }
    }
    return null;
  }

  function buildDirectRouteFeatures(stations) {
    const groups = new Map();

    stations.forEach((station) => {
      const coordinates = getCoordinates(station);
      if (!coordinates) return;

      const lineId = getStationLineId(station);
      const groupKey = `${lineId}_${station.Updown || 0}`;

      if (!groups.has(groupKey)) groups.set(groupKey, { lineId, stops: [] });
      groups.get(groupKey).stops.push({
        index: parseInt(station.Stationindex, 10) || 0,
        coordinates,
      });
    });

    const features = [];
    groups.forEach(({ lineId, stops }) => {
      if (stops.length < 2) return;
      stops.sort((a, b) => a.index - b.index);
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: stops.map((s) => s.coordinates) },
        properties: { lineId, color: getRouteMeta(lineId).color },
      });
    });

    return features;
  }

  function buildCctvFeatures(locations) {
    if (!Array.isArray(locations)) return [];
    return locations
      .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lon))
      .map((loc) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [loc.lon, loc.lat],
        },
        properties: {
          id: loc.id,
          name: loc.name || "Persimpangan CCTV",
          description: loc.description || "",
          cameraCount: Array.isArray(loc.cameras) ? loc.cameras.length : 0,
        },
      }));
  }

  async function loadCctvLocations() {
    state.cctvStatus = "loading";
    let data = null;

    try {
      data = await fetchJson(`${CONFIG.apiBaseUrl}/cctv`);
    } catch {
      try {
        data = await fetchJson("./data/cctv_medan.json");
      } catch (error) {
        console.error("[CCTV] Gagal memuat data kamera:", error);
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      state.cctvLocations = data;
      state.cctvStatus = "ready";
      if (dom.cctvBadgeCount) {
        dom.cctvBadgeCount.textContent = String(data.length);
      }
      registerTransitLayers();
      setSourceData(SOURCE.cctv, buildCctvFeatures(state.cctvLocations));
      if (state.activeMode === "cctv") {
        renderBusStat();
        renderSheetContent();
      }
    } else {
      state.cctvStatus = "error";
      if (state.activeMode === "cctv") {
        renderBusStat();
        renderSheetContent();
      }
    }
  }

  async function loadStations() {
    let stations = null;

    try {
      stations = await fetchJson(`${CONFIG.apiBaseUrl}/stations`);
    } catch {
      try {
        stations = await fetchJson("./data/stations.json");
      } catch {
        try {
          stations = await fetchJson(`${CONFIG.directApiBaseUrl}/all-stations`);
        } catch (error) {
          console.error("[Halte] Gagal memuat metadata rute:", error);
          showToast("Gagal memuat rute transit. Periksa koneksi.", "error");
        }
      }
    }

    if (Array.isArray(stations) && stations.length > 0) {
      state.stations = stations;
      registerTransitLayers();
      setSourceData(SOURCE.stations, buildStationFeatures(state.stations));
      if (state.userCoords) updateNearestStop();
      renderSheetContent();

      let routes = await loadRoutesFeatures();
      if (!routes || routes.length === 0) {
        routes = buildDirectRouteFeatures(state.stations);
      }
      setSourceData(SOURCE.routes, routes);
      applyCorridorFilter();
    }
  }

  function buildTrainStationFeatures(stations) {
    return stations.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        code: s.code,
        name: s.name,
        short_name: s.short_name,
        city: s.city,
        type: s.type,
      },
    }));
  }

  async function loadRailinkData() {
    let stations = null;
    let schedule = null;
    let corridor = null;

    try {
      stations = await fetchJson(`${CONFIG.apiBaseUrl}/railink-stations`);
    } catch {
      try {
        stations = await fetchJson("./data/railink_stations.json");
      } catch (err) {
        console.warn("[Railink] Gagal memuat data stasiun:", err);
      }
    }

    try {
      schedule = await fetchJson(`${CONFIG.apiBaseUrl}/railink-schedule`);
    } catch {
      try {
        schedule = await fetchJson("./data/railink_schedule.json");
      } catch (err) {
        console.warn("[Railink] Gagal memuat jadwal:", err);
      }
    }

    try {
      corridor = await fetchJson(`${CONFIG.apiBaseUrl}/railink-corridor`);
    } catch {
      try {
        corridor = await fetchJson("./data/railink_corridor.geojson");
      } catch (err) {
        console.warn("[Railink] Gagal memuat geometri rel:", err);
      }
    }

    if (Array.isArray(stations)) {
      state.trainStations = stations;
    }
    if (schedule && Array.isArray(schedule.trips)) {
      state.trainSchedule = schedule;
    }
    if (corridor?.features?.[0]?.geometry?.coordinates) {
      state.trainCorridorGeojson = corridor;
      state.trainCorridorCoords = corridor.features[0].geometry.coordinates;
    }

    registerTransitLayers();
    if (state.trainCorridorGeojson) {
      setSourceData(SOURCE.railCorridor, state.trainCorridorGeojson.features);
    }
    if (state.trainStations.length > 0) {
      setSourceData(SOURCE.railStations, buildTrainStationFeatures(state.trainStations));
    }

    updateTrainPositions();
    if (state.activeMode === "bus" && state.transitSubmode === "train") {
      renderBusStat();
      renderSheetContent();
    }
  }

  function scheduleNextPoll() {
    clearTimeout(poller.timerId);
    if (!document.hidden) {
      poller.timerId = setTimeout(pollBusPositions, CONFIG.pollIntervalMs);
    }
  }

  async function fetchLiveBuses() {
    try {
      const data = await fetchJson(`${CONFIG.apiBaseUrl}/live-buses`);
      return Array.isArray(data) ? data : data?.Cars ?? [];
    } catch {
      try {
        const data = await fetchJson(`${CONFIG.directApiBaseUrl}/all-bus-location`);
        return Array.isArray(data) ? data : data?.Cars ?? [];
      } catch {
        try {
          const data = await fetchJson("./data/sample_buses.json");
          return Array.isArray(data) ? data : data?.Cars ?? [];
        } catch {
          return [];
        }
      }
    }
  }

  async function pollBusPositions() {
    if (poller.inFlight) return;
    poller.inFlight = true;
    clearTimeout(poller.timerId);

    try {
      const cars = await fetchLiveBuses();
      if (cars && cars.length > 0) {
        state.buses = cars;
        state.busStatus = "ready";
        handleBusUpdate();
      } else if (state.buses.length === 0) {
        state.busStatus = "error";
        renderBusStat();
        renderSheetContent();
      }
    } catch (error) {
      console.error("[Armada] Polling error:", error);
      state.busStatus = "error";
      renderBusStat();
      if (state.buses.length === 0) renderSheetContent();
    } finally {
      poller.inFlight = false;
      scheduleNextPoll();
    }
  }

  function handleBusUpdate() {
    registerTransitLayers();
    updateTweenTargets(performance.now());
    restartAnimation();
    renderBusStat();
    renderSheetContent();
  }

  function updateTweenTargets(now) {
    state.buses.forEach((bus) => {
      const coordinates = getCoordinates(bus);
      if (!coordinates) return;

      const busId = getBusId(bus);
      const [targetLng, targetLat] = coordinates;
      const current = tween.states.get(busId);

      const teleDirection = toNumber(bus.Direction, -1);
      let targetBearing = teleDirection >= 0 && teleDirection <= 360 ? teleDirection : null;

      if (!current) {
        if (targetBearing == null) targetBearing = 0;
        tween.states.set(busId, {
          startLng: targetLng,
          startLat: targetLat,
          currentLng: targetLng,
          currentLat: targetLat,
          targetLng,
          targetLat,
          startBearing: targetBearing,
          targetBearing,
          bearing: targetBearing,
          startTime: now,
          duration: CONFIG.tweenDurationMs,
        });
        return;
      }

      const hasMoved =
        Math.abs(targetLng - current.currentLng) > 0.00002 ||
        Math.abs(targetLat - current.currentLat) > 0.00002;

      if (hasMoved) {
        const pathBearing = computeBearing(current.currentLng, current.currentLat, targetLng, targetLat);
        if (targetBearing == null || targetBearing === 0) {
          targetBearing = pathBearing;
        }
      } else if (targetBearing == null) {
        targetBearing = current.bearing || 0;
      }

      current.startLng = current.currentLng;
      current.startLat = current.currentLat;
      current.targetLng = targetLng;
      current.targetLat = targetLat;
      current.startBearing = current.bearing ?? targetBearing;
      current.targetBearing = targetBearing;
      current.startTime = now;
      current.duration = CONFIG.tweenDurationMs;
    });

    const activeBusIds = new Set(state.buses.map(getBusId));
    for (const cachedId of tween.states.keys()) {
      if (!activeBusIds.has(cachedId)) tween.states.delete(cachedId);
    }
  }

  function restartAnimation() {
    if (tween.frameId !== null) return;
    tween.frameId = requestAnimationFrame(animateBuses);
  }

  function animateBuses(currentTime) {
    let isAnimating = false;
    const features = [];
    const visibleIds = new Set(getVisibleBuses().map(getBusId));

    for (const [busId, position] of tween.states.entries()) {
      const elapsed = currentTime - position.startTime;
      const progress = clamp(elapsed / position.duration, 0, 1);

      position.currentLng = lerp(position.startLng, position.targetLng, progress);
      position.currentLat = lerp(position.startLat, position.targetLat, progress);

      const bearing = Math.round(
        lerpAngle(
          position.startBearing ?? position.bearing ?? 0,
          position.targetBearing ?? position.bearing ?? 0,
          progress
        )
      );
      position.bearing = bearing;

      if (progress < 1) isAnimating = true;

      const bus = findBusById(busId);
      if (!bus || !visibleIds.has(busId)) continue;

      const speedStatus = getSpeedStatus(bus.Speed);
      const speed = toNumber(bus.Speed, 0);

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [position.currentLng, position.currentLat] },
        properties: {
          carNo: busId,
          color: getRouteMeta(getBusRouteId(bus)).color,
          speedColor: speedStatus.color,
          speed,
          bearing,
        },
      });

      if (state.isFollowingBus && state.selectedBusId === busId) {
        map.setCenter([position.currentLng, position.currentLat]);
      }
    }

    setSourceData(SOURCE.buses, features);

    if (isAnimating) {
      tween.frameId = requestAnimationFrame(animateBuses);
    } else {
      tween.frameId = null;
    }
  }

  function getBusPosition(bus) {
    const position = tween.states.get(getBusId(bus));
    return position ? [position.currentLng, position.currentLat] : getCoordinates(bus);
  }

  function findNearestStop({ lat, lng }) {
    let nearest = null;

    state.stations.forEach((station) => {
      const coordinates = getCoordinates(station);
      if (!coordinates) return;

      const distanceKm = haversineKm(lat, lng, coordinates[1], coordinates[0]);
      if (!nearest || distanceKm < nearest.distanceKm) {
        nearest = { station, coordinates, distanceKm };
      }
    });

    return nearest;
  }

  function updateNearestStop() {
    state.nearestStop = state.userCoords ? findNearestStop(state.userCoords) : null;
  }

  function findIncomingBus(stationName) {
    const target = String(stationName || "").trim().toLowerCase();
    if (!target) return null;

    let best = null;
    state.buses.forEach((bus) => {
      const stop = (bus.Stations || []).find(
        (item) => String(item.Stationname || "").trim().toLowerCase() === target,
      );
      if (!stop) return;

      const etaMinutes = toNumber(stop.Estimated, 999);
      if (!best || etaMinutes < best.etaMinutes) {
        best = { carNo: bus.CarNo, etaMinutes };
      }
    });

    return best && { carNo: best.carNo, etaMinutes: formatEtaMinutes(best.etaMinutes) };
  }

  function createUserMarkerElement() {
    const element = document.createElement("div");
    element.className = "user-gps-wrap";
    element.setAttribute("aria-label", "Lokasi Anda");
    element.innerHTML = '<span class="user-gps-pulse"></span><span class="user-gps-dot"></span>';
    return element;
  }

  function placeUserMarker(lngLat) {
    if (state.userMarker) {
      state.userMarker.setLngLat(lngLat);
      return;
    }
    state.userMarker = new maplibregl.Marker({ element: createUserMarkerElement(), anchor: "center" })
      .setLngLat(lngLat)
      .addTo(map);
  }

  function setGpsBusy(isBusy) {
    dom.btnGps.classList.toggle("is-active", isBusy);
    dom.btnGps.setAttribute("aria-busy", String(isBusy));
  }

  function locateUser() {
    if (!("geolocation" in navigator)) {
      showToast("Browser Anda belum mendukung fitur GPS.", "error");
      return;
    }

    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(handlePositionSuccess, handlePositionError, {
      enableHighAccuracy: true,
      timeout: CONFIG.geolocationTimeoutMs,
      maximumAge: 15000,
    });
  }

  function handlePositionSuccess({ coords }) {
    setGpsBusy(false);

    const { latitude, longitude } = coords;
    state.userCoords = { lat: latitude, lng: longitude };
    state.selectedBusId = null;
    state.isFollowingBus = false;

    placeUserMarker([longitude, latitude]);
    updateNearestStop();

    map.flyTo({
      center: [longitude, latitude],
      zoom: CAMERA.userZoom,
      pitch: getActivePitch(),
      padding: getCameraPadding(),
      duration: 1200,
    });

    setSheetExpanded(true);
    renderSheetContent();
    showToast("Lokasi Anda ditemukan.", "info");
  }

  function handlePositionError(error) {
    setGpsBusy(false);
    console.warn("[GPS] Gagal membaca lokasi:", error);
    showToast(GEOLOCATION_ERRORS[error.code] ?? "Gagal mencari lokasi. Coba lagi.", "error");
  }

  function renderBusStat() {
    if (state.activeMode === "cctv") {
      if (state.cctvStatus === "loading") {
        dom.busStat.textContent = "Memuat...";
      } else if (state.cctvStatus === "error" && state.cctvLocations.length === 0) {
        dom.busStat.textContent = "Offline";
      } else {
        const count = getVisibleCctvLocations().length;
        dom.busStat.textContent = `${count} ATCS`;
      }
      return;
    }

    if (state.transitSubmode === "train") {
      if (!state.trainSchedule) {
        dom.busStat.textContent = "Memuat...";
      } else if (state.trains.length > 0) {
        dom.busStat.textContent = `${state.trains.length} KA Aktif`;
      } else {
        dom.busStat.textContent = `${state.trainStations.length} Stasiun`;
      }
      return;
    }

    if (state.busStatus === "loading") {
      dom.busStat.textContent = "Memuat...";
    } else if (state.busStatus === "error" && state.buses.length === 0) {
      dom.busStat.textContent = "Offline";
    } else {
      const activeCount = getVisibleBuses().length;
      dom.busStat.textContent = `${activeCount} Armada`;
    }
  }

  function renderCorridorPills() {
    if (state.transitSubmode === "train") {
      const trainFilters = [
        { id: ALL_CORRIDORS, label: "Semua", title: "Semua perjalanan" },
        { id: "to_airport", label: "Ke Bandara KNO", title: "Menuju Bandara Kualanamu" },
        { id: "to_city", label: "Ke Medan", title: "Menuju Stasiun Medan" },
        { id: "to_binjai", label: "Ke Binjai", title: "Menuju Binjai dan Kuala Bingai" },
      ];

      dom.corridorPills.innerHTML = trainFilters
        .map(({ id, label, title }) => {
          const isActive = state.trainDirectionFilter === id;
          return `
            <button type="button" class="pill${isActive ? " is-active" : ""}"
              data-action="filter-train-direction" data-direction="${escapeHtml(id)}"
              title="${escapeHtml(title)}" aria-pressed="${isActive}">
              ${escapeHtml(label)}
            </button>`;
        })
        .join("");
      return;
    }

    const pills = [
      { id: ALL_CORRIDORS, label: "Semua", title: "Semua rute", color: null },
      ...Object.entries(ROUTES).map(([id, meta]) => ({
        id,
        label: meta.code,
        title: meta.name,
        color: meta.color,
      })),
    ];

    dom.corridorPills.innerHTML = pills
      .map(({ id, label, title, color }) => {
        const isActive = state.selectedCorridor === id;
        const dot = color
          ? `<span class="color-dot" style="--dot-color: ${color}" aria-hidden="true"></span>`
          : "";

        return `
          <button type="button" class="pill${isActive ? " is-active" : ""}"
            data-action="filter-corridor" data-corridor="${escapeHtml(id)}"
            title="${escapeHtml(title)}" aria-pressed="${isActive}">
            ${dot}${escapeHtml(label)}
          </button>`;
      })
      .join("");
  }

  function parseTimeToMinutes(str) {
    if (!str) return 0;
    const parts = str.split(":").map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function formatMinutesToTime(totalMins) {
    const mins = Math.round(totalMins) % (24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function getCurrentWibMinutes() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const wib = new Date(utcMs + 7 * 3600000);
    return wib.getHours() * 60 + wib.getMinutes() + wib.getSeconds() / 60;
  }

  function calculateActiveTrains() {
    if (!state.trainSchedule?.trips || !state.trainCorridorCoords || state.trainCorridorCoords.length === 0) {
      return [];
    }

    const nowMins = getCurrentWibMinutes();
    const stationMap = new Map(state.trainStations.map((s) => [s.code, s]));
    const active = [];

    state.trainSchedule.trips.forEach((trip) => {
      const stops = trip.stops || [];
      if (stops.length < 2) return;

      const firstDep = parseTimeToMinutes(stops[0].dep);
      const lastArr = parseTimeToMinutes(stops[stops.length - 1].arr);

      if (nowMins >= firstDep && nowMins <= lastArr) {
        let currentLeg = null;
        let isDwelling = false;
        let dwellingStation = null;

        for (let i = 0; i < stops.length - 1; i++) {
          const stopA = stops[i];
          const stopB = stops[i + 1];
          const arrA = parseTimeToMinutes(stopA.arr);
          const depA = parseTimeToMinutes(stopA.dep);
          const arrB = parseTimeToMinutes(stopB.arr);

          if (nowMins >= arrA && nowMins < depA) {
            isDwelling = true;
            dwellingStation = stationMap.get(stopA.station_code);
            currentLeg = { from: stopA, to: stopB, progress: 0 };
            break;
          }

          if (nowMins >= depA && nowMins <= arrB) {
            const legDuration = Math.max(0.5, arrB - depA);
            const progress = clamp((nowMins - depA) / legDuration, 0, 1);
            currentLeg = { from: stopA, to: stopB, progress };
            break;
          }
        }

        if (!currentLeg) return;

        const stFrom = stationMap.get(currentLeg.from.station_code);
        const stTo = stationMap.get(currentLeg.to.station_code);
        if (!stFrom || !stTo) return;

        let lng = 0;
        let lat = 0;
        let bearing = 0;
        let speed = 0;
        let statusText = "";

        if (isDwelling && dwellingStation) {
          lng = dwellingStation.lon;
          lat = dwellingStation.lat;
          speed = 0;
          bearing = trip.direction === "to_airport" ? 115 : 295;
          statusText = `Singgah di ${dwellingStation.short_name || dwellingStation.name}`;
        } else {
          const idxFrom = stFrom.corridor_index ?? 0;
          const idxTo = stTo.corridor_index ?? 0;
          const currIdx = idxFrom + currentLeg.progress * (idxTo - idxFrom);

          const i0 = clamp(Math.floor(currIdx), 0, state.trainCorridorCoords.length - 1);
          const i1 = clamp(Math.ceil(currIdx), 0, state.trainCorridorCoords.length - 1);
          const frac = currIdx - Math.floor(currIdx);

          const p0 = state.trainCorridorCoords[i0];
          const p1 = state.trainCorridorCoords[i1];

          lng = lerp(p0[0], p1[0], frac);
          lat = lerp(p0[1], p1[1], frac);

          if (idxTo >= idxFrom) {
            bearing = computeBearing(p0[0], p0[1], p1[0], p1[1]);
          } else {
            bearing = computeBearing(p1[0], p1[1], p0[0], p0[1]);
          }

          const baseSpeed = trip.service === "airport" ? 72 : 64;
          const speedVar = (Math.sin(nowMins * 10) + 1) * 3;
          speed = Math.round(baseSpeed + speedVar);

          const arrMinNext = parseTimeToMinutes(currentLeg.to.arr);
          const minsToNext = Math.max(0, Math.ceil(arrMinNext - nowMins));
          statusText = `Menuju ${currentLeg.to.station_name} (${minsToNext} mnt)`;
        }

        active.push({
          ...trip,
          lng,
          lat,
          bearing,
          speed,
          statusText,
          currentLeg,
          isDwelling,
          progressPercent: Math.round(((nowMins - firstDep) / Math.max(1, lastArr - firstDep)) * 100),
        });
      }
    });

    return active;
  }

  function getNextUpcomingTrip() {
    if (!state.trainSchedule?.trips) return null;
    const nowMins = getCurrentWibMinutes();
    const sorted = [...state.trainSchedule.trips].sort((a, b) => {
      return parseTimeToMinutes(a.departure_time) - parseTimeToMinutes(b.departure_time);
    });

    const upcoming = sorted.find((t) => parseTimeToMinutes(t.departure_time) > nowMins);
    return upcoming || sorted[0];
  }

  function updateTrainPositions() {
    state.trains = calculateActiveTrains();

    const features = state.trains.map((train) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [train.lng, train.lat] },
      properties: {
        trip_id: train.trip_id,
        train_name: train.train_name,
        service: train.service,
        color: train.service === "airport" ? "#009aa6" : "#2563eb",
        bearing: train.bearing,
        speed: train.speed,
        statusText: train.statusText,
        origin: train.origin_name,
        destination: train.destination_name,
      },
    }));

    setSourceData(SOURCE.railTrains, features);

    if (state.isFollowingTrain && state.selectedTrainId && map) {
      const train = state.trains.find((t) => t.trip_id === state.selectedTrainId);
      if (train) {
        map.setCenter([train.lng, train.lat]);
      }
    }

    if (state.activeMode === "bus" && state.transitSubmode === "train") {
      renderBusStat();
      if (!state.selectedTrainStation) {
        renderSheetContent();
      }
    }
  }

  function getVisibleTrains() {
    let list = state.trains;
    if (state.trainDirectionFilter !== ALL_CORRIDORS) {
      list = list.filter((t) => t.direction === state.trainDirectionFilter);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter((t) => {
        const id = (t.trip_id || "").toLowerCase();
        const name = (t.train_name || "").toLowerCase();
        const dest = (t.destination_name || "").toLowerCase();
        const orig = (t.origin_name || "").toLowerCase();
        return id.includes(q) || name.includes(q) || dest.includes(q) || orig.includes(q);
      });
    }
    return list;
  }

  function setTransitSubmode(submode) {
    if (state.transitSubmode === submode) return;
    state.transitSubmode = submode;

    dom.btnSubmodeBus?.classList.toggle("is-active", submode === "bus");
    dom.btnSubmodeBus?.setAttribute("aria-checked", String(submode === "bus"));
    dom.btnSubmodeTrain?.classList.toggle("is-active", submode === "train");
    dom.btnSubmodeTrain?.setAttribute("aria-checked", String(submode === "train"));

    state.selectedBusId = null;
    state.isFollowingBus = false;
    state.selectedStation = null;
    state.selectedTrainId = null;
    state.isFollowingTrain = false;
    state.selectedTrainStation = null;
    closeDetailView();

    if (dom.searchInput) {
      dom.searchInput.placeholder = submode === "train"
        ? "Cari kereta, rute, atau stasiun..."
        : "Cari rute, halte, atau stasiun...";
    }

    renderCorridorPills();
    renderBusStat();
    renderSheetContent();
    updateLayerVisibility();

    if (submode === "train" && map) {
      map.flyTo({
        center: [98.74, 3.61],
        zoom: 11.2,
        duration: 900,
      });
    }
  }

  function filterTrainDirection(direction) {
    state.trainDirectionFilter = direction;
    renderCorridorPills();
    renderSheetContent();
  }

  function selectTrain(tripId) {
    const train = state.trains.find((t) => t.trip_id === tripId) ||
      state.trainSchedule?.trips?.find((t) => t.trip_id === tripId);
    if (!train) return;

    state.selectedTrainId = tripId;
    state.selectedTrainStation = null;
    state.isFollowingTrain = false;

    openDetailView();
    renderSheetContent();

    if (train.lng && train.lat && map) {
      map.flyTo({
        center: [train.lng, train.lat],
        zoom: 13.5,
        duration: 800,
      });
    }
  }

  function closeTrainDetail() {
    state.selectedTrainId = null;
    state.isFollowingTrain = false;
    closeDetailView();
    renderSheetContent();
  }

  function toggleFollowTrain() {
    state.isFollowingTrain = !state.isFollowingTrain;
    renderSheetContent();
  }

  function flyToTrain(tripId) {
    const train = state.trains.find((t) => t.trip_id === tripId);
    if (!train || !map) return;
    map.flyTo({
      center: [train.lng, train.lat],
      zoom: 14,
      duration: 800,
    });
  }

  function selectTrainStation(stationCode) {
    const station = state.trainStations.find((s) => s.code === stationCode);
    if (!station) return;

    state.selectedTrainStation = station;
    state.selectedTrainId = null;
    state.isFollowingTrain = false;

    openDetailView();
    renderSheetContent();

    if (map) {
      map.flyTo({
        center: [station.lon, station.lat],
        zoom: 14.5,
        duration: 800,
      });
    }
  }

  function closeTrainStationDetail() {
    state.selectedTrainStation = null;
    closeDetailView();
    renderSheetContent();
  }

  function flyToTrainStation(stationCode) {
    const station = state.trainStations.find((s) => s.code === stationCode);
    if (!station || !map) return;
    map.flyTo({
      center: [station.lon, station.lat],
      zoom: 15,
      duration: 700,
    });
  }

  function renderTrainOverview() {
    const activeTrains = getVisibleTrains();
    const nextTrip = getNextUpcomingTrip();
    const nowMins = getCurrentWibMinutes();

    let nextCountdownHtml = "";
    if (nextTrip) {
      const depMins = parseTimeToMinutes(nextTrip.departure_time);
      let diff = depMins - nowMins;
      if (diff < 0) diff += 24 * 60;
      const hours = Math.floor(diff / 60);
      const mins = Math.round(diff % 60);
      const timeRemaining = hours > 0 ? `${hours} jam ${mins} mnt` : `${mins} mnt lagi`;

      nextCountdownHtml = `
        <div class="train-next-banner">
          <div class="train-next-banner-header">
            <span class="train-next-title">Keberangkatan Berikutnya</span>
            <span class="train-next-countdown tabular-num">${escapeHtml(timeRemaining)}</span>
          </div>
          <div class="train-route-flow">
            <span>${escapeHtml(nextTrip.origin_name)}</span>
            <span class="train-arrow">&rarr;</span>
            <span>${escapeHtml(nextTrip.destination_name)}</span>
            <span class="tabular-num text-muted" style="margin-left:auto">${escapeHtml(nextTrip.departure_time)} WIB</span>
          </div>
        </div>`;
    }

    const noticeHtml = `
      <div class="train-notice-box" role="note">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <strong>Estimasi Jadwal:</strong> Posisi kereta dihitung secara real-time mengikuti jadwal resmi Railink.
        </div>
      </div>`;

    let activeTrainsHtml = "";
    if (activeTrains.length > 0) {
      activeTrainsHtml = `
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Kereta di Lintasan (${activeTrains.length})</div>
          <ul class="bus-list" style="margin:0;padding:0;list-style:none">
            ${activeTrains.map(renderTrainCard).join("")}
          </ul>
        </div>`;
    } else {
      activeTrainsHtml = `
        <p class="empty-state">Tidak ada kereta di lintasan saat ini. Cek jadwal per stasiun di bawah ini.</p>`;
    }

    let visibleStations = state.trainStations;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      visibleStations = visibleStations.filter((s) => {
        const name = (s.name || "").toLowerCase();
        const code = (s.code || "").toLowerCase();
        const city = (s.city || "").toLowerCase();
        return name.includes(q) || code.includes(q) || city.includes(q);
      });
    }

    const stationsListHtml = `
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Stasiun &amp; Jadwal</span>
          <a href="https://reservation.railink.co.id/" target="_blank" rel="noopener" class="text-muted" style="font-size:11.5px">Pesan Tiket &rarr;</a>
        </div>
        <ul style="display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none">
          ${visibleStations.length > 0
        ? visibleStations.map(renderTrainStationCard).join("")
        : '<li class="empty-state" style="padding:12px">Tidak ada stasiun yang cocok</li>'}
        </ul>
      </div>`;

    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${noticeHtml}
        ${nextCountdownHtml}
        ${activeTrainsHtml}
        ${stationsListHtml}
      </div>`;
  }

  function renderTrainCard(train) {
    const isAirport = train.service === "airport";
    const badgeClass = isAirport ? "train-badge" : "train-badge train-badge--commuter";
    const serviceLabel = isAirport ? "KA Bandara" : "Sri Lelawangsa";

    return `
      <li>
        <button type="button" class="item-card train-card" data-action="select-train" data-trip-id="${escapeHtml(train.trip_id)}">
          <div class="bus-card-top">
            <div class="bus-card-identity">
              <span class="${badgeClass}">${escapeHtml(train.trip_id)}</span>
              <span class="item-title">${escapeHtml(serviceLabel)}</span>
            </div>
            <span class="virtual-tag tabular-num" title="Perkiraan posisi berdasarkan jam resmi">
              <span class="status-dot" style="background-color:#38bdf8" aria-hidden="true"></span>
              <span>Estimasi</span>
            </span>
          </div>
          <div class="train-route-flow">
            <span>${escapeHtml(train.origin_name)}</span>
            <span class="train-arrow">&rarr;</span>
            <span>${escapeHtml(train.destination_name)}</span>
          </div>
          <div class="train-status-row">
            <span>${escapeHtml(train.statusText)}</span>
            <span class="tabular-num">${escapeHtml(train.speed)} km/j</span>
          </div>
        </button>
      </li>`;
  }

  function renderTrainStationCard(station) {
    const fareKnm = station.fares?.KNM ? `Rp${station.fares.KNM.toLocaleString("id-ID")}` : null;
    const fareMdn = station.fares?.MDN ? `Rp${station.fares.MDN.toLocaleString("id-ID")}` : null;
    const fareText = fareKnm ? `Ke Bandara: ${fareKnm}` : (fareMdn ? `Ke Medan: ${fareMdn}` : "");

    return `
      <li>
        <button type="button" class="item-card train-card" style="padding:9px 11px" data-action="select-train-station" data-station-code="${escapeHtml(station.code)}">
          <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
            <div style="display:flex;align-items:center;gap:7px">
              <span class="train-badge" style="background-color:var(--surface-hover);color:var(--text);border:1px solid var(--glass-border)">${escapeHtml(station.code)}</span>
              <span style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(station.name)}</span>
            </div>
            ${fareText ? `<span class="fare-badge">${escapeHtml(fareText)}</span>` : ""}
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);display:flex;align-items:center;justify-content:space-between;width:100%">
            <span>${escapeHtml(station.city)}</span>
            <span style="color:var(--accent)">Lihat Jadwal &rarr;</span>
          </div>
        </button>
      </li>`;
  }

  function renderTrainDetail(train) {
    const isAirport = train.service === "airport";
    const badgeClass = isAirport ? "train-badge" : "train-badge train-badge--commuter";
    const serviceLabel = isAirport ? "KA Bandara Kualanamu" : "KA Sri Lelawangsa";
    const stops = train.stops || [];

    const stopsTimeline = stops.map((stop, i) => {
      const isOrigin = i === 0;
      const isDest = i === stops.length - 1;
      const timeStr = `${stop.arr || stop.dep} WIB`;

      return `
        <div style="display:flex;align-items:flex-start;gap:10px;position:relative;padding-bottom:12px">
          <div style="display:flex;flex-direction:column;align-items:center;width:16px">
            <span style="width:10px;height:10px;border-radius:50%;background-color:${isDest ? 'var(--status-smooth)' : (isOrigin ? 'var(--accent)' : 'var(--text-muted)')};margin-top:3px"></span>
            ${!isDest ? '<span style="width:2px;height:24px;background-color:var(--rule);margin-top:2px"></span>' : ''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(stop.station_name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(timeStr)}</div>
          </div>
        </div>`;
    }).join("");

    return `
      <div class="detail-view">
        <header class="detail-header">
          <div class="detail-info">
            <div class="detail-title-row">
              <span class="${badgeClass}">${escapeHtml(train.trip_id)}</span>
              <span class="detail-title">${escapeHtml(serviceLabel)}</span>
            </div>
            <div class="detail-subtitle">${escapeHtml(train.direction_label)}</div>
          </div>
          <button type="button" class="btn-action btn-action--close" data-action="close-train-detail" aria-label="Tutup detail">
            &times;
          </button>
        </header>

        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" class="btn-action ${state.isFollowingTrain ? 'is-active' : ''}" style="flex:1" data-action="toggle-follow-train">
            ${state.isFollowingTrain ? 'Berhenti Mengikuti' : 'Lacak di Peta'}
          </button>
          <button type="button" class="btn-action" data-action="fly-to-train" data-trip-id="${escapeHtml(train.trip_id)}">
            Fokus Peta
          </button>
        </div>

        <div class="train-notice-box">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div><strong>Status:</strong> ${escapeHtml(train.statusText)} &bull; Kecepatan ~${escapeHtml(train.speed)} km/j</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Rute Perjalanan &amp; Waktu Singgah</div>
          <div style="padding:10px;background-color:var(--surface-subtle);border:1px solid var(--glass-border);border-radius:var(--radius-panel)">
            ${stopsTimeline}
          </div>
        </div>

        <a href="https://reservation.railink.co.id/" target="_blank" rel="noopener" class="btn-booking">
          Pesan Tiket Resmi di Railink
        </a>
      </div>`;
  }

  function renderTrainStationDetail(station) {
    const allTrips = state.trainSchedule?.trips || [];
    const nowMins = getCurrentWibMinutes();

    const stationTrips = [];
    allTrips.forEach((trip) => {
      const stop = trip.stops?.find((s) => s.station_code === station.code);
      if (stop) {
        const depMin = parseTimeToMinutes(stop.dep);
        stationTrips.push({
          tripId: trip.trip_id,
          trainName: trip.train_name,
          service: trip.service,
          depTime: stop.dep,
          depMin,
          destination: trip.destination_name,
          direction: trip.direction,
        });
      }
    });

    stationTrips.sort((a, b) => a.depMin - b.depMin);

    const facilitiesHtml = (station.facilities || []).map((f) => `
      <span class="facility-pill">${escapeHtml(f)}</span>
    `).join("");

    const faresList = Object.entries(station.fares || {}).map(([destCode, fare]) => {
      const destStation = state.trainStations.find((s) => s.code === destCode);
      const destName = destStation ? destStation.short_name : destCode;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:3px 0">
          <span style="color:var(--text)">Ke ${escapeHtml(destName)}</span>
          <span class="tabular-num" style="color:var(--status-smooth);font-weight:600">Rp${fare.toLocaleString("id-ID")}</span>
        </div>`;
    }).join("");

    const timetableRows = stationTrips.map((t) => {
      let isNext = false;
      const diff = t.depMin - nowMins;
      let countdown = "";
      if (diff >= 0 && diff <= 120) {
        isNext = true;
        countdown = `<span style="color:var(--status-smooth);font-size:11px;font-weight:600">${Math.round(diff)} mnt lagi</span>`;
      }

      return `
        <div class="timetable-row ${isNext ? 'is-next' : ''}">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="train-badge" style="font-size:10px;padding:1px 5px">${escapeHtml(t.tripId)}</span>
            <span>${escapeHtml(t.destination)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${countdown}
            <span class="tabular-num" style="font-weight:600">${escapeHtml(t.depTime)} WIB</span>
          </div>
        </div>`;
    }).join("");

    return `
      <div class="detail-view">
        <header class="detail-header">
          <div class="detail-info">
            <div class="detail-title-row">
              <span class="train-badge">${escapeHtml(station.code)}</span>
              <span class="detail-title">${escapeHtml(station.name)}</span>
            </div>
            <div class="detail-subtitle">${escapeHtml(station.city)} &bull; ${escapeHtml(station.address)}</div>
          </div>
          <button type="button" class="btn-action btn-action--close" data-action="close-train-station" aria-label="Tutup detail stasiun">
            &times;
          </button>
        </header>

        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" class="btn-action" style="flex:1" data-action="fly-to-train-station" data-station-code="${escapeHtml(station.code)}">
            Fokus ke Stasiun
          </button>
          <a href="https://reservation.railink.co.id/" target="_blank" rel="noopener" class="btn-action" style="text-decoration:none!important">
            Pesan Tiket
          </a>
        </div>

        ${station.facilities?.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${facilitiesHtml}
          </div>` : ''}

        ${faresList ? `
          <div style="display:flex;flex-direction:column;gap:5px;padding:9px 11px;background-color:var(--surface-subtle);border:1px solid var(--glass-border);border-radius:var(--radius-panel)">
            <span style="font-size:11.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Tarif Tiket Resmi</span>
            ${faresList}
          </div>` : ''}

        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Jadwal Keberangkatan Hari Ini</span>
            <span style="font-size:11px;color:var(--text-dim)">${stationTrips.length} Perjalanan</span>
          </div>
          <div class="train-timetable-wrap">
            ${timetableRows}
          </div>
        </div>
      </div>`;
  }

  function renderSheetContent() {
    if (state.activeMode === "cctv") {
      if (state.selectedCctvId) {
        const loc = state.cctvLocations.find((item) => String(item.id) === String(state.selectedCctvId));
        if (loc) {
          dom.sheetContent.innerHTML = renderCctvDetail(loc);
          initCctvPlayback();
          return;
        }
        state.selectedCctvId = null;
      }
      dom.sheetContent.innerHTML = renderCctvOverview();
      return;
    }

    if (state.transitSubmode === "train") {
      if (state.selectedTrainId) {
        const train = state.trains.find((t) => t.trip_id === state.selectedTrainId);
        if (train) {
          dom.sheetContent.innerHTML = renderTrainDetail(train);
          return;
        }
        state.selectedTrainId = null;
        state.isFollowingTrain = false;
      }

      if (state.selectedTrainStation) {
        dom.sheetContent.innerHTML = renderTrainStationDetail(state.selectedTrainStation);
        return;
      }

      dom.sheetContent.innerHTML = renderTrainOverview();
      return;
    }

    const selectedBus = state.selectedBusId ? findBusById(state.selectedBusId) : null;

    if (state.selectedBusId && !selectedBus) {
      state.selectedBusId = null;
      state.isFollowingBus = false;
    }

    if (selectedBus) {
      dom.sheetContent.innerHTML = renderBusDetail(selectedBus);
    } else if (state.selectedStation) {
      dom.sheetContent.innerHTML = renderStationDetail(state.selectedStation);
    } else {
      dom.sheetContent.innerHTML = renderOverview();
    }
  }

  function renderOverview() {
    const nearestStopHtml = renderNearestStopCard();

    if (state.busStatus === "loading") {
      return `${nearestStopHtml}<div class="loading-state"><p>Memuat data bus...</p></div>`;
    }

    const buses = getVisibleBuses();

    if (buses.length > 0) {
      return `${nearestStopHtml}<ul class="bus-list">${buses.map(renderBusCard).join("")}</ul>`;
    }

    if (state.busStatus === "error") {
      return `${nearestStopHtml}<p class="empty-state empty-state--error">Gagal mengambil data bus. Mencoba lagi...</p>`;
    }

    return `${nearestStopHtml}<p class="empty-state">Tidak ada bus yang sesuai dengan pilihan atau pencarian Anda.</p>`;
  }

  function renderBusCard(bus) {
    const meta = getRouteMeta(getBusRouteId(bus));
    const status = getSpeedStatus(bus.Speed);
    const nextStop = bus.Stations?.[0]?.Stationname || "Halte Tujuan";
    const statusStyle = `--status-color: ${status.color}; --status-bg: ${status.bg}`;

    return `
      <li>
        <button type="button" class="item-card bus-card" data-action="select-bus" data-car-no="${escapeHtml(bus.CarNo)}">
          <div class="bus-card-top">
            <div class="bus-card-identity">
              <span class="route-badge" style="--route-color: ${meta.color}">${escapeHtml(meta.code)}</span>
              <span class="item-title">${escapeHtml(bus.CarNo)}</span>
            </div>
            <span class="speed-tag tabular-num" style="${statusStyle}" title="${escapeHtml(status.label)}">
              <span class="status-dot" aria-hidden="true"></span>
              <span>${formatSpeed(bus.Speed)}</span><span class="speed-unit">km/j</span>
            </span>
          </div>
          <div class="bus-card-dest">
            Menuju <span class="dest-name">${escapeHtml(nextStop)}</span>
          </div>
        </button>
      </li>`;
  }

  function renderBusDetail(bus) {
    const meta = getRouteMeta(getBusRouteId(bus));
    const speedStatus = getSpeedStatus(bus.Speed);
    const statusStyle = `--status-color: ${speedStatus.color}; --status-bg: ${speedStatus.bg}`;
    const stops = bus.Stations || [];
    const nextStop = stops[0]?.Stationname || "Terminal Akhir";
    const speed = formatSpeed(bus.Speed);

    const stopsListHtml = stops.length > 0
      ? stops.map((stop, index) => {
        const eta = formatEtaMinutes(stop.Estimated);
        const distance = stop.distance ? `${toNumber(stop.distance).toFixed(1)} km` : "Tujuan";
        return `
            <li class="timeline-item ${index === 0 ? "is-next" : ""}">
              <div class="timeline-track">
                <span class="timeline-node" style="--route-color: ${meta.color}"></span>
                ${index < stops.length - 1 ? '<span class="timeline-line"></span>' : ""}
              </div>
              <div class="timeline-body">
                <div class="timeline-title">${escapeHtml(stop.Stationname || "Halte")}</div>
                <div class="timeline-meta">
                  <span>${distance}</span>
                  <span class="timeline-eta tabular-num">~${eta} mnt</span>
                </div>
              </div>
            </li>`;
      }).join("")
      : '<p class="empty-state">Belum ada data halte berikutnya.</p>';

    const followText = state.isFollowingBus ? "Lepas" : "Ikuti 3D";
    const followClass = state.isFollowingBus ? "btn-action is-active" : "btn-action";

    return `
      <div class="detail-view">
        <div class="detail-header">
          <div class="detail-info">
            <div class="detail-title-row">
              <h2 class="detail-title tabular-num">${escapeHtml(bus.CarNo)}</h2>
              <span class="route-badge" style="--route-color: ${meta.color}">${escapeHtml(meta.code)}</span>
            </div>
            <p class="detail-subtitle">${escapeHtml(meta.name)} &bull; Menuju ${escapeHtml(nextStop)}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="${followClass}" data-action="toggle-follow" title="Ikuti bus di peta">${followText}</button>
            <button type="button" class="btn-action btn-action--close" data-action="close-detail" title="Tutup detail">Tutup</button>
          </div>
        </div>

        <div class="telemetry-strip">
          <span class="telemetry-inline-item">
            <span class="status-dot" style="background-color: ${speedStatus.color}" aria-hidden="true"></span>
            <strong style="color: ${speedStatus.color}">${escapeHtml(speedStatus.label)}</strong>
          </span>
          <span class="speed-tag tabular-num" style="${statusStyle}">
            <span>${speed}</span><span class="speed-unit">km/j</span>
          </span>
        </div>

        <div class="timeline-section">
          <h3 class="section-title">Halte Berikutnya (${stops.length})</h3>
          <ul class="timeline-list">
            ${stopsListHtml}
          </ul>
        </div>
      </div>
    `;
  }

  function renderStationDetail(station) {
    const lineId = getStationLineId(station);
    const meta = getRouteMeta(lineId);
    const incomingBus = findIncomingBus(station.name);

    const incomingHtml = incomingBus
      ? `<div class="smart-gps-card">
           <div class="smart-card-top">
             <h3 class="smart-stop-name">Bus ${escapeHtml(incomingBus.carNo)}</h3>
             <span class="text-success tabular-num">Tiba ~${incomingBus.etaMinutes} mnt lagi</span>
           </div>
           <div class="smart-card-body">
             <span class="route-badge route-badge--sm" style="--route-color: ${meta.color}">
               ${escapeHtml(meta.code)} &bull; ${escapeHtml(meta.name)}
             </span>
             <button type="button" class="btn-action" data-action="select-bus" data-car-no="${escapeHtml(incomingBus.carNo)}">Lihat Bus</button>
           </div>
         </div>`
      : '<p class="empty-state">Belum ada bus yang mengarah ke halte ini.</p>';

    return `
      <div class="detail-view">
        <div class="detail-header">
          <div class="detail-info">
            <div class="detail-title-row">
              <h2 class="detail-title">${escapeHtml(station.name)}</h2>
              <span class="route-badge" style="--route-color: ${meta.color}">${escapeHtml(meta.code)}</span>
            </div>
            <p class="detail-subtitle">${escapeHtml(meta.name)} &bull; Halte ke-${station.index}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn-action btn-action--close" data-action="close-station-detail" title="Tutup">Tutup</button>
          </div>
        </div>
        <div class="timeline-section">
          <h3 class="section-title">Perkiraan Waktu Tiba</h3>
          ${incomingHtml}
        </div>
      </div>
    `;
  }

  function renderNearestStopCard() {
    if (!state.nearestStop) return "";

    const { station, distanceKm } = state.nearestStop;
    const distanceMeters = Math.round(distanceKm * 1000);
    const walkMinutes = Math.max(1, Math.round(distanceKm / CONFIG.walkingSpeedKmPerMin));
    const meta = getRouteMeta(getStationLineId(station));
    const incomingBus = findIncomingBus(station.Stationname);

    const incomingHtml = incomingBus
      ? `<span class="text-success tabular-num">Bus ${escapeHtml(incomingBus.carNo)} (~${incomingBus.etaMinutes} mnt)</span>`
      : '<span class="text-muted">Belum ada bus yang mendekat</span>';

    return `
      <article class="smart-gps-card">
        <div class="smart-card-top">
          <h3 class="smart-stop-name">${escapeHtml(station.Stationname || "Halte")}</h3>
          <span class="smart-distance tabular-num">${distanceMeters} m &bull; ~${walkMinutes} mnt jalan kaki</span>
        </div>
        <div class="smart-card-body">
          <span class="route-badge route-badge--sm" style="--route-color: ${meta.color}">
            ${escapeHtml(meta.code)} &bull; Halte Terdekat
          </span>
          <button type="button" class="btn-action" data-action="fly-to-stop">Lihat di Peta</button>
        </div>
        <div class="smart-bus-eta">
          <span class="text-muted">Bus Berikutnya</span>
          ${incomingHtml}
        </div>
      </article>`;
  }

  function renderCctvCard(loc) {
    const camCount = Array.isArray(loc.cameras) ? loc.cameras.length : 1;
    const isSelected = String(state.selectedCctvId) === String(loc.id);
    const locName = String(loc.name || "Simpang Jalan").trim();
    const locDesc = String(loc.description || "").trim();
    const showDesc = locDesc && locDesc.toLowerCase() !== locName.toLowerCase();

    return `
      <li>
        <button type="button" class="item-card cctv-card${isSelected ? " is-active" : ""}"
          data-action="select-cctv" data-cctv-id="${escapeHtml(loc.id)}">
          <div class="cctv-card-row">
            <span class="cctv-location-name">${escapeHtml(locName)}</span>
            <span class="cctv-cam-count-badge tabular-num">${camCount} kamera</span>
          </div>
          ${showDesc ? `<div class="bus-card-dest">${escapeHtml(locDesc)}</div>` : ""}
        </button>
      </li>
    `;
  }

  function renderCctvDetail(loc) {
    const cameras = Array.isArray(loc.cameras) ? loc.cameras : [];
    const activeIndex = Math.min(state.selectedCctvCameraIndex, Math.max(0, cameras.length - 1));
    const junctionName = loc.name?.trim() || "Kamera CCTV";
    const locDesc = loc.description?.trim();
    const hasDistinctDesc = locDesc && locDesc.toLowerCase() !== junctionName.toLowerCase();

    let angleSwitcherHtml = "";
    if (cameras.length > 1) {
      const angleButtons = cameras
        .map((cam, idx) => {
          const isActive = idx === activeIndex;
          const label = cam.alias || cam.name || `Kamera ${idx + 1}`;
          return `
            <button type="button" class="cctv-angle-pill${isActive ? " is-active" : ""}"
              data-action="switch-cctv-angle" data-index="${idx}">
              ${escapeHtml(label)}
            </button>
          `;
        })
        .join("");

      angleSwitcherHtml = `
        <div class="cctv-angle-switcher" role="group" aria-label="Pilih kamera">
          ${angleButtons}
        </div>
      `;
    }

    return `
      <div class="detail-view cctv-detail-view">
        <div class="detail-header">
          <div class="detail-info">
            <div class="detail-title-row">
              <h2 class="detail-title">${escapeHtml(junctionName)}</h2>
            </div>
            <p class="detail-subtitle">${hasDistinctDesc ? escapeHtml(locDesc) : "Kamera CCTV Dishub Medan"}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn-action btn-action--close" data-action="close-cctv" title="Tutup video">Tutup</button>
          </div>
        </div>

        <div class="cctv-player-container">
          <div class="cctv-video-wrapper">
            <div class="cctv-live-badge">
              <span class="pulse-dot" aria-hidden="true"></span>
              <span>LIVE</span>
            </div>
            <video id="cctv-video-player" class="cctv-video" playsinline muted autoplay></video>
            <div id="cctv-player-spinner" class="cctv-player-spinner">
              <span class="spinner-icon" aria-hidden="true"></span>
              <span id="cctv-stream-status">Menyiapkan video...</span>
            </div>
          </div>

          ${angleSwitcherHtml}

          <div class="cctv-player-toolbar">
            <button type="button" class="btn-action" data-action="reload-stream" title="Muat ulang video">Refresh</button>
            <button type="button" class="btn-action" data-action="fullscreen-video" title="Tampilkan video satu layar penuh">Layar Penuh</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderCctvOverview() {
    if (state.cctvStatus === "loading") {
      return '<div class="loading-state"><p>Memuat daftar CCTV...</p></div>';
    }

    const locations = getVisibleCctvLocations();

    if (locations.length > 0) {
      return `<ul class="cctv-list">${locations.map(renderCctvCard).join("")}</ul>`;
    }

    if (state.cctvStatus === "error") {
      return '<p class="empty-state empty-state--error">Gagal memuat daftar CCTV. Silakan refresh halaman.</p>';
    }

    return '<p class="empty-state">Tidak ada kamera CCTV yang cocok dengan pencarian Anda.</p>';
  }

  function stopCctvStream() {
    if (state.hlsInstance) {
      try {
        state.hlsInstance.destroy();
      } catch {
        // Abaikan error saat teardown instance HLS
      }
      state.hlsInstance = null;
    }
    const video = document.getElementById("cctv-video-player");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  let hlsScriptPromise = null;

  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsScriptPromise) return hlsScriptPromise;

    hlsScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js";
      script.async = true;
      script.onload = () => resolve(window.Hls);
      script.onerror = () => {
        hlsScriptPromise = null;
        reject(new Error("Gagal memuat modul HLS"));
      };
      document.head.appendChild(script);
    });

    return hlsScriptPromise;
  }

  async function initCctvPlayback() {
    stopCctvStream();

    const loc = state.cctvLocations.find((item) => String(item.id) === String(state.selectedCctvId));
    if (!loc || !Array.isArray(loc.cameras) || loc.cameras.length === 0) return;

    const camera = loc.cameras[state.selectedCctvCameraIndex] || loc.cameras[0];
    const streamUrl = camera?.stream_url;
    const video = document.getElementById("cctv-video-player");
    const spinner = document.getElementById("cctv-player-spinner");
    const statusText = document.getElementById("cctv-stream-status");

    if (!video || !streamUrl) {
      if (spinner) spinner.classList.add("is-hidden");
      if (statusText) statusText.textContent = "Video tidak tersedia";
      return;
    }

    if (spinner) spinner.classList.remove("is-hidden");
    if (statusText) statusText.textContent = "Menghubungkan ke kamera...";

    const hideSpinner = () => {
      if (spinner) spinner.classList.add("is-hidden");
      if (statusText) statusText.textContent = "Siaran Langsung";
    };

    video.onplaying = hideSpinner;
    video.onloadeddata = hideSpinner;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.play().catch(() => { });
      return;
    }

    try {
      await loadHlsScript();
    } catch {
      if (spinner) spinner.classList.add("is-hidden");
      if (statusText) statusText.textContent = "Gagal memuat pemutar video";
      return;
    }

    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => { });
      });

      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              stopCctvStream();
              if (spinner) spinner.classList.add("is-hidden");
              if (statusText) statusText.textContent = "Kamera sedang offline atau video gagal diputar";
              break;
          }
        }
      });

      state.hlsInstance = hls;
    } else {
      if (spinner) spinner.classList.add("is-hidden");
      if (statusText) statusText.textContent = "Browser Anda belum mendukung format video ini";
    }
  }

  function isMobileView() {
    return window.innerWidth <= 768;
  }

  function getSheetPaddingBottom() {
    if (!isMobileView()) return 24;
    if (state.sheetTier === "expanded") {
      return Math.round(window.innerHeight * 0.84);
    }
    if (state.sheetTier === "half") {
      return Math.round(window.innerHeight * 0.48);
    }
    return 148;
  }

  function getCameraPadding() {
    if (isMobileView()) {
      return { bottom: getSheetPaddingBottom(), top: 20, left: 20, right: 20 };
    }
    return { left: 380, top: 24, right: 64, bottom: 24 };
  }

  function selectCctvLocation(id) {
    const loc = state.cctvLocations.find((item) => String(item.id) === String(id));
    if (!loc) return;

    state.selectedCctvId = loc.id;
    state.selectedCctvCameraIndex = 0;

    if (map) {
      map.flyTo({
        center: [loc.lon, loc.lat],
        zoom: 16.5,
        pitch: getActivePitch(50),
        padding: getCameraPadding(),
        duration: 900,
      });
    }

    openDetailView();
    renderSheetContent();
  }

  function closeCctvDetail() {
    stopCctvStream();
    state.selectedCctvId = null;
    closeDetailView();
    renderSheetContent();
  }

  function selectCctvAngle(index) {
    state.selectedCctvCameraIndex = toNumber(index, 0);
    renderSheetContent();
  }

  function reloadCctvStream() {
    showToast("Memuat ulang video CCTV...", "info");
    initCctvPlayback();
  }

  function fullscreenCctvVideo() {
    const video = document.getElementById("cctv-video-player");
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if (video.webkitRequestFullscreen) {
      video.webkitRequestFullscreen();
    }
  }

  function setActiveMode(mode) {
    if (state.activeMode === mode) return;

    state.activeMode = mode;

    if (mode !== "cctv") {
      stopCctvStream();
      state.selectedCctvId = null;
    } else {
      state.selectedBusId = null;
      state.selectedStation = null;
      state.isFollowingBus = false;
      loadHlsScript().catch(() => { });
    }

    dom.bottomSheet?.classList.remove("in-detail-view");

    if (dom.tabBus && dom.tabCctv) {
      dom.tabBus.classList.toggle("is-active", mode === "bus");
      dom.tabBus.setAttribute("aria-selected", String(mode === "bus"));
      dom.tabCctv.classList.toggle("is-active", mode === "cctv");
      dom.tabCctv.setAttribute("aria-selected", String(mode === "cctv"));
    }

    if (dom.corridorFilterWrap) {
      dom.corridorFilterWrap.style.display = mode === "bus" ? "" : "none";
    }

    if (dom.transitSubmodeSelector) {
      dom.transitSubmodeSelector.style.display = mode === "bus" ? "" : "none";
    }

    if (dom.searchInput) {
      dom.searchInput.placeholder =
        mode === "bus"
          ? (state.transitSubmode === "train" ? "Cari kereta, rute, atau stasiun..." : "Cari bus, rute, atau halte...")
          : "Cari simpang atau jalan CCTV...";
      dom.searchInput.value = "";
      state.searchQuery = "";
      dom.btnClearSearch?.classList.add("is-hidden");
    }

    updateLayerVisibility();
    renderBusStat();
    renderSheetContent();
  }

  function setDockCollapsed(collapsed) {
    state.isDockCollapsed = Boolean(collapsed);
    if (dom.bottomSheet) {
      dom.bottomSheet.classList.toggle("is-dock-collapsed", state.isDockCollapsed);
    }
    if (dom.btnDockCollapse) {
      dom.btnDockCollapse.setAttribute("aria-expanded", String(!state.isDockCollapsed));
      dom.btnDockCollapse.title = state.isDockCollapsed ? "Buka panel" : "Tutup panel";
    }
  }

  function toggleDock() {
    setDockCollapsed(!state.isDockCollapsed);
  }

  function setSheetTier(tier) {
    const validTiers = ["collapsed", "half", "expanded"];
    const targetTier = validTiers.includes(tier) ? tier : "collapsed";
    state.sheetTier = targetTier;

    if (dom.bottomSheet) {
      dom.bottomSheet.classList.remove("is-collapsed", "is-half", "is-expanded");
      dom.bottomSheet.classList.add(`is-${targetTier}`);
      dom.sheetToggle?.setAttribute("aria-expanded", String(targetTier !== "collapsed"));
    }

    document.body.classList.remove("is-sheet-collapsed", "is-sheet-half", "is-sheet-expanded");
    document.body.classList.add(`is-sheet-${targetTier}`);
  }

  function setSheetExpanded(isExpanded) {
    setSheetTier(isExpanded ? "half" : "collapsed");
  }

  function toggleSheet() {
    if (state.sheetTier === "collapsed") {
      setSheetTier("half");
    } else if (state.sheetTier === "half") {
      setSheetTier("expanded");
    } else {
      setSheetTier("collapsed");
    }
  }

  function openDetailView() {
    dom.bottomSheet?.classList.add("in-detail-view");
    if (state.isDockCollapsed) {
      setDockCollapsed(false);
    }
    if (isMobileView() && state.sheetTier === "collapsed") {
      setSheetTier("half");
    }
  }

  function closeDetailView() {
    dom.bottomSheet?.classList.remove("in-detail-view");
    if (isMobileView() && state.sheetTier === "expanded") {
      setSheetTier("half");
    }
  }

  function setupBottomSheetGestures() {
    if (!dom.sheetToggle || !dom.bottomSheet) return;

    let startY = 0;
    let startTime = 0;
    let isDragging = false;

    dom.sheetToggle.addEventListener(
      "touchstart",
      (e) => {
        if (!isMobileView()) return;
        const touch = e.touches[0];
        startY = touch.clientY;
        startTime = Date.now();
        isDragging = true;
      },
      { passive: true }
    );

    dom.sheetToggle.addEventListener(
      "touchend",
      (e) => {
        if (!isDragging || !isMobileView()) return;
        isDragging = false;
        const touch = e.changedTouches[0];
        const deltaY = touch.clientY - startY;
        const elapsed = Math.max(1, Date.now() - startTime);
        const velocity = deltaY / elapsed;

        if (velocity < -0.3 || deltaY < -40) {
          if (state.sheetTier === "collapsed") {
            setSheetTier("half");
          } else if (state.sheetTier === "half") {
            setSheetTier("expanded");
          }
        } else if (velocity > 0.3 || deltaY > 40) {
          if (state.sheetTier === "expanded") {
            setSheetTier("half");
          } else if (state.sheetTier === "half") {
            setSheetTier("collapsed");
          }
        }
      },
      { passive: true }
    );
  }

  function showToast(message, variant = "info") {
    dom.toast.textContent = message;
    dom.toast.dataset.variant = variant;
    dom.toast.classList.add("is-visible");

    clearTimeout(toastTimerId);
    toastTimerId = setTimeout(() => dom.toast.classList.remove("is-visible"), CONFIG.toastDurationMs);
  }

  function renderFatalError(message) {
    dom.busStat.textContent = "Offline";
    dom.sheetContent.innerHTML = `<p class="empty-state empty-state--error">${escapeHtml(message)}</p>`;
    setSheetTier("expanded");
  }

  function filterCorridor(corridorId) {
    const isKnownCorridor =
      corridorId === ALL_CORRIDORS || Object.prototype.hasOwnProperty.call(ROUTES, corridorId);
    if (!isKnownCorridor) return;

    state.selectedCorridor = corridorId;
    state.selectedBusId = null;
    state.isFollowingBus = false;

    if (state.isDockCollapsed) {
      setDockCollapsed(false);
    }

    renderCorridorPills();
    applyCorridorFilter();
    renderBusStat();
    renderSheetContent();
    restartAnimation();
  }

  function selectBus(carNo) {
    const bus = findBusById(carNo);
    if (!bus) return;

    state.selectedBusId = getBusId(bus);
    state.isFollowingBus = false;

    openDetailView();
    renderSheetContent();

    const position = getBusPosition(bus);
    if (position && map) {
      map.flyTo({
        center: position,
        zoom: CAMERA.busZoom,
        pitch: getActivePitch(CAMERA.focusPitch),
        padding: getCameraPadding(),
        duration: 900,
      });
    }
  }

  function closeBusDetail() {
    state.selectedBusId = null;
    state.isFollowingBus = false;
    closeDetailView();
    renderSheetContent();
  }

  function toggleFollowBus() {
    state.isFollowingBus = !state.isFollowingBus;
    renderSheetContent();
    if (state.isFollowingBus) restartAnimation();
  }

  function flyToNearestStop() {
    if (!state.nearestStop || !map) return;
    map.flyTo({
      center: state.nearestStop.coordinates,
      zoom: CAMERA.stopZoom,
      padding: getCameraPadding(),
      duration: 800,
    });
  }

  function closeStationDetail() {
    state.selectedStation = null;
    closeDetailView();
    renderSheetContent();
  }

  function handleSearchInput(event) {
    state.searchQuery = (event.target.value || "").trim();
    dom.btnClearSearch.classList.toggle("is-hidden", !state.searchQuery);
    if (state.searchQuery && state.isDockCollapsed) {
      setDockCollapsed(false);
    }
    renderBusStat();
    renderSheetContent();
    if (state.activeMode === "bus") restartAnimation();
  }

  function clearSearch() {
    dom.searchInput.value = "";
    state.searchQuery = "";
    dom.btnClearSearch.classList.add("is-hidden");
    renderBusStat();
    renderSheetContent();
    if (state.activeMode === "bus") restartAnimation();
  }

  function openAboutModal() {
    const modal = document.getElementById("about-modal");
    if (!modal) return;
    if (typeof modal.showModal === "function") {
      modal.showModal();
    } else {
      modal.setAttribute("open", "");
    }
  }

  function closeAboutModal() {
    const modal = document.getElementById("about-modal");
    if (!modal) return;
    if (typeof modal.close === "function") {
      modal.close();
    } else {
      modal.removeAttribute("open");
    }
  }

  const ACTION_HANDLERS = {
    "reset-north": resetNorth,
    "toggle-pitch": togglePitch,
    "locate-user": locateUser,
    "reset-camera": resetCamera,
    "toggle-sheet": toggleSheet,
    "toggle-dock": toggleDock,
    "toggle-about": openAboutModal,
    "close-about": closeAboutModal,
    "switch-mode": (element) => setActiveMode(element.dataset.mode),
    "switch-submode": (element) => setTransitSubmode(element.dataset.submode),
    "filter-train-direction": (element) => filterTrainDirection(element.dataset.direction),
    "select-train": (element) => selectTrain(element.dataset.tripId),
    "close-train-detail": closeTrainDetail,
    "toggle-follow-train": toggleFollowTrain,
    "fly-to-train": (element) => flyToTrain(element.dataset.tripId),
    "select-train-station": (element) => selectTrainStation(element.dataset.stationCode),
    "close-train-station": closeTrainStationDetail,
    "fly-to-train-station": (element) => flyToTrainStation(element.dataset.stationCode),
    "select-cctv": (element) => selectCctvLocation(element.dataset.cctvId),
    "close-cctv": closeCctvDetail,
    "switch-cctv-angle": (element) => selectCctvAngle(element.dataset.index),
    "reload-stream": reloadCctvStream,
    "fullscreen-video": fullscreenCctvVideo,
    "filter-corridor": (element) => filterCorridor(element.dataset.corridor),
    "select-bus": (element) => selectBus(element.dataset.carNo),
    "toggle-follow": toggleFollowBus,
    "close-detail": closeBusDetail,
    "close-station-detail": closeStationDetail,
    "fly-to-stop": flyToNearestStop,
    "clear-search": clearSearch,
    "toggle-theme": () => {
      const nextTheme = state.theme === "light" ? "dark" : "light";
      applyTheme(nextTheme);
      showToast(`Mode ${nextTheme === "light" ? "Terang" : "Gelap"} aktif`, "info");
    },
  };

  function bindUiEvents() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-action]");
      const handler = trigger && ACTION_HANDLERS[trigger.dataset.action];
      if (handler) handler(trigger, event);
    });

    dom.tabBus?.addEventListener("click", () => setActiveMode("bus"));
    dom.tabCctv?.addEventListener("click", () => setActiveMode("cctv"));
    dom.btnSubmodeBus?.addEventListener("click", () => setTransitSubmode("bus"));
    dom.btnSubmodeTrain?.addEventListener("click", () => setTransitSubmode("train"));

    dom.searchInput?.addEventListener("input", handleSearchInput);

    setupBottomSheetGestures();

    const aboutModal = document.getElementById("about-modal");
    aboutModal?.addEventListener("click", (e) => {
      if (e.target === aboutModal) closeAboutModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (aboutModal && aboutModal.open) closeAboutModal();
      else if (state.selectedCctvId) closeCctvDetail();
      else if (state.selectedBusId) closeBusDetail();
      else if (state.selectedStation) closeStationDetail();
      else if (state.selectedTrainId) closeTrainDetail();
      else if (state.selectedTrainStation) closeTrainStationDetail();
      else if (state.searchQuery) clearSearch();
      else if (isMobileView()) setSheetTier("collapsed");
      else setDockCollapsed(true);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearTimeout(poller.timerId);
      else pollBusPositions();
    });
  }

  function bindMapEvents() {
    map.on("rotate", () => {
      if (dom.compassNeedle) {
        dom.compassNeedle.style.transform = `rotate(${-map.getBearing()}deg)`;
      }
    });

    map.on("pitchend", (event) => {
      if (!event?.originalEvent) return;
      state.is3D = map.getPitch() > 5;
      updatePitchButton();
    });

    map.on("dragstart", () => {
      if (state.isFollowingBus) {
        state.isFollowingBus = false;
        renderSheetContent();
      }
      if (state.isFollowingTrain) {
        state.isFollowingTrain = false;
        renderSheetContent();
      }
    });

    map.on("click", LAYER.railTrains, (event) => {
      const tripId = event.features?.[0]?.properties?.trip_id;
      if (tripId != null) selectTrain(tripId);
    });

    map.on("click", LAYER.railTrainsHeading, (event) => {
      const tripId = event.features?.[0]?.properties?.trip_id;
      if (tripId != null) selectTrain(tripId);
    });

    map.on("mouseenter", LAYER.railTrains, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.railTrains, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseenter", LAYER.railTrainsHeading, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.railTrainsHeading, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", LAYER.railStations, (event) => {
      const code = event.features?.[0]?.properties?.code;
      if (code != null) selectTrainStation(code);
    });

    map.on("mouseenter", LAYER.railStations, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.railStations, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", LAYER.buses, (event) => {
      const carNo = event.features?.[0]?.properties?.carNo;
      if (carNo != null) selectBus(carNo);
    });

    map.on("click", LAYER.busesHeading, (event) => {
      const carNo = event.features?.[0]?.properties?.carNo;
      if (carNo != null) selectBus(carNo);
    });

    map.on("mouseenter", LAYER.buses, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseenter", LAYER.busesHeading, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", LAYER.buses, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseleave", LAYER.busesHeading, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", LAYER.stations, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      const coordinates = feature.geometry.coordinates;

      state.selectedBusId = null;
      state.isFollowingBus = false;
      state.selectedStation = {
        name: props.name,
        index: props.index,
        lineId: props.lineId,
      };

      openDetailView();
      renderSheetContent();

      map.flyTo({
        center: coordinates,
        zoom: CAMERA.stopZoom,
        pitch: getActivePitch(CAMERA.focusPitch),
        padding: getCameraPadding(),
        duration: 900,
      });
    });

    map.on("mouseenter", LAYER.stations, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", LAYER.stations, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", LAYER.cctvClusters, (event) => {
      const features = map.queryRenderedFeatures(event.point, { layers: [LAYER.cctvClusters] });
      const clusterId = features[0]?.properties?.cluster_id;
      const source = map.getSource(SOURCE.cctv);
      if (source && clusterId != null) {
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({
            center: features[0].geometry.coordinates,
            zoom: Math.min(zoom, 17),
            duration: 500,
          });
        });
      }
    });

    map.on("mouseenter", LAYER.cctvClusters, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.cctvClusters, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", LAYER.cctvPins, (event) => {
      const feature = event.features?.[0];
      const cctvId = feature?.properties?.id;
      if (cctvId != null) {
        selectCctvLocation(cctvId);
      }
    });

    map.on("mouseenter", LAYER.cctvPins, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.cctvPins, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("error", (event) => {
      const err = event.error ?? event;
      console.warn("[Peta] MapLibre error:", err);
      const isPmtilesErr = event.sourceId === "protomaps" || (err && String(err).toLowerCase().includes("pmtiles"));
      if (isPmtilesErr && !state.usedFallbackBasemap) {
        state.usedFallbackBasemap = true;
        console.warn("[Peta] Beralih ke peta raster cadangan...");
        map.setStyle(getFallbackRasterStyle(state.theme));
        map.once("styledata", () => {
          registerTransitLayers();
          applyCorridorFilter();
          restoreCachedSources();
          restartAnimation();
        });
      }
    });

    map.on("load", () => {
      registerTransitLayers();
      applyCorridorFilter();
      restoreCachedSources();
      if (state.buses.length > 0) {
        handleBusUpdate();
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .then((registration) => console.info("[PWA] Service Worker aktif:", registration.scope))
        .catch((error) => console.error("[PWA] Gagal mendaftarkan Service Worker:", error));
    });
  }

  function applyTheme(newTheme) {
    state.theme = newTheme;
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem("tengokmedan-theme", newTheme);

    const sunIcon = document.querySelector(".theme-icon-sun");
    const moonIcon = document.querySelector(".theme-icon-moon");
    if (sunIcon && moonIcon) {
      sunIcon.classList.toggle("is-hidden", newTheme === "light");
      moonIcon.classList.toggle("is-hidden", newTheme === "dark");
    }

    if (map) {
      const updatedInPlace = updateBasemapTheme(newTheme);
      if (!updatedInPlace) {
        map.setStyle(getBasemapStyle(newTheme));
        map.once("styledata", () => {
          registerTransitLayers();
          applyCorridorFilter();
          restoreCachedSources();
          restartAnimation();
        });
      }
    }
    renderSheetContent();
  }

  function init() {
    applyTheme(state.theme);
    setSheetTier("half");
    bindUiEvents();
    renderCorridorPills();
    renderBusStat();
    renderSheetContent();
    registerServiceWorker();

    const initStartTime = Date.now();
    const tryInitMap = () => {
      if (typeof window.maplibregl === "undefined") {
        if (Date.now() - initStartTime < 10000) {
          setTimeout(tryInitMap, 50);
          return;
        }
        renderFatalError("Peta gagal dimuat. Periksa koneksi internet Anda lalu refresh halaman.");
        return;
      }

      try {
        map = createMap();
        bindMapEvents();
      } catch (error) {
        console.error("[Peta] Gagal inisialisasi:", error);
        renderFatalError("Browser atau perangkat Anda belum mendukung tampilan grafis untuk peta ini.");
        return;
      }

      const startDataServices = () => {
        loadRoutesFeatures().then((routes) => {
          if (routes && routes.length > 0 && (!state.cache[SOURCE.routes] || state.cache[SOURCE.routes].length === 0)) {
            registerTransitLayers();
            setSourceData(SOURCE.routes, routes);
            applyCorridorFilter();
          }
        });
        loadStations();
        loadRailinkData();
        loadCctvLocations();
        pollBusPositions();
        setInterval(updateTrainPositions, 1000);
      };

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(startDataServices, { timeout: 1000 });
      } else {
        setTimeout(startDataServices, 60);
      }
    };

    tryInitMap();
  }

  init();
})();
