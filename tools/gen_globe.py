"""Generate the equirectangular globe texture + ocean specular map.

Reads Natural Earth land/lakes polygons (GeoJSON) and renders a cartographic
base map in a dark "tactical" palette. Deterministic: fixed RNG seed.

Usage: python -I tools/gen_globe.py
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".work")
ASSETS = os.path.join(ROOT, "assets")

W, H = 4096, 2048


def load_geojson(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def iter_rings(geom):
    t = geom["type"]
    if t == "Polygon":
        for ring in geom["coordinates"]:
            yield ring
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            for ring in poly:
                yield ring


def project(lon, lat):
    return ((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H)


def ring_points(ring):
    pts = []
    for lon, lat in ring:
        x, y = project(lon, lat)
        pts.append((x, y))
    # unwrap: rings that cross the antimeridian produce huge horizontal jumps
    if len(pts) > 2:
        out = [pts[0]]
        for p in pts[1:]:
            prev = out[-1]
            dx = p[0] - prev[0]
            if dx > W / 2:
                p = (p[0] - W, p[1])
            elif dx < -W / 2:
                p = (p[0] + W, p[1])
            out.append(p)
        xmin = min(p[0] for p in out)
        xmax = max(p[0] for p in out)
        if xmax - xmin > W * 0.9:
            return None
        return out
    return pts


def draw_rings(draw, rings, fill=None, outline=None, width=1):
    for pts in rings:
        if not pts or len(pts) < 3:
            continue
        if fill:
            draw.polygon(pts, fill=fill)
        if outline:
            closed = pts + [pts[0]]
            draw.line(closed, fill=outline, width=width, joint="curve")


def noise_image(w, h, scale, seed, contrast=1.0):
    rng = np.random.default_rng(seed)
    small = rng.random((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8), "L")
    img = img.resize((w, h), Image.BICUBIC)
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = (arr - 0.5) * contrast + 0.5
    return np.clip(arr, 0.0, 1.0)


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def main():
    land = load_geojson(os.path.join(WORK, "land50.geojson"))
    lakes = load_geojson(os.path.join(WORK, "lakes50.geojson"))

    land_rings = []
    for f in land["features"]:
        for ring in iter_rings(f["geometry"]):
            pts = ring_points(ring)
            if pts:
                land_rings.append(pts)
    lake_rings = []
    for f in lakes["features"]:
        if f["geometry"] is None:
            continue
        for ring in iter_rings(f["geometry"]):
            pts = ring_points(ring)
            if pts:
                lake_rings.append(pts)
    print("land rings", len(land_rings), "lake rings", len(lake_rings))

    # ---------------------------------------------------------------- ocean
    y = np.linspace(0.0, 1.0, H, dtype=np.float32)
    lat_abs = np.abs(90.0 - y * 180.0)  # 90 at poles .. 0 at equator
    # smooth multi-stop profile keyed on |latitude|. Deliberately dark: the
    # scene lights the globe, so the map only needs to supply hue and detail.
    stops = [90.0, 72.0, 55.0, 38.0, 20.0, 0.0]
    cols = [hex_rgb("#010408"), hex_rgb("#020a12"), hex_rgb("#04121c"),
            hex_rgb("#061925"), hex_rgb("#081d29"), hex_rgb("#061720")]
    base = np.zeros((H, 3), dtype=np.float32)
    for ch in range(3):
        base[:, ch] = np.interp(lat_abs, stops[::-1], [c[ch] for c in cols][::-1])
    arr = np.repeat(base[:, None, :], W, axis=1)

    # mid-frequency current-like texture, gently modulated so it never bands
    ocean_noise = noise_image(W, H, 90, 7, contrast=1.0)
    ocean_noise = np.asarray(
        Image.fromarray((ocean_noise * 255).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(2))).astype(np.float32) / 255.0
    arr += (ocean_noise[..., None] - 0.5) * 6.0
    ocean = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    # graticule on the ocean
    grat = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grat)
    for lon in range(-180, 181, 15):
        x = (lon + 180) / 360 * W
        gd.line([(x, 0), (x, H)], fill=(120, 165, 190, 15), width=1)
    for lat in range(-75, 76, 15):
        yy = (90 - lat) / 180 * H
        w = 2 if lat == 0 else 1
        gd.line([(0, yy), (W, yy)], fill=(120, 165, 190, 20 if lat == 0 else 13), width=w)
    ocean = Image.alpha_composite(ocean.convert("RGBA"), grat).convert("RGB")

    # shallow shelf: draw fat blurred coastline strokes in a lighter blue
    shelf = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shelf)
    for pts in land_rings:
        if len(pts) < 3:
            continue
        sd.line(pts + [pts[0]], fill=255, width=13, joint="curve")
    shelf = shelf.filter(ImageFilter.GaussianBlur(5))
    shelf_np = np.asarray(shelf).astype(np.float32) / 255.0
    o = np.asarray(ocean).astype(np.float32)
    shelf_col = np.array(hex_rgb("#0d3143"), dtype=np.float32)
    o = o * (1 - shelf_np[..., None] * 0.5) + shelf_col * (shelf_np[..., None] * 0.5)
    ocean = Image.fromarray(np.clip(o, 0, 255).astype(np.uint8), "RGB")

    # ----------------------------------------------------------------- land
    land_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(land_img)
    # soft dark rim under the coast so land reads as raised
    rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    for pts in land_rings:
        if len(pts) >= 3:
            rd.line(pts + [pts[0]], fill=(2, 8, 14, 235), width=9, joint="curve")
    land_img = Image.alpha_composite(land_img, rim)

    fill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fill)
    draw_rings(fd, land_rings, fill=hex_rgb("#1d2a24") + (255,))
    draw_rings(fd, lake_rings, fill=hex_rgb("#05121a") + (255,))

    # land shading: low-frequency noise + latitude tint
    ln = noise_image(W, H, 40, 21, contrast=1.0)
    la = np.asarray(fill).astype(np.float32)
    mask = (la[..., 3:4] / 255.0)
    tint = 0.86 + ln[..., None] * 0.26
    la[..., :3] = la[..., :3] * tint
    # slightly lighter toward the tropics / darker toward poles
    latv = np.abs((np.linspace(0, 1, H) - 0.5) * 2)[:, None]
    la[..., :3] *= (1.0 - latv[..., None] * 0.18)
    la[..., 3:4] = mask * 255.0
    fill = Image.fromarray(np.clip(la, 0, 255).astype(np.uint8), "RGBA")
    land_img = Image.alpha_composite(land_img, fill)

    # coastline stroke
    coast = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(coast)
    for pts in land_rings:
        if len(pts) >= 3:
            cd.line(pts + [pts[0]], fill=(74, 100, 96, 170), width=2, joint="curve")
    for pts in lake_rings:
        if len(pts) >= 3:
            cd.line(pts + [pts[0]], fill=(48, 76, 90, 110), width=1, joint="curve")
    land_img = Image.alpha_composite(land_img, coast)

    base_img = Image.alpha_composite(ocean.convert("RGBA"), land_img)

    # very light vignette in latitude to sell the sphere shading
    va = np.asarray(base_img).astype(np.float32)
    shade = 1.0 - 0.16 * np.clip((np.abs(np.linspace(0, 1, H) - 0.5) * 2 - 0.55) / 0.45, 0, 1)[:, None, None]
    va[..., :3] *= shade
    out = Image.fromarray(np.clip(va, 0, 255).astype(np.uint8), "RGBA").convert("RGB")

    os.makedirs(ASSETS, exist_ok=True)
    out.save(os.path.join(ASSETS, "globe_color.jpg"), quality=90, subsampling=0, optimize=True)
    print("wrote globe_color.jpg")

    # ------------------------------------------------------------- specular
    sw, sh = 2048, 1024
    spec = Image.new("L", (sw, sh), 255)
    sp = ImageDraw.Draw(spec)
    scale = sw / W
    for pts in land_rings:
        if len(pts) >= 3:
            sp.polygon([(x * scale, y * scale) for x, y in pts], fill=18)
    for pts in lake_rings:
        if len(pts) >= 3:
            sp.polygon([(x * scale, y * scale) for x, y in pts], fill=210)
    spec = spec.filter(ImageFilter.GaussianBlur(1.2))
    spec.save(os.path.join(ASSETS, "globe_spec.png"), optimize=True)
    print("wrote globe_spec.png")

    # preview thumbnail for visual QA
    out.resize((1280, 640), Image.LANCZOS).save(os.path.join(WORK, "preview_globe.png"))


if __name__ == "__main__":
    main()
