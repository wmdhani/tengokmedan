import asyncio
from contextlib import asynccontextmanager
import json
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
import httpx

DATA_CACHE = {
    "routes": [],
    "stations": [],
    "buses": [],
    "cctv": [],
    "railink_stations": [],
    "railink_schedule": {},
    "railink_corridor": {},
    "last_bus_update": None,
}
BASE_API = "https://buslistrikmedan.com/api"
DISHUB_CCTV_API = "https://atcsdishub.medan.go.id/api/v3/pv/ldevice"
DISHUB_CLIENT_ID = os.getenv("DISHUB_CLIENT_ID", "")
DISHUB_CLIENT_SECRET = os.getenv("DISHUB_CLIENT_SECRET", "")
DISHUB_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/json",
    "x-client-id": DISHUB_CLIENT_ID,
    "x-client-secret": DISHUB_CLIENT_SECRET,
}


def parse_cctv_payload(raw_data):
    curated = []
    for item in raw_data:
        lat = item.get("lat_lokasi")
        lon = item.get("lon_lokasi")
        if not lat or not lon:
            continue
        devices = []
        for dev in item.get("tb_device_lokasi", []):
            hls = dev.get("url_proxy_hls") or ""
            if hls:
                if not hls.endswith("/"):
                    hls += "/"
                if not hls.endswith("index.m3u8"):
                    hls += "index.m3u8"
            devices.append(
                {
                    "name": dev.get("nama", "Kamera"),
                    "alias": dev.get("nama_alias") or dev.get("nama", "Kamera"),
                    "description": dev.get("deskripsi") or "",
                    "stream_url": hls,
                    "type": dev.get("type_cam", 1),
                }
            )
        curated.append(
            {
                "id": item.get("id_lokasi"),
                "name": item.get("nama_lokasi", "Persimpangan"),
                "description": item.get("ket_lokasi") or "",
                "lat": float(lat),
                "lon": float(lon),
                "cameras": devices,
            }
        )
    return curated


async def fetch_static_metadata():
    """Katalog rute koridor, halte, dan kamera CCTV ATCS."""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
    routes_file = os.path.join(data_dir, "routes.json")
    routes_geojson_file = os.path.join(data_dir, "routes_geojson.json")
    stations_file = os.path.join(data_dir, "stations.json")
    cctv_file = os.path.join(data_dir, "cctv_medan.json")

    if os.path.exists(routes_geojson_file):
        try:
            with open(routes_geojson_file, "r", encoding="utf-8") as f:
                DATA_CACHE["routes_geojson"] = json.load(f)
        except Exception as e:
            print(f"Gagal membaca routes_geojson.json: {e}")

    async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
        try:
            routes_resp = await client.get(f"{BASE_API}/routes")
            stations_resp = await client.get(f"{BASE_API}/all-stations")
            if routes_resp.status_code == 200:
                DATA_CACHE["routes"] = routes_resp.json()
            if stations_resp.status_code == 200:
                DATA_CACHE["stations"] = stations_resp.json()
            print("Katalog rute dan halte berhasil dimuat dari live API.")
        except Exception as e:
            print(f"Gagal memuat rute/halte dari live API: {e}")
            if os.path.exists(routes_file):
                with open(routes_file, "r", encoding="utf-8") as f:
                    DATA_CACHE["routes"] = json.load(f)
            if os.path.exists(stations_file):
                with open(stations_file, "r", encoding="utf-8") as f:
                    DATA_CACHE["stations"] = json.load(f)

        try:
            cctv_resp = await client.get(DISHUB_CCTV_API, headers=DISHUB_HEADERS)
            if cctv_resp.status_code == 200:
                payload = cctv_resp.json()
                raw_cctv = payload.get("data", [])
                DATA_CACHE["cctv"] = parse_cctv_payload(raw_cctv)
                print(f"Metadata CCTV ATCS ({len(DATA_CACHE['cctv'])} lokasi) berhasil dimuat dari live API.")
        except Exception as e:
            print(f"Gagal memuat CCTV dari live API: {e}")

        if not DATA_CACHE["cctv"] and os.path.exists(cctv_file):
            with open(cctv_file, "r", encoding="utf-8") as f:
                DATA_CACHE["cctv"] = json.load(f)
            print(f"Metadata CCTV ATCS ({len(DATA_CACHE['cctv'])} lokasi) dimuat dari berkas lokal.")

    railink_stations_file = os.path.join(data_dir, "railink_stations.json")
    railink_schedule_file = os.path.join(data_dir, "railink_schedule.json")
    railink_corridor_file = os.path.join(data_dir, "railink_corridor.geojson")

    if os.path.exists(railink_stations_file):
        try:
            with open(railink_stations_file, "r", encoding="utf-8") as f:
                DATA_CACHE["railink_stations"] = json.load(f)
        except Exception as e:
            print(f"Gagal membaca railink_stations.json: {e}")

    if os.path.exists(railink_schedule_file):
        try:
            with open(railink_schedule_file, "r", encoding="utf-8") as f:
                DATA_CACHE["railink_schedule"] = json.load(f)
        except Exception as e:
            print(f"Gagal membaca railink_schedule.json: {e}")

    if os.path.exists(railink_corridor_file):
        try:
            with open(railink_corridor_file, "r", encoding="utf-8") as f:
                DATA_CACHE["railink_corridor"] = json.load(f)
        except Exception as e:
            print(f"Gagal membaca railink_corridor.geojson: {e}")


