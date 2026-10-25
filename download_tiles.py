import io
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
import httpx

BBOX = (98.55, 3.45, 98.80, 3.75)  # min_lon, min_lat, max_lon, max_lat
MAX_ZOOM = 15
TARGET_DIR = os.path.join(os.path.dirname(__file__), "backend", "static", "maps")
TARGET_FILE = os.path.join(TARGET_DIR, "medan.pmtiles")
TOOLS_DIR = os.path.join(os.path.dirname(__file__), "backend", "tools")


def ensure_pmtiles_cli() -> str:
    """Memastikan binary pmtiles tersedia di PATH atau direktori tools lokal."""
    cli_on_path = shutil.which("pmtiles")
    if cli_on_path:
        return cli_on_path

    exe_name = "pmtiles.exe" if platform.system() == "Windows" else "pmtiles"
    local_path = os.path.join(TOOLS_DIR, exe_name)
    if os.path.exists(local_path):
        return local_path

    os.makedirs(TOOLS_DIR, exist_ok=True)
    os_name = platform.system()
    arch = platform.machine().lower()

    if os_name == "Windows":
        artifact = "go-pmtiles_1.31.2_Windows_x86_64.zip"
    elif os_name == "Darwin":
        artifact = (
            "go-pmtiles-1.31.2_Darwin_arm64.zip"
            if "arm" in arch
            else "go-pmtiles-1.31.2_Darwin_x86_64.zip"
        )
    else:
        artifact = (
            "go-pmtiles_1.31.2_Linux_arm64.tar.gz"
            if "arm" in arch
            else "go-pmtiles_1.31.2_Linux_x86_64.tar.gz"
        )

    download_url = f"https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/{artifact}"
    print(f"Mengunduh binary pmtiles dari {download_url}...")
    resp = httpx.get(download_url, follow_redirects=True, timeout=60.0)
    resp.raise_for_status()

    if artifact.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for item in zf.namelist():
                if item.endswith(exe_name):
                    with open(local_path, "wb") as f:
                        f.write(zf.read(item))
                    break
    else:
        import tarfile

        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tf:
            for member in tf.getmembers():
                if member.name.endswith(exe_name):
                    f = tf.extractfile(member)
                    if f:
                        with open(local_path, "wb") as out_f:
                            out_f.write(f.read())
                    break

    os.chmod(local_path, 0o755)
    return local_path


def get_latest_build_key() -> str:
    """Mengambil key build harian terbaru dari metadata Protomaps."""
    url = "https://build-metadata.protomaps.dev/builds.json"
    try:
        resp = httpx.get(url, timeout=15.0)
        resp.raise_for_status()
        builds = resp.json()
        if builds and isinstance(builds, list):
            latest = builds[-1]
            return latest.get("key", "20261019.pmtiles")
    except Exception as err:
        print(f"Gagal mengambil metadata build terbaru: {err}, menggunakan fallback.")
    return "20261019.pmtiles"


def extract_medan_tiles(cli_path: str, build_key: str):
    """Mengekstrak bounding box Kota Medan ke berkas pmtiles lokal."""
    os.makedirs(TARGET_DIR, exist_ok=True)
    remote_source = f"https://build.protomaps.com/{build_key}"
    bbox_arg = f"--bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
    zoom_arg = f"--maxzoom={MAX_ZOOM}"

    print(f"Mengekstrak area Medan dari {remote_source}...")
    print(f"Bounding Box: {bbox_arg}, Max Zoom: {MAX_ZOOM}")
    cmd = [cli_path, "extract", remote_source, TARGET_FILE, bbox_arg, zoom_arg]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Ekstraksi gagal:\n{res.stderr}")
        sys.exit(1)

    size_mb = os.path.getsize(TARGET_FILE) / (1024 * 1024)
    print(f"Berhasil: {TARGET_FILE} tersimpan ({size_mb:.2f} MB).")


if __name__ == "__main__":
    cli = ensure_pmtiles_cli()
    key = get_latest_build_key()
    extract_medan_tiles(cli, key)
