"""Build the typhoon teaching case + coastline overlay.

Outputs (all as classic scripts so the app also runs straight from file://):
  data/typhoon.data.js  -> window.TYPHOON_DATA = {meta, track}
  data/coast.data.js    -> window.COAST_DATA   = {bodies, lines}

Deterministic. Usage: python -I tools/gen_typhoon.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".work")
DATA = os.path.join(ROOT, "data")

R_EARTH = 6371.0088  # km
BOX = (110.0, 18.0, 131.0, 35.0)


def haversine(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(a)))


def bearing(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
                  (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                  (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def smoothstep(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- coastline
def dp_simplify(pts, eps):
    if len(pts) < 3:
        return pts
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    if math.hypot(dx, dy) < 1e-7:
        # closed ring (island outline): split at the point farthest from the
        # start so the recursion has a non-degenerate baseline
        far = max(range(1, len(pts)),
                  key=lambda i: (pts[i][0] - x1) ** 2 + (pts[i][1] - y1) ** 2)
        return (dp_simplify(pts[:far + 1], eps)[:-1] +
                dp_simplify(pts[far:], eps))
    norm = math.hypot(dx, dy) or 1e-9
    dmax, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp_simplify(pts[:idx + 1], eps)[:-1] + dp_simplify(pts[idx:], eps)
    return [pts[0], pts[-1]]


def classify(pts):
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    mlon, mlat = sum(lons) / len(lons), sum(lats) / len(lats)
    w, h = max(lons) - min(lons), max(lats) - min(lats)
    if w > 6.0 or (w > 3.0 and mlon < 121.0):
        return "mainland"
    if 119.6 <= mlon <= 122.2 and 21.8 <= mlat <= 25.4 and w < 2.4 and h > 2.2:
        return "taiwan"
    if 108.0 <= mlon <= 111.4 and 17.8 <= mlat <= 20.3:
        return "hainan"
    if mlon >= 126.5:
        return "islands"
    # short fragments in the core theatre: Zhoushan / Chongming / Fujian islets
    if 117.5 <= mlon <= 124.5 and 22.5 <= mlat <= 32.0 and h + w > 0.12:
        return "islet"
    return "other"


def build_coast():
    with open(os.path.join(WORK, "coastline10.geojson"), "r", encoding="utf-8") as fh:
        data = json.load(fh)

    def inb(p, pad=0.0):
        return (BOX[0] - pad <= p[0] <= BOX[2] + pad and
                BOX[1] - pad <= p[1] <= BOX[3] + pad)

    runs = []
    for feat in data["features"]:
        g = feat["geometry"]
        if g is None or g["type"] not in ("LineString", "MultiLineString"):
            continue
        chains = ([g["coordinates"]] if g["type"] == "LineString"
                  else list(g["coordinates"]))
        for c in chains:
            cur = []
            for p in c:
                if inb(p, 0.6):
                    cur.append((p[0], p[1]))
                else:
                    if len(cur) > 14:
                        runs.append(cur)
                    cur = []
            if len(cur) > 14:
                runs.append(cur)

    # simplify, keep meaningful strokes
    lines = []
    for run in runs:
        kind = classify(run)
        if kind == "other":
            continue
        # trim to the box proper
        sub, best, c = [], [], []
        for p in run:
            if inb(p):
                c.append(p)
            else:
                if len(c) > len(best):
                    best = c
                c = []
        if len(c) > len(best):
            best = c
        if len(best) < 14:
            continue
        eps = 0.0035 if kind in ("mainland", "taiwan") else 0.006
        simp = dp_simplify(best, eps)
        if len(simp) < 4:
            continue
        # polygon area test on the simplified outline: closed island rings
        # are re-emitted without their duplicate end vertex
        a2 = 0.0
        for i in range(len(simp) - 1):
            a2 += simp[i][0] * simp[i + 1][1] - simp[i + 1][0] * simp[i][1]
        if kind in ("taiwan", "hainan") and abs(a2) / 2.0 < 0.02:
            continue
        lines.append({
            "kind": kind,
            "closed": kind in ("taiwan", "hainan"),
            "pts": [[round(a, 4), round(b, 4)] for a, b in simp],
        })

    lines.sort(key=lambda l: len(l["pts"]), reverse=True)
    return lines


# ---------------------------------------------------------------- track
TRACK = [
    (0,   136.4, 12.6),
    (12,  134.4, 13.6),
    (24,  132.3, 14.9),
    (36,  130.3, 16.4),
    (48,  128.4, 18.2),
    (60,  126.7, 20.3),
    (72,  125.3, 22.5),
    (82,  124.5, 24.3),
    (90,  124.0, 25.7),
    (96,  123.7, 26.9),   # peak intensity — ~150 km off Zhejiang
    (102, 123.2, 27.6),
    (108, 122.4, 28.3),   # landfall
    (114, 121.4, 29.0),
    (120, 120.3, 29.7),
    (126, 119.2, 30.4),
]

INTEN = [
    (0,   17.0, 1000),
    (12,  20.5, 995),
    (24,  24.0, 990),
    (36,  28.5, 983),
    (48,  33.5, 974),
    (60,  39.5, 962),
    (72,  47.0, 948),
    (82,  54.0, 934),
    (90,  60.5, 921),
    (96,  65.0, 909),    # peak
    (102, 60.0, 920),
    (108, 49.0, 947),    # landfall
    (114, 36.0, 970),
    (120, 25.0, 986),
    (126, 16.0, 997),
]

HOURS = 126
PEAK_H = 96


def interp_ctrl(ctrl, u, col):
    vals = [row[col] for row in ctrl]
    times = [row[0] for row in ctrl]
    if u <= times[0]:
        return vals[0]
    if u >= times[-1]:
        return vals[-1]
    for k in range(len(times) - 1):
        if times[k] <= u <= times[k + 1]:
            t = (u - times[k]) / (times[k + 1] - times[k])
            return catmull(vals[max(0, k - 1)], vals[k], vals[k + 1],
                           vals[min(len(vals) - 1, k + 2)], t)
    return vals[-1]


def category(v):
    if v < 17.2:
        return "TD", "热带低压"
    if v < 24.5:
        return "TS", "热带风暴"
    if v < 32.7:
        return "STS", "强热带风暴"
    if v < 41.5:
        return "TY", "台风"
    if v < 51.0:
        return "STY", "强台风"
    return "SuperTY", "超强台风"


def quad_index(lon, lat, clon, clat):
    b = bearing(clon, clat, lon, lat)
    return int(b // 90) % 4  # NE SE SW NW


def build_track(coast_pts):
    pts = [(interp_ctrl(TRACK, h, 1), interp_ctrl(TRACK, h, 2))
           for h in range(HOURS + 1)]

    out = []
    for h in range(HOURS + 1):
        lon, lat = pts[h]
        vmax = max(10.0, interp_ctrl(INTEN, h, 1))
        mslp = interp_ctrl(INTEN, h, 2)

        i0, i1 = max(0, h - 3), min(HOURS, h + 3)
        spd = haversine(pts[i0][0], pts[i0][1], pts[i1][0], pts[i1][1]) / max(1e-6, i1 - i0)
        hdg = bearing(pts[i0][0], pts[i0][1], pts[i1][0], pts[i1][1])

        # A broad ramp (the storm leaving the deep basin for the shelf) with a
        # sharp superimposed kick just before peak — together they give the
        # gale field its pronounced "ballooning" as it closes on the coast.
        ramp = 0.55 * smoothstep(70.0, 96.0, h) + 0.45 * smoothstep(84.0, 97.0, h)
        coastal = ramp * (1.0 - smoothstep(104.0, 120.0, h))
        m34 = (92.0 + 2.02 * vmax) * (1.0 + 0.62 * coastal)
        m50 = max(0.0, 3.00 * (vmax - 20.0)) * (1.0 + 0.42 * coastal)
        m64 = max(0.0, 2.55 * (vmax - 32.0)) * (1.0 + 0.30 * coastal)

        hd = math.radians(hdg)
        qbear = [45.0, 135.0, 225.0, 315.0]
        scores = []
        for b in qbear:
            r = math.radians(b)
            # right-of-motion dominant, mild forward preference
            scores.append(0.66 * math.cos(r - hd - math.pi / 2) +
                          0.34 * math.cos(r - hd))
        k = min(0.50, 0.21 + 0.0058 * spd)
        mults = [1.0 + k * s for s in scores]
        mm = sum(mults) / 4.0
        mults = [m / mm for m in mults]

        quad34 = [round(m34 * m, 1) for m in mults]
        quad50 = [round(m50 * m, 1) for m in mults]
        quad64 = [round(m64 * m, 1) for m in mults]

        rain = min(96.0, 0.34 * max(0.0, vmax - 13.0) ** 1.34)
        if h > 96:
            rain *= 1.0 + 0.12 * smoothstep(96, 110, h)

        dist = min(haversine(lon, lat, c[0], c[1]) for c in coast_pts)

        out.append({
            "h": h,
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "vmax": round(vmax, 1),
            "mslp": round(mslp, 0),
            "cat": category(vmax)[0],
            "catName": category(vmax)[1],
            "dir": round(hdg, 1),
            "speed": round(spd, 1),
            "r34": quad34,
            "r50": quad50,
            "r64": quad64,
            "rain": round(rain, 1),
            "distCoast": round(dist, 1),
        })
    return out


def exposure(track, coast_lines):
    """For each hour: km of major coast inside the R34 field.

    Only the three bodies that matter for the narrative (mainland, Taiwan,
    Hainan) are counted — small islets would inflate the number without
    saying anything about population exposure.
    """
    sel = [l for l in coast_lines if l["kind"] in ("mainland", "taiwan", "hainan")]
    series = []
    for p in track:
        cov = 0.0
        for line in sel:
            pts = line["pts"]
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]
                seg = haversine(a[0], a[1], b[0], b[1])
                # 3 sub-samples per segment
                for s in (0.17, 0.5, 0.83):
                    lo = a[0] + (b[0] - a[0]) * s
                    la = a[1] + (b[1] - a[1]) * s
                    d = haversine(p["lon"], p["lat"], lo, la)
                    q = quad_index(lo, la, p["lon"], p["lat"])
                    if d <= p["r34"][q]:
                        cov += seg / 3.0
        series.append(round(cov, 1))
    return series


def main():
    os.makedirs(DATA, exist_ok=True)
    coast = build_coast()
    kinds = {}
    for l in coast:
        kinds[l["kind"]] = kinds.get(l["kind"], 0) + 1
    print("coast lines", len(coast), kinds,
          "pts", sum(len(l["pts"]) for l in coast))

    all_pts = [tuple(p) for l in coast if l["kind"] in ("mainland", "taiwan", "hainan")
               for p in l["pts"]]
    track = build_track(all_pts)
    expo = exposure(track, coast)

    # Light 3-tap smoothing: the raw metric flickers when a ragged headland
    # clips the quadrant boundary for a single hour. The trend is preserved.
    sm = []
    for i in range(len(expo)):
        a = expo[max(0, i - 1)]
        b = expo[i]
        c = expo[min(len(expo) - 1, i + 1)]
        sm.append(round((a + 2 * b + c) / 4.0, 1))
    expo = sm

    peak = max(track, key=lambda p: p["vmax"])
    print("peak h=%d V=%.1f @ %.2f,%.2f dCoast=%.0f" % (
        peak["h"], peak["vmax"], peak["lon"], peak["lat"], peak["distCoast"]))
    for h in list(range(0, HOURS + 1, 6)):
        p = track[h]
        print("h%3d %.2f,%.2f V=%5.1f R34=%s dC=%5.0f expo=%6.0f rain=%4.1f" % (
            h, p["lon"], p["lat"], p["vmax"],
            "/".join("%3.0f" % v for v in p["r34"]), p["distCoast"], expo[h], p["rain"]))
    first = next((i for i, e in enumerate(expo) if e > 0), None)
    print("coastal exposure starts h=%s, peak exposure %.0f km at h=%d" % (
        first, max(expo), expo.index(max(expo))))

    lf = next((p["h"] for p in track if p["distCoast"] < 12.0), None)

    # ---- per-point cumulative arc length (for path ribbon / scrubbing)
    meta = {
        "name": "凌霄",
        "nameEn": "LINGXIAO",
        "case": "东海近海增强 · 浙江登陆",
        "basin": "西北太平洋",
        "synthetic": True,
        "note": "教学用合成个例：路径、强度与四象限风圈按东海近海增强型台风（参考 2019 利奇马、2006 桑美）标定，非真实观测。",
        "startISO": "2026-08-11T08:00:00+08:00",
        "intervalHours": 1,
        "hours": HOURS,
        "peakHour": peak["h"],
        "peak": {"vmax": peak["vmax"], "mslp": peak["mslp"],
                 "lon": peak["lon"], "lat": peak["lat"]},
        "landfallHour": lf,
        "coastExposureStart": first,
        "coastExposureMax": max(expo),
        "quadrants": ["NE", "SE", "SW", "NW"],
        "quadrantsCN": ["东北", "东南", "西南", "西北"],
        "levels": [
            {"key": "r34", "cn": "七级风圈", "ms": 13.9, "color": "#2fd9c5"},
            {"key": "r50", "cn": "十级风圈", "ms": 24.5, "color": "#ffc247"},
            {"key": "r64", "cn": "十二级风圈", "ms": 32.7, "color": "#ff5d4d"},
        ],
        "landLabels": [
            {"name": "浙江", "lon": 121.4, "lat": 29.2},
            {"name": "福建", "lon": 118.3, "lat": 25.6},
            {"name": "台湾", "lon": 121.0, "lat": 23.7},
            {"name": "上海", "lon": 121.6, "lat": 31.3},
            {"name": "琉球群岛", "lon": 127.9, "lat": 26.4},
            {"name": "东海", "lon": 124.6, "lat": 28.6, "sea": True},
        ],
        "exposure": expo,
    }

    payload = {"meta": meta, "track": track}
    js = ("/* generated by tools/gen_typhoon.py — do not edit */\n"
          "window.TYPHOON_DATA = " +
          json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(os.path.join(DATA, "typhoon.data.js"), "w", encoding="utf-8") as fh:
        fh.write(js)

    cjs = ("/* generated by tools/gen_typhoon.py — do not edit */\n"
           "window.COAST_DATA = " +
           json.dumps({"lines": coast}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(os.path.join(DATA, "coast.data.js"), "w", encoding="utf-8") as fh:
        fh.write(cjs)

    for f in ("typhoon.data.js", "coast.data.js"):
        print("%-18s %.1f KB" % (f, os.path.getsize(os.path.join(DATA, f)) / 1024))


if __name__ == "__main__":
    main()