async def poll_bus_locations():
    """Polling berkala posisi armada bus."""
    while True:
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(f"{BASE_API}/all-bus-location")
                if resp.status_code == 200:
                    DATA_CACHE["buses"] = resp.json()
            except Exception as e:
                print(f"Polling error: {e}")
        await asyncio.sleep(7)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await fetch_static_metadata()
    task = asyncio.create_task(poll_bus_locations())
    yield
    task.cancel()


app = FastAPI(title="Medan Transit Gateway API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)


@app.middleware("http")
async def add_cache_control_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.endswith((".js", ".css", ".html")) or path in ("/", "/sw.js"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.get("/api/v1/health")
def health_check():
    return {
        "status": "healthy",
        "app": "TengokMedan",
        "active_buses": len(DATA_CACHE.get("buses", {}).get("Cars", [])) if isinstance(DATA_CACHE.get("buses"), dict) else len(DATA_CACHE.get("buses", [])),
    }


@app.get("/api/v1/routes")
def get_routes():
    return DATA_CACHE["routes"]


@app.get("/api/v1/routes-geojson")
def get_routes_geojson():
    return DATA_CACHE.get("routes_geojson", {"type": "FeatureCollection", "features": []})


@app.get("/api/v1/stations")
def get_stations():
    return DATA_CACHE["stations"]


@app.get("/api/v1/cctv")
def get_cctv():
    return DATA_CACHE["cctv"]


@app.get("/api/v1/live-buses")
def get_live_buses():
    raw_data = DATA_CACHE["buses"]
    cars = raw_data if isinstance(raw_data, list) else raw_data.get("Cars", [])

    # Batasi daftar halte terdekat untuk efisiensi transfer data
    trimmed_cars = []
    for car in cars:
        stations = car.get("Stations") or []
        next_stops = stations[:8] if stations else []

        trimmed_cars.append(
            {
                "CarNo": car.get("CarNo"),
                "Routeid": car.get("Routeid"),
                "Latitude": car.get("Latitude"),
                "Longitude": car.get("Longitude"),
                "Speed": car.get("Speed", 0),
                "Direction": car.get("Direction", 0),
                "Stations": next_stops,
            }
        )

    return {"Cars": trimmed_cars}


@app.get("/api/v1/railink-stations")
def get_railink_stations():
    return DATA_CACHE.get("railink_stations", [])


@app.get("/api/v1/railink-schedule")
def get_railink_schedule():
    return DATA_CACHE.get("railink_schedule", {})


@app.get("/api/v1/railink-corridor")
def get_railink_corridor():
    return DATA_CACHE.get("railink_corridor", {"type": "FeatureCollection", "features": []})


static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
