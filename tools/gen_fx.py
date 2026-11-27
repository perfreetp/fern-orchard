"""Generate sprite textures for the storm: cyclone cloud shield, rain streak,
soft glow. Deterministic.

Usage: python -I tools/gen_fx.py
"""
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def fbm(w, h, octaves=5, seed=3, base=8):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gw = max(2, base * 2 ** o)
        gh = max(2, int(gw * h / w))
        g = rng.random((gh, gw)).astype(np.float32)
        img = Image.fromarray((g * 255).astype(np.uint8), "L").resize((w, h), Image.BICUBIC)
        out += (np.asarray(img).astype(np.float32) / 255.0) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def warp(a, dx, dy):
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sx = np.clip(xx + dx * w, 0, w - 1).astype(np.int32)
    sy = np.clip(yy + dy * h, 0, h - 1).astype(np.int32)
    return a[sy, sx]


def cyclone(size=768):
    n = size
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    cx = cy = (n - 1) / 2.0
    X = (x - cx) / (n / 2.0)
    Y = (y - cy) / (n / 2.0)
    R = np.sqrt(X * X + Y * Y)
    TH = np.arctan2(Y, X)

    # turbulent cloud texture
    turb = fbm(n, n, octaves=6, seed=11, base=6)
    turb = warp(turb, fbm(n, n, 4, 23, 5) - 0.5, fbm(n, n, 4, 37, 5) - 0.5)

    # log-spiral bands, sheared so they wind inward
    Rc = np.maximum(R, 1e-4)
    spiral = np.sin(TH * 3.0 + np.log(Rc + 0.035) * 9.5 + turb * 3.4)
    bands = 0.5 + 0.5 * spiral

    # asymmetric outflow: heavier on the north/east (right of motion) side
    asym = 0.72 + 0.28 * np.cos(TH - 0.9)
    # a broader shield skewed to one side
    skew = np.clip(1.0 - np.abs(Y * 0.9 - X * 0.42), 0, 1)

    # radial envelope: clear eye, sharp eyewall, long tail
    eye = np.clip((R - 0.075) / 0.045, 0, 1)                 # 0 inside eye
    eyewall = np.exp(-((R - 0.150) / 0.052) ** 2) * 1.15      # bright eyewall ring
    skirt = np.clip(1.0 - R / 1.0, 0, 1) ** 1.20

    a = (bands ** 2.0) * skirt * asym * (0.34 + 0.66 * skew)
    a = a * 1.15 + 0.22 * turb * skirt
    a = np.maximum(a, eyewall * 0.70)

    a *= eye
    a = np.clip(a, 0, 1)
    # soft outer falloff so the cap has no hard edge
    a *= np.clip((1.0 - R / 1.0) / 0.20, 0, 1) ** 0.7
    a[R > 1.02] = 0

    # a final gentle blur to take the pixel edge off
    aimg = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "L")
    aimg = aimg.filter(ImageFilter.GaussianBlur(n / 400.0))

    A = np.asarray(aimg).astype(np.float32) / 255.0
    # colour: cool white core, faint steel-blue rim
    core = np.array([235, 245, 255], dtype=np.float32)
    rim = np.array([150, 198, 224], dtype=np.float32)
    t = np.clip(R, 0, 1)[..., None]
    rgb = core * (1 - t) + rim * t
    out = np.zeros((n, n, 4), dtype=np.uint8)
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(A * 255 * 0.92, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def starfield(w=2048, h=1024):
    rng = np.random.default_rng(99)
    img = np.zeros((h, w, 3), dtype=np.float32)
    # faint galactic band
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    band = np.exp(-((yy / h - 0.55 - 0.13 * np.sin(xx / w * 5.4)) ** 2) / 0.012)
    neb = fbm(w, h, 6, 5, 5)
    img += band[..., None] * (0.030 + 0.055 * neb[..., None]) * np.array([0.55, 0.68, 0.95])

    n = 5200
    xs = rng.integers(0, w, n)
    ys = rng.integers(0, h, n)
    mag = rng.random(n) ** 2.6
    tint = rng.random(n)
    for i in range(n):
        b = 0.25 + 0.75 * mag[i]
        col = np.array([b, b, b]) * (0.85 + 0.25 * tint[i])
        col = np.clip(col, 0, 1)
        # small sparkle footprint
        img[ys[i], xs[i]] = np.maximum(img[ys[i], xs[i]], col * 0.9)
        if mag[i] > 0.55:
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                yy2, xx2 = (ys[i] + dy) % h, (xs[i] + dx) % w
                img[yy2, xx2] = np.maximum(img[yy2, xx2], col * 0.22)

    out = Image.fromarray((np.clip(img, 0, 1) ** (1 / 1.05) * 255).astype(np.uint8), "RGB")
    out = out.filter(ImageFilter.GaussianBlur(0.6))
    return out


def main():
    os.makedirs(ASSETS, exist_ok=True)
    # rain streaks and the marker halo are drawn procedurally in the shaders,
    # so only these two textures need baking
    cyclone(768).save(os.path.join(ASSETS, "cyclone.png"), optimize=True)
    starfield().save(os.path.join(ASSETS, "stars.jpg"), quality=88, optimize=True)
    for f in ("cyclone.png", "stars.jpg"):
        print(f, "%.1f KB" % (os.path.getsize(os.path.join(ASSETS, f)) / 1024))


if __name__ == "__main__":
    main()
