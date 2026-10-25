const CACHE_NAME = "medan-transit-v11";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./data/routes_geojson.json",
    "./data/stations.json",
    "./data/cctv_medan.json",
    "./data/railink_stations.json",
    "./data/railink_schedule.json",
    "./data/railink_corridor.geojson",
];

const CDN_ASSETS = [
    "https://unpkg.com/pmtiles@3.0.7/dist/pmtiles.js",
    "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css",
    "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js",
    "https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll([...APP_SHELL, ...CDN_ASSETS]))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return;

    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
        return;
    }

    if (CDN_ASSETS.includes(url.href)) {
        event.respondWith(cacheFirst(request));
    }
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (request.mode === "navigate") {
            const shell = await cache.match("./index.html");
            if (shell) return shell;
        }
        throw error;
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
    }
    return response;
}