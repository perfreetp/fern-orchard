/* ============================================================
   geo.js — spherical helpers, great-circle paths, local frames
   ============================================================ */
(function (global) {
  "use strict";

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var R_KM = 6371.0088;

  /* ---------- lat/lon ⇄ unit vector (Babylon is left-handed, y up) ---------- */
  function toVec(lat, lon, out) {
    var la = lat * D2R, lo = lon * D2R;
    var cl = Math.cos(la);
    out = out || { x: 0, y: 0, z: 0 };
    // lon 0 => +z, lon +90 => +x, north => +y
    out.x = cl * Math.sin(lo);
    out.y = Math.sin(la);
    out.z = cl * Math.cos(lo);
    return out;
  }

  function toLatLon(v) {
    var len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    var x = v.x / len, y = v.y / len, z = v.z / len;
    return {
      lat: Math.asin(Math.max(-1, Math.min(1, y))) * R2D,
      lon: Math.atan2(x, z) * R2D
    };
  }

  /* ---------- great-circle interpolation (slerp) ---------- */
  function slerp(a, b, t, out) {
    var dot = a.x * b.x + a.y * b.y + a.z * b.z;
    dot = Math.max(-1, Math.min(1, dot));
    var omega = Math.acos(dot);
    out = out || { x: 0, y: 0, z: 0 };
    if (omega < 1e-6) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
    var so = Math.sin(omega);
    var k1 = Math.sin((1 - t) * omega) / so;
    var k2 = Math.sin(t * omega) / so;
    out.x = a.x * k1 + b.x * k2;
    out.y = a.y * k1 + b.y * k2;
    out.z = a.z * k1 + b.z * k2;
    var l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z) || 1;
    out.x /= l; out.y /= l; out.z /= l;
    return out;
  }

  function distKm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R;
    var dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /* ---------- local tangent frame at a surface point ----------
     returns {up, east, north} so callers can build rings in metres       */
  function frame(lat, lon) {
    var up = toVec(lat, lon);
    var la = lat * D2R, lo = lon * D2R;
    // east  = d/dlon
    var east = { x: Math.cos(lo), y: 0, z: -Math.sin(lo) };
    // north = d/dlat
    var north = {
      x: -Math.sin(la) * Math.sin(lo),
      y: Math.cos(la),
      z: -Math.sin(la) * Math.cos(lo)
    };
    return { up: up, east: east, north: north };
  }

  /* a point on the sphere at (azimuth°, distance km) from (lat, lon) */
  function destination(lat, lon, azDeg, distKm) {
    var d = distKm / R_KM;
    var p1 = lat * D2R, l1 = lon * D2R, b = azDeg * D2R;
    var sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
    sinP2 = Math.max(-1, Math.min(1, sinP2));
    var p2 = Math.asin(sinP2);
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * sinP2);
    return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function smoother(t) { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }

  /* monotone cubic (Fritsch–Carlson) sampler over unevenly spaced data —
     used for radius curves so the wind field never overshoots                  */
  function Monotone(xs, ys) {
    var n = xs.length;
    var d = new Array(n - 1);
    for (var i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    var m = new Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (var j = 1; j < n - 1; j++) {
      if (d[j - 1] * d[j] <= 0) m[j] = 0;
      else {
        var w1 = 2 * (xs[j + 1] - xs[j]) + (xs[j] - xs[j - 1]);
        var w2 = (xs[j + 1] - xs[j]) + 2 * (xs[j] - xs[j - 1]);
        m[j] = (w1 + w2) / (w1 / d[j - 1] + w2 / d[j]);
      }
    }
    this.xs = xs; this.ys = ys; this.m = m; this.n = n;
  }
  Monotone.prototype.at = function (x) {
    var xs = this.xs, ys = this.ys, m = this.m, n = this.n;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    var h = xs[hi] - xs[lo];
    var t = (x - xs[lo]) / h;
    var t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * m[hi];
  };

  global.GEO = {
    D2R: D2R, R2D: R2D, R_KM: R_KM,
    toVec: toVec, toLatLon: toLatLon, slerp: slerp,
    distKm: distKm, bearingDeg: bearingDeg,
    frame: frame, destination: destination,
    clamp: clamp, lerp: lerp, smooth: smooth, smoother: smoother,
    Monotone: Monotone
  };
})(window);
