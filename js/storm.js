/* ============================================================
   storm.js — the typhoon: track, asymmetric wind field, coast
   exposure highlight, rain particles, cyclone cloud cap
   ============================================================ */
(function (global) {
  "use strict";

  var GEO = global.GEO;
  var B = global.BABYLON;

  var Q_CENTERS = [45, 135, 225, 315]; // NE SE SW NW
  var LEVELS = ["r34", "r50", "r64"];
  var LIFT = { r34: 0.020, r50: 0.030, r64: 0.040, cloud: 0.075, path: 0.052 };
  var FAN_SEGS = 120;
  var FAN_RINGS = 5;

  /* ------------------------------------------------------------ radius */
  /* Real bulletins quote wind radii fixed to true north in four quadrants,
     which produces a visibly stepped, asymmetric outline. A narrow blend
     (BLEND_DEG) across each quadrant boundary keeps the silhouette continuous
     without rounding away the four distinct sectors.                        */
  var BLEND_DEG = 7.0;
  function sectorRadius(R, azDeg) {
    var a = ((azDeg % 360) + 360) % 360;
    var q = Math.floor(a / 90);
    var local = a - q * 90;            // 0..90 within the quadrant
    var h = BLEND_DEG * 0.5;
    if (local < h) {
      // blend with the previous quadrant across the boundary
      var prev = (q + 3) % 4;
      var t = 0.5 + local / (2 * h);   // 0.5 → 1
      return GEO.lerp(R[prev], R[q], smoothstep01(t));
    }
    if (local > 90 - h) {
      var nxt = (q + 1) % 4;
      var t2 = (local - (90 - h)) / (2 * h); // 0 → 0.5
      return GEO.lerp(R[q], R[nxt], smoothstep01(t2));
    }
    return R[q];
  }
  function smoothstep01(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  /* ------------------------------------------------------------ shaders */
  function registerShaders() {
    var S = B.Effect.ShadersStore;

    S["wdFanVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal; attribute vec2 uv;",
      "uniform mat4 worldViewProjection;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vUV=uv; vN=normal; vW=position;",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");

    S["wdFanFragmentShader"] = [
      "precision highp float;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "uniform vec3 uCam; uniform vec3 uColor; uniform float uTime;",
      "uniform float uAlpha; uniform float uRim; uniform float uIsTop; uniform float uFill;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " if (dot(normalize(vN), V) < 0.045) discard;",
      " float u = clamp(vUV.x, 0.0, 1.0);",
      " float az = vUV.y;",
      // soft concentric echo rings, drifting slowly outward
      " float ring = 0.5 + 0.5*sin((u*4.0 - uTime*0.16)*6.2831);",
      " ring = pow(ring, 6.0) * smoothstep(0.04, 0.30, u) * (1.0 - smoothstep(0.86, 0.99, u));",
      // body: a quiet translucent wash that deepens toward the edge
      " float body = smoothstep(0.0, 0.99, u);",
      " float fill = (0.075 + 0.235*body*body) * uFill;",
      // outline: crisp, one and a half pixels wide at any zoom
      " float rim = smoothstep(0.975, 1.0, u);",
      // quarter dividers, very faint
      " float sect = abs(fract(az*4.0 + 0.5) - 0.5) * 2.0;",
      " float spoke = smoothstep(0.975, 1.0, sect) * smoothstep(0.06, 0.45, u) * (1.0 - smoothstep(0.94, 0.995, u)) * 0.30;",
      " float a = (fill + ring*0.10 + rim*0.95*uRim + spoke) * uAlpha;",
      " a *= mix(1.0, 0.86, uIsTop);",
      // radial ramp: a lighter wash inside, full strength toward the outline
      " a *= mix(0.55, 1.0, smoothstep(0.0, 0.55, u));",
      " vec3 col = mix(uColor*0.95, uColor, body);",
      " col = mix(col, vec3(1.0), rim*0.22);",
      " gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));",
      "}",
    ].join("\n");

    /* ---- path tube ----
       The traversed line is bright right behind the head and fades with age,
       so advancing the marker literally extends a fresh bright line that then
       dims into "already travelled". The untravelled leg stays as a faint
       dashed guide so the user can see where to drag to.                     */
    S["wdPathVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal; attribute float aH;",
      "uniform mat4 worldViewProjection;",
      "varying float vH; varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vH=aH; vN=normal; vW=position;",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");
    S["wdPathFragmentShader"] = [
      "precision highp float;",
      "varying float vH; varying vec3 vN; varying vec3 vW;",
      "uniform vec3 uCam; uniform float uNow; uniform float uTime;",
      "uniform float uReveal; uniform float uHours;",
      "uniform vec3 uSpent; uniform vec3 uFresh; uniform vec3 uGuide; uniform vec3 uHead;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " if (dot(normalize(vN), V) < 0.02) discard;",
      " float ahead = step(uNow, vH);",
      " float ageH = (uNow - vH) * uHours;",
      " float fresh = 1.0 - smoothstep(0.0, uReveal, max(ageH, 0.0));",
      " vec3 travelled = mix(uSpent, uFresh, fresh);",
      " float aTrav = mix(0.30, 0.95, fresh);",
      // faint flowing dashes on the not-yet-travelled leg
      " float flow = fract((vH*54.0) - uTime*0.5);",
      " float dash = smoothstep(0.42, 0.92, flow)*0.65 + 0.35;",
      " float aGuide = 0.20 * dash;",
      " float nearNow = 1.0 - smoothstep(0.0, 0.012, abs(vH-uNow));",
      " vec3 col = mix(travelled, uGuide, ahead);",
      " float a = mix(aTrav, aGuide, ahead);",
      " col = mix(col, uHead, nearNow);",
      " a = mix(a, 1.0, nearNow);",
      " gl_FragColor = vec4(col, a);",
      "}",
    ].join("\n");

    /* ---- coastline ribbon (screen-constant width) ---- */
    S["wdCoastVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 aPerp; attribute float aSide;",
      "attribute float aCov; attribute float aKm;",
      "uniform mat4 worldViewProjection; uniform vec3 uCam; uniform float uWorldPerPix;",
      "uniform float uWidth;",
      "varying float vSide; varying float vCov; varying vec3 vCol;",
      "void main(void){",
      " float dist = length(uCam - position);",
      " float w = uWidth * dist * uWorldPerPix;",
      " vec3 p = position + aPerp*aSide*w;",
      " vSide = aSide; vCov = aCov; vCol = position;",
      " gl_Position = worldViewProjection*vec4(p,1.0);",
      "}",
    ].join("\n");
    S["wdCoastFragmentShader"] = [
      "precision highp float;",
      "varying float vSide; varying float vCov; varying vec3 vCol;",
      "uniform vec3 uDim; uniform vec3 uMid; uniform vec3 uHot; uniform float uTime;",
      "void main(void){",
      " float e = 1.0 - abs(vSide);",
      " float core = pow(clamp(e,0.0,1.0), 2.2);",
      " float halo = pow(clamp(e,0.0,1.0), 0.9)*0.35;",
      " float pulse = 0.70 + 0.30*sin(uTime*3.2);",
      " vec3 col = mix(uDim, uMid, 0.5+vCov*0.5);",
      " col = mix(col, uHot, vCov) * mix(1.0, pulse, vCov);",
      " float a = (core*0.92 + halo) * mix(0.62, 1.0, vCov);",
      " gl_FragColor = vec4(col, clamp(a,0.0,1.0));",
      "}",
    ].join("\n");

    /* ---- cyclone cloud cap ---- */
    S["wdCloudVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal; attribute vec2 uv;",
      "uniform mat4 worldViewProjection;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "void main(void){",
      " vUV=uv; vN=normal; vW=position;",
      " gl_Position = worldViewProjection*vec4(position,1.0);",
      "}",
    ].join("\n");
    S["wdCloudFragmentShader"] = [
      "precision highp float;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "uniform sampler2D uTex; uniform vec3 uCam; uniform float uTime;",
      "uniform float uAlpha; uniform float uSpin; uniform float uZoom;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " vec3 N = normalize(vN);",
      " float facing = dot(N, V);",
      " if (facing < 0.02) discard;",
      " vec2 c = vUV - 0.5;",
      " float r = length(c) * 2.0;",
      // the texture is sampled inside a disc; the disc shrinks its sampling
      // radius slightly with zoom so band detail does not turn to mush
      " float s = sin(uSpin), co = cos(uSpin);",
      " vec2 rc = vec2(c.x*co - c.y*s, c.x*s + c.y*co);",
      " rc *= mix(1.0, 0.78, uZoom);",
      " vec2 uv = rc + 0.5;",
      " vec4 t = texture2D(uTex, clamp(uv, 0.001, 0.999));",
      // fades out at the silhouette and again at the disc edge
      " float limb = smoothstep(0.02, 0.42, facing);",
      " float edge = 1.0 - smoothstep(0.80, 0.995, r);",
      " float a = t.a * uAlpha * limb * edge;",
      " vec3 col = mix(t.rgb, vec3(0.72,0.84,0.96), 0.18);",
      " gl_FragColor = vec4(col, a);",
      "}",
    ].join("\n");

    /* ---- rain streaks (billboarded, GPU-animated) ----
       The four quadrant radii go in as a single vec4 and are selected by
       component — GLSL ES 1.0 cannot index a vec4 with a loop variable.    */
    S["wdRainVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec2 aCorner; attribute float aIdx;",
      "attribute vec4 aInst;", // az, radFrac, phase, speed
      "uniform mat4 worldViewProjection; uniform vec2 uRes;",
      "uniform vec3 uUp; uniform vec3 uEast; uniform vec3 uNorth;",
      "uniform vec4 uR; uniform float uPlanetR; uniform float uKmPerUnit;",
      "uniform float uTopKm; uniform float uTime; uniform float uCount;",
      "uniform float uSwirl; uniform float uPixH; uniform float uPixW;",
      "varying float vA; varying vec2 vC; varying float vH;",
      "float blendR(float az){",
      " float s=0.0, w=0.0;",
      " float d; float ad; float ww;",
      " d = mod(az - 45.0 + 540.0, 360.0) - 180.0; ad = abs(d);",
      " if(ad<90.0){ ww=0.5*(1.0+cos(3.14159265*d/90.0)); s+=uR.x*ww; w+=ww; }",
      " d = mod(az - 135.0 + 540.0, 360.0) - 180.0; ad = abs(d);",
      " if(ad<90.0){ ww=0.5*(1.0+cos(3.14159265*d/90.0)); s+=uR.y*ww; w+=ww; }",
      " d = mod(az - 225.0 + 540.0, 360.0) - 180.0; ad = abs(d);",
      " if(ad<90.0){ ww=0.5*(1.0+cos(3.14159265*d/90.0)); s+=uR.z*ww; w+=ww; }",
      " d = mod(az - 315.0 + 540.0, 360.0) - 180.0; ad = abs(d);",
      " if(ad<90.0){ ww=0.5*(1.0+cos(3.14159265*d/90.0)); s+=uR.w*ww; w+=ww; }",
      " return w>1e-5 ? s/w : uR.x;",
      "}",
      "void main(void){",
      " vC = aCorner;",
      " if (aIdx > uCount) { gl_Position = vec4(2.0,2.0,2.0,1.0); vA=0.0; vH=0.0; return; }",
      " float cyc = fract(uTime*aInst.w + aInst.z);",
      " float h = 1.0 - cyc;",              // 1 = cloud top, 0 = surface
      // slow cyclonic swirl plus a per-particle lateral wobble, so the
      // streaks read as a rotating rain shield rather than radial spokes
      " float wob = sin(uTime*(1.1 + aInst.z*2.3) + aInst.z*31.4) * 5.5 + sin(uTime*0.7 + aInst.x) * 3.0;",
      " float az = aInst.x + uSwirl*(1.0-h) + wob*(0.35 + 0.65*(1.0-h));",
      " float rad = blendR(az) * aInst.y;",
      " float ang = rad / 6371.0088;",
      " float azr = radians(az);",
      " vec3 dir = uEast*cos(azr) + uNorth*sin(azr);",
      " vec3 u = uUp*cos(ang) + dir*sin(ang);",
      " float lift = h*uTopKm/uKmPerUnit;",
      " vec3 p = u*(uPlanetR + lift);",
      " vec4 clip = worldViewProjection*vec4(p,1.0);",
      " float px = uPixW * (0.75 + 0.5*aInst.y);",
      " float py = uPixH * (0.8 + 0.5*h);",
      " clip.xy += aCorner*vec2(px,py)*2.0/uRes*clip.w;",
      " gl_Position = clip;",
      " vH = h;",
      " vA = smoothstep(0.0,0.12,cyc) * (1.0-smoothstep(0.72,1.0,cyc));",
      "}",
    ].join("\n");
    S["wdRainFragmentShader"] = [
      "precision highp float;",
      "varying float vA; varying vec2 vC; varying float vH;",
      "uniform vec3 uColor; uniform vec3 uColorHot;",
      "void main(void){",
      " float wx = 1.0 - smoothstep(0.12, 0.5, abs(vC.x));",   // soft across
      " float wy = smoothstep(0.0, 0.30, vC.y + 0.5);",         // dissolve at the tail
      " float a = vA * wx * wy * 0.44;",
      " vec3 col = mix(uColor, uColorHot, smoothstep(0.55,0.98,vH));",
      " gl_FragColor = vec4(col, a);",
      "}",
    ].join("\n");

    /* ---- marker glow ---- */
    S["wdGlowVertexShader"] = [
      "precision highp float;",
      "attribute vec3 position; attribute vec3 normal; attribute vec2 uv;",
      "uniform mat4 worldViewProjection;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "void main(void){ vUV=uv; vN=normal; vW=position;",
      " gl_Position=worldViewProjection*vec4(position,1.0); }",
    ].join("\n");
    S["wdGlowFragmentShader"] = [
      "precision highp float;",
      "varying vec2 vUV; varying vec3 vN; varying vec3 vW;",
      "uniform vec3 uCam; uniform vec3 uColor; uniform float uAlpha; uniform float uTime;",
      "void main(void){",
      " vec3 V = normalize(uCam - vW);",
      " if (dot(normalize(vN), V) < 0.0) discard;",
      " vec2 c = vUV - 0.5;",
      " float r = length(c)*2.0;",
      " float g = pow(clamp(1.0-r,0.0,1.0), 3.4);",
      " float ring = exp(-pow((r-0.72)/0.06,2.0));",
      " float pulse = 0.65+0.35*sin(uTime*2.2);",
      " float a = (g*0.55 + ring*0.5*pulse)*uAlpha;",
      " gl_FragColor = vec4(uColor*(0.7+ring*0.8), a);",
      "}",
    ].join("\n");
  }

  function shaderMat(scene, name, vs, fs, uniforms, attrs, alpha) {
    var m = new B.ShaderMaterial(name, scene, { vertex: vs, fragment: fs }, {
      attributes: attrs,
      uniforms: uniforms,
      needAlphaBlending: alpha !== false,
    });
    m.backFaceCulling = false;
    m.alphaMode = B.Engine.ALPHA_COMBINE;
    m.disableDepthWrite = true;
    return m;
  }

  /* ============================================================
     Storm
     ============================================================ */
  function Storm(scene, globe, data) {
    this.scene = scene;
    this.globe = globe;
    this.R = globe.R;
    this.kmPerUnit = globe.kmPerUnit;
    this.meta = data.meta;
    this.raw = data.track;
    this.coast = global.COAST_DATA.lines;
    this.HOURS = this.raw.length - 1;

    this.time = 0;
    this.state = null;
    this._shaderMats = [];
    this._matsNeedCam = [];

    this._buildCurves();
    this._buildDense();
    this._buildCoast();
    this._buildPath();
    this._buildFans();
    this._buildCloud();
    this._buildRain();
    this._buildMarker();
    this._buildPeak();

    this.setTime(this.meta.peakHour, true);
  }

  /* ---------------------------------------------------------- curves */
  Storm.prototype._buildCurves = function () {
    var n = this.raw.length;
    var xs = [];
    for (var k = 0; k < n; k++) xs.push(k);
    this.curves = {};
    for (var li = 0; li < LEVELS.length; li++) {
      var key = LEVELS[li];
      var arr = [];
      for (var q = 0; q < 4; q++) {
        var ys = this.raw.map(function (p) { return p[key][q]; });
        arr.push(new GEO.Monotone(xs, ys));
      }
      this.curves[key] = arr;
    }
    this.curves.vmax = new GEO.Monotone(xs, this.raw.map(function (p) { return p.vmax; }));
    this.curves.mslp = new GEO.Monotone(xs, this.raw.map(function (p) { return p.mslp; }));
    this.curves.rain = new GEO.Monotone(xs, this.raw.map(function (p) { return p.rain; }));
    this.expo = this.meta.exposure;
  };

  /* dense Catmull-Rom position polyline: SUB samples per hour */
  Storm.prototype._buildDense = function () {
    var SUB = 6;
    var n = this.raw.length;
    var lat = this.raw.map(function (p) { return p.lat; });
    var lon = this.raw.map(function (p) { return p.lon; });
    function cr(v, i, t) {
      var a = v[Math.max(0, i - 1)], b = v[i];
      var c = v[Math.min(n - 1, i + 1)], d = v[Math.min(n - 1, i + 2)];
      var t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 +
        (-a + 3 * b - 3 * c + d) * t3);
    }
    this.SUB = SUB;
    this.dense = [];
    for (var i = 0; i < n - 1; i++) {
      for (var s = 0; s < SUB; s++) {
        var t = s / SUB;
        this.dense.push({ lat: cr(lat, i, t), lon: cr(lon, i, t) });
      }
    }
    this.dense.push({ lat: lat[n - 1], lon: lon[n - 1] });
    // world positions
    for (var j = 0; j < this.dense.length; j++) {
      var v = GEO.toVec(this.dense[j].lat, this.dense[j].lon);
      this.dense[j].v = new B.Vector3(v.x, v.y, v.z);
    }
  };

  Storm.prototype.denseIndex = function (t) {
    var i = Math.max(0, Math.min(this.dense.length - 1.0001, t * this.SUB));
    return i;
  };

  /* ---------------------------------------------------------- sample */
  Storm.prototype.sample = function (t) {
    var H = this.HOURS;
    t = GEO.clamp(t, 0, H);
    var i = this.denseIndex(t);
    var i0 = Math.floor(i), f = i - i0;
    var d0 = this.dense[i0], d1 = this.dense[Math.min(this.dense.length - 1, i0 + 1)];
    var lat = GEO.lerp(d0.lat, d1.lat, f);
    var lon = GEO.lerp(d0.lon, d1.lon, f);

    // motion from the dense polyline (more faithful than the hourly table)
    var a = this.dense[Math.max(0, i0 - 2)], b = this.dense[Math.min(this.dense.length - 1, i0 + 3)];
    var dir = GEO.bearingDeg(a.lat, a.lon, b.lat, b.lon);
    var spd = GEO.distKm(a.lat, a.lon, b.lat, b.lon) / (6 / this.SUB);

    var R34 = [], R50 = [], R64 = [];
    for (var q = 0; q < 4; q++) {
      R34.push(this.curves.r34[q].at(t));
      R50.push(this.curves.r50[q].at(t));
      R64.push(this.curves.r64[q].at(t));
    }
    var vmax = this.curves.vmax.at(t);
    var mslp = this.curves.mslp.at(t);
    var rain = this.curves.rain.at(t);

    // coast distance (only over major land, same basis as the dataset)
    var dC = this._distToMajor(lat, lon);

    return {
      t: t, lat: lat, lon: lon, vmax: vmax, mslp: mslp, rain: rain,
      dir: dir, speed: spd, R34: R34, R50: R50, R64: R64, distCoast: dC,
      exposure: this._expoAt(t),
      cat: catOf(vmax),
    };
  };

  Storm.prototype._distToMajor = function (lat, lon) {
    var best = 1e9;
    var lines = this._majorLines;
    for (var l = 0; l < lines.length; l++) {
      var pts = lines[l];
      for (var i = 0; i < pts.length; i++) {
        var d = GEO.distKm(lat, lon, pts[i][1], pts[i][0]);
        if (d < best) best = d;
      }
    }
    return best;
  };

  Storm.prototype._expoAt = function (t) {
    var i = Math.floor(t), f = t - i;
    var a = this.expo[Math.max(0, Math.min(this.expo.length - 1, i))];
    var b = this.expo[Math.max(0, Math.min(this.expo.length - 1, i + 1))];
    return GEO.lerp(a, b, f);
  };

  function catOf(v) {
    if (v < 17.2) return { key: "TD", cn: "热带低压", cls: "c-td" };
    if (v < 24.5) return { key: "TS", cn: "热带风暴", cls: "c-ts" };
    if (v < 32.7) return { key: "STS", cn: "强热带风暴", cls: "c-ts" };
    if (v < 41.5) return { key: "TY", cn: "台风", cls: "c-ty" };
    if (v < 51.0) return { key: "STY", cn: "强台风", cls: "c-sty" };
    return { key: "SUPER", cn: "超强台风", cls: "c-super" };
  }

  /* ---------------------------------------------------------- coast */
  Storm.prototype._buildCoast = function () {
    var scene = this.scene;
    var R = this.R;
    var lift = 0.014;
    var SEG = 2;
    var pos = [], perp = [], side = [], cov = [], idx = [];

    this._majorLines = [];
    this._coastVert = [];  // per vertex: [lat, lon]
    var vi = 0;

    var lines = this.coast;
    for (var l = 0; l < lines.length; l++) {
      var pts = lines[l].pts;
      if (lines[l].kind === "mainland" || lines[l].kind === "taiwan" || lines[l].kind === "hainan")
        this._majorLines.push(pts);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i], p1 = pts[i + 1];
        var v0 = GEO.toVec(p0[1], p0[0]);
        var v1 = GEO.toVec(p1[1], p1[0]);
        var A = new B.Vector3(v0.x, v0.y, v0.z).scale(R + lift);
        var C = new B.Vector3(v1.x, v1.y, v1.z).scale(R + lift);
        var tang = C.subtract(A);
        if (tang.lengthSquared() < 1e-10) continue;
        tang.normalize();
        // perpendicular within the tangent plane of the midpoint
        var mid = A.add(C).scale(0.5).normalize();
        var per = B.Vector3.Cross(tang, mid);
        if (per.lengthSquared() < 1e-10) continue;
        per.normalize();

        var four = [[A, -1], [A, 1], [C, -1], [C, 1]];
        var base = vi;
        for (var k = 0; k < 4; k++) {
          var pp = four[k][0];
          pos.push(pp.x, pp.y, pp.z);
          perp.push(per.x, per.y, per.z);
          side.push(four[k][1]);
          cov.push(0);
          this._coastVert.push(k < 2 ? p0 : p1);
          vi++;
        }
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    var mesh = new B.Mesh("coast", scene);
    var vd = new B.VertexData();
    vd.positions = pos; vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("aPerp", perp, false, 3);
    mesh.setVerticesData("aSide", side, false, 1);
    mesh.setVerticesData("aCov", cov, true, 1);
    mesh.setVerticesData("aKm", new Array(pos.length / 3).fill(0), false, 1);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;

    var mat = shaderMat(scene, "coastMat", "wdCoast", "wdCoast",
      ["worldViewProjection", "uCam", "uWorldPerPix", "uWidth", "uDim", "uMid", "uHot", "uTime"],
      ["position", "aPerp", "aSide", "aCov", "aKm"]);
    mat.setColor3("uDim", new B.Color3(0.24, 0.60, 0.72));
    mat.setColor3("uMid", new B.Color3(0.30, 0.72, 0.84));
    mat.setColor3("uHot", new B.Color3(1.0, 0.62, 0.28));
    mat.setFloat("uWidth", 1.15);
    mat.alphaIndex = 10;
    mesh.material = mat;

    this.coastMesh = mesh;
    this.coastMat = mat;
    this._covData = cov;
    this._covBestD = new Float32Array(this._coastVert.length);
    this._covBestC = new Uint8Array(this._coastVert.length);
    this.liveExposure = 0;
  };

  /* Coastline exposure.

     Two products share one pass: which coast vertices lie inside the gale
     field (drives the amber highlight), and how many kilometres of major coast
     are inside it (drives the readout). Both only change meaningfully when
     the storm has actually moved, so this runs on a coarse gate rather than
     every frame — the per-vertex distance loop was the single most expensive
     thing in the frame budget.                                            */
  var _covTmp = null;

  Storm.prototype._updateCoastCoverage = function (st, force) {
    var last = this._covLast;
    if (!force && last) {
      var moved = GEO.distKm(st.lat, st.lon, last.lat, last.lon);
      var grew = 0;
      for (var q = 0; q < 4; q++) grew = Math.max(grew, Math.abs(st.R34[q] - last.R34[q]));
      // 1.5 km of drift or 3 km of growth — visually imperceptible to skip
      if (moved < 1.5 && grew < 3.0) return;
    }
    this._covLast = { lat: st.lat, lon: st.lon, R34: st.R34.slice() };

    var verts = this._coastVert;
    var cov = this._covData;
    var nv = verts.length;
    var changed = false;
    // Precompute the quadrant lookup once per call; sectorRadius recomputed
    // per vertex was doing a modulo, four branches and a few trig ops each.
    var Rq = st.R34;
    var cosLat = Math.cos(st.lat * GEO.D2R);

    // Every coast vertex is bucketed once into a lat/lon grid at 1° so the
    // per-frame pass only visits the neighbourhood of the storm instead of
    // all ~17k vertices.
    if (!this._coastGrid) {
      var G = { cell: 1.0, map: {}, };
      for (var gi = 0; gi < nv; gi++) {
        var vp = verts[gi];
        var gx = Math.floor(vp[0]), gy = Math.floor(vp[1]);
        var gk = gx + "," + gy;
        (G.map[gk] || (G.map[gk] = [])).push(gi);
      }
      this._coastGrid = G;
    }
    var grid = this._coastGrid;
    var Rdeg = 8;      // aggregation radius in degrees (~890 km)
    var gx0 = Math.floor(st.lon) - Rdeg, gx1 = Math.floor(st.lon) + Rdeg;
    var gy0 = Math.floor(st.lat) - Rdeg, gy1 = Math.floor(st.lat) + Rdeg;

    // clear any previously-lit vertices that are now out of range
    var litSet = this._covLit || (this._covLit = []);
    for (var li = 0; li < litSet.length; li++) {
      var ci = litSet[li];
      if (cov[ci]) { cov[ci] = 0; changed = true; }
    }
    litSet.length = 0;

    for (var cy = gy0; cy <= gy1; cy++) {
      for (var cx = gx0; cx <= gx1; cx++) {
        var bucket = grid.map[cx + "," + cy];
        if (!bucket) continue;
        for (var bi = 0; bi < bucket.length; bi++) {
          var i = bucket[bi];
          var p = verts[i];
          var dLat2 = p[1] - st.lat;
          var dLon2 = ((p[0] - st.lon + 540) % 360) - 180;
          var northKm = dLat2 * 111.195;
          var eastKm = dLon2 * 111.195 * cosLat;
          var d2 = northKm * northKm + eastKm * eastKm;
          if (d2 > 780 * 780) continue;
          var rq2;
          if (northKm >= 0) rq2 = (eastKm >= 0 ? Rq[0] : Rq[3]);
          else rq2 = (eastKm >= 0 ? Rq[1] : Rq[2]);
          if (d2 <= rq2 * rq2) {
            if (cov[i] !== 1) { cov[i] = 1; changed = true; }
            litSet.push(i);
          }
        }
      }
    }

    // Coastline km inside the gale field, on the major bodies only.
    // The four quadrant radii have hard edges, so exposure can be evaluated
    // without any trig at all: convert the separation into (north, east) km,
    // pick the quadrant from the two signs and test the radius directly.
    var km = 0;
    var major = this._majorLines;
    var sinLat = Math.sin(st.lat * GEO.D2R), cosLat2 = cosLat;
    for (var l2 = 0; l2 < major.length; l2++) {
      var pts = major[l2];
      for (var k = 0; k < pts.length - 1; k++) {
        var A2 = pts[k], B2 = pts[k + 1];
        // cheap bbox reject in degrees first
        var bx2 = ((A2[0] - st.lon + 540) % 360) - 180;
        if (Math.abs(A2[1] - st.lat) > 8.5 || Math.abs(bx2) > 9.5) continue;
        var seg = GEO.distKm(A2[1], A2[0], B2[1], B2[0]);
        if (seg > 60 || seg < 1e-4) continue;      // skip stitched jumps
        for (var sIdx = 0; sIdx < 2; sIdx++) {
          var u2 = (sIdx + 0.5) / 2;
          var lo2 = A2[0] + (B2[0] - A2[0]) * u2;
          var la2 = A2[1] + (B2[1] - A2[1]) * u2;
          var dLat2 = la2 - st.lat;
          var dLon2 = ((lo2 - st.lon + 540) % 360) - 180;
          // local flat-earth offsets at this latitude: north/south + east/west
          var northKm = dLat2 * 111.195;
          var eastKm = dLon2 * 111.195 * cosLat;
          var dist2 = Math.sqrt(northKm * northKm + eastKm * eastKm);
          var rq;
          if (northKm >= 0) rq = eastKm >= 0 ? Rq[0] : Rq[3];   // NE / NW
          else rq = eastKm >= 0 ? Rq[1] : Rq[2];               // SE / SW
          if (dist2 <= rq) km += seg / 2;
        }
      }
    }
    this.liveExposure = km;

    if (changed) this.coastMesh.updateVerticesData("aCov", cov);
  };

  /* ---------------------------------------------------------- path */
  Storm.prototype._buildPath = function () {
    var scene = this.scene;
    var R = this.R + LIFT.path;
    var SIDES = 7;
    var n = this.dense.length;

    var pos = [], nor = [], aH = [], idx = [];

    // tube frames
    var tang = [], radial = [];
    for (var i = 0; i < n; i++) {
      var p = this.dense[i].v;
      var pd = this.dense[Math.min(n - 1, i + 1)].v;
      var pm = this.dense[Math.max(0, i - 1)].v;
      var t = pd.subtract(pm);
      if (t.lengthSquared() < 1e-12) t = new B.Vector3(1, 0, 0);
      t.normalize();
      tang.push(t);
      radial.push(p.clone());
    }

    for (var k = 0; k < n; k++) {
      var c = radial[k].clone().normalize().scale(R);
      var T = tang[k];
      var N = c.clone().normalize();
      var Bn = B.Vector3.Cross(T, N);
      if (Bn.lengthSquared() < 1e-12) Bn = new B.Vector3(0, 1, 0);
      Bn.normalize();
      var N2 = B.Vector3.Cross(Bn, T).normalize();
      var w = 0.0115;
      var h = this.dense[k];
      for (var s = 0; s < SIDES; s++) {
        var a = s / SIDES * Math.PI * 2;
        var off = Bn.scale(Math.cos(a) * w).add(N2.scale(Math.sin(a) * w));
        var v = c.add(off);
        pos.push(v.x, v.y, v.z);
        nor.push(N.x, N.y, N.z);
        aH.push(k / (n - 1));
      }
    }
    for (var r = 0; r < n - 1; r++) {
      for (var s2 = 0; s2 < SIDES; s2++) {
        var a0 = r * SIDES + s2;
        var a1 = r * SIDES + (s2 + 1) % SIDES;
        var b0 = a0 + SIDES, b1 = a1 + SIDES;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }

    var mesh = new B.Mesh("path", scene);
    var vd = new B.VertexData();
    vd.positions = pos; vd.normals = nor; vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("aH", aH, false, 1);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = true;

    var mat = shaderMat(scene, "pathMat", "wdPath", "wdPath",
      ["worldViewProjection", "uCam", "uNow", "uTime", "uReveal", "uHours",
       "uSpent", "uFresh", "uGuide", "uHead"],
      ["position", "normal", "aH"]);
    mat.setColor3("uSpent", new B.Color3(0.10, 0.26, 0.32));
    mat.setColor3("uFresh", new B.Color3(0.30, 0.95, 0.88));
    mat.setColor3("uGuide", new B.Color3(0.26, 0.52, 0.60));
    mat.setColor3("uHead", new B.Color3(0.92, 1.0, 1.0));
    mat.setFloat("uReveal", 16.0);
    mat.setFloat("uHours", this.HOURS);
    mat.alphaIndex = 12;
    mesh.material = mat;
    this.pathMesh = mesh;
    this.pathMat = mat;

    // hour pips every 6 h
    var pipVerts = [];
    var pipIdx = [];
    var vc = 0;
    for (var hh = 0; hh <= this.HOURS; hh += 6) {
      var di = Math.round(hh * this.SUB);
      var pv = this.dense[Math.min(n - 1, di)].v.clone().normalize().scale(R + 0.004);
      var TN = tang[Math.min(n - 1, di)];
      var Nn = pv.clone().normalize();
      var Bb = B.Vector3.Cross(TN, Nn).normalize();
      var Nn2 = B.Vector3.Cross(Bb, TN).normalize();
      var rad = hh === this.meta.peakHour ? 0.034 : 0.019;
      for (var ss = 0; ss < 6; ss++) {
        var aa = ss / 6 * Math.PI * 2;
        var off2 = Bb.scale(Math.cos(aa) * rad).add(Nn2.scale(Math.sin(aa) * rad));
        var vv = pv.add(off2);
        pipVerts.push(vv.x, vv.y, vv.z);
      }
      for (var ss2 = 0; ss2 < 4; ss2++) {
        pipIdx.push(vc, vc + 1 + ss2, vc + 2 + ss2);
      }
      pipIdx.push(vc, vc + 5, vc + 1);
      vc += 6;
    }
    var pips = new B.Mesh("pips", scene);
    var pvd = new B.VertexData();
    pvd.positions = pipVerts; pvd.indices = pipIdx;
    pvd.applyToMesh(pips, true);
    var pmat = new B.StandardMaterial("pipMat", scene);
    pmat.emissiveColor = new B.Color3(0.42, 0.78, 0.82);
    pmat.diffuseColor = B.Color3.Black();
    pmat.specularColor = B.Color3.Black();
    pmat.disableLighting = true;
    pmat.alpha = 0.38;
    pips.material = pmat;
    pips.isPickable = false;
    pips.alphaIndex = 13;
    this.pips = pips;
  };

  /* ---------------------------------------------------------- fans */
  function fanBuilder(name, scene, segs, rings) {
    var mesh = new B.Mesh(name, scene);
    var nv = 1 + segs * (rings + 1);
    mesh.setVerticesData("position", new Float32Array(nv * 3), true, 3);
    mesh.setVerticesData("normal", new Float32Array(nv * 3), true, 3);
    mesh.setVerticesData("uv", new Float32Array(nv * 2), true, 2);
    var nidx = segs * rings * 6;
    var idx = new Uint16Array(nidx);
    var w = 0;
    for (var r = 0; r < rings; r++) {
      for (var s = 0; s < segs; s++) {
        var s1 = (s + 1) % segs;
        var a0 = 1 + r * segs + s, a1 = 1 + r * segs + s1;
        var b0 = 1 + (r + 1) * segs + s, b1 = 1 + (r + 1) * segs + s1;
        if (r === 0) {
          idx[w++] = 0; idx[w++] = b0; idx[w++] = b1;
        } else {
          idx[w++] = a0; idx[w++] = b0; idx[w++] = b1;
          idx[w++] = a0; idx[w++] = b1; idx[w++] = a1;
        }
      }
    }
    mesh.setIndices(idx);
    mesh.alwaysSelectAsActiveMesh = true;
    return { mesh: mesh, nv: nv, segs: segs, rings: rings };
  }

  function fillFan(fb, centerLat, centerLon, radii, R, lift) {
    var segs = fb.segs, rings = fb.rings;
    var pos = fb.mesh.getVerticesData("position");
    var nor = fb.mesh.getVerticesData("normal");
    var uv = fb.mesh.getVerticesData("uv");
    var v = GEO.toVec(centerLat, centerLon);
    var k = R + lift;

    // centre
    pos[0] = v.x * k; pos[1] = v.y * k; pos[2] = v.z * k;
    nor[0] = v.x; nor[1] = v.y; nor[2] = v.z;
    uv[0] = 0; uv[1] = 0;

    for (var s = 0; s < segs; s++) {
      var az = s / segs * 360;
      var rmax = sectorRadius(radii, az);
      for (var r = 0; r <= rings; r++) {
        var fr = (r + 1) / (rings + 1);
        var rad = rmax * fr;
        var d = GEO.destination(centerLat, centerLon, az, rad);
        var pv = GEO.toVec(d.lat, d.lon);
        var o = (1 + r * segs + s) * 3;
        pos[o] = pv.x * k; pos[o + 1] = pv.y * k; pos[o + 2] = pv.z * k;
        nor[o] = pv.x; nor[o + 1] = pv.y; nor[o + 2] = pv.z;
        var uo = (1 + r * segs + s) * 2;
        uv[uo] = fr; uv[uo + 1] = s / segs;
      }
    }
    fb.mesh.updateVerticesData("position", pos);
    fb.mesh.updateVerticesData("normal", nor);
    fb.mesh.updateVerticesData("uv", uv);
  }

  Storm.prototype._buildFans = function () {
    var scene = this.scene;
    // The three fields nest (r64 ⊂ r50 ⊂ r34). Transparent meshes draw in
    // ascending alphaIndex, so ordering large→small lets each inner level
    // paint over the wash of the one containing it — otherwise the big pale
    // gale circle veils the storm core and everything averages to grey.
    var conf = {
      r34: { color: new B.Color3(0.13, 0.97, 0.78), alpha: 0.92, rim: 1.0, fill: 0.72, ai: 20 },
      r50: { color: new B.Color3(1.0, 0.78, 0.22), alpha: 0.96, rim: 1.0, fill: 0.92, ai: 21 },
      r64: { color: new B.Color3(1.0, 0.30, 0.22), alpha: 1.00, rim: 1.0, fill: 1.30, ai: 22 },
    };
    this.fans = {};
    for (var i = 0; i < LEVELS.length; i++) {
      var key = LEVELS[i];
      var fb = fanBuilder("fan_" + key, scene, FAN_SEGS, FAN_RINGS);
      var m = shaderMat(scene, "fanMat_" + key, "wdFan", "wdFan",
        ["worldViewProjection", "uCam", "uColor", "uTime", "uAlpha", "uRim",
         "uIsTop", "uFill"],
        ["position", "normal", "uv"]);
      m.setColor3("uColor", conf[key].color);
      m.setFloat("uAlpha", conf[key].alpha);
      m.setFloat("uRim", conf[key].rim);
      m.setFloat("uFill", conf[key].fill);
      m.setFloat("uIsTop", key === "r34" ? 1 : 0);
      m.alphaIndex = conf[key].ai;
      m.zOffset = -2;
      fb.mesh.material = m;
      fb.mesh.isPickable = false;
      this.fans[key] = { fb: fb, mat: m, lift: LIFT[key] };
    }
  };

  /* ---------------------------------------------------------- cloud */
  Storm.prototype._buildCloud = function () {
    var scene = this.scene;
    var fb = fanBuilder("cloudCap", scene, 96, 7);
    var mat = shaderMat(scene, "cloudMat", "wdCloud", "wdCloud",
      ["worldViewProjection", "uTex", "uCam", "uTime", "uAlpha", "uSpin", "uZoom"],
      ["position", "normal", "uv"]);
    var tex = new B.Texture("assets/cyclone.png", scene, false, true,
      B.Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    mat.setTexture("uTex", tex);
    mat.setFloat("uAlpha", 0.0);
    mat.setFloat("uSpin", 0);
    mat.setFloat("uZoom", 0);
    mat.alphaIndex = 5;
    mat.zOffset = 1;
    fb.mesh.material = mat;
    fb.mesh.isPickable = false;
    this.cloud = { fb: fb, mat: mat, spin: 0 };
  };

  Storm.prototype._fillCloud = function (centerLat, centerLon, radii) {
    var fb = this.cloud.fb;
    var segs = fb.segs, rings = fb.rings;
    var pos = fb.mesh.getVerticesData("position");
    var nor = fb.mesh.getVerticesData("normal");
    var uv = fb.mesh.getVerticesData("uv");
    var v = GEO.toVec(centerLat, centerLon);
    var k = this.R + LIFT.cloud;
    pos[0] = v.x * k; pos[1] = v.y * k; pos[2] = v.z * k;
    nor[0] = v.x; nor[1] = v.y; nor[2] = v.z;
    uv[0] = 0.5; uv[1] = 0.5;
    for (var s = 0; s < segs; s++) {
      var az = s / segs * 360;
      var rmax = sectorRadius(radii, az) * 1.72;
      for (var r = 0; r <= rings; r++) {
        var fr = (r + 1) / (rings + 1);
        var d = GEO.destination(centerLat, centerLon, az, rmax * fr);
        var pv = GEO.toVec(d.lat, d.lon);
        var o = (1 + r * segs + s) * 3;
        pos[o] = pv.x * k; pos[o + 1] = pv.y * k; pos[o + 2] = pv.z * k;
        nor[o] = pv.x; nor[o + 1] = pv.y; nor[o + 2] = pv.z;
        var ar = az * Math.PI / 180;
        var uo = (1 + r * segs + s) * 2;
        uv[uo] = 0.5 + Math.cos(ar) * fr * 0.5;
        uv[uo + 1] = 0.5 + Math.sin(ar) * fr * 0.5;
      }
    }
    fb.mesh.updateVerticesData("position", pos);
    fb.mesh.updateVerticesData("normal", nor);
    fb.mesh.updateVerticesData("uv", uv);
  };

  /* ---------------------------------------------------------- rain */
  Storm.prototype._buildRain = function () {
    var scene = this.scene;
    var N = 4200;
    var pos = [], corner = [], aIdx = [], inst = [], idx = [];
    var rr = mulberry(1337);
    for (var i = 0; i < N; i++) {
      // ring-biased distribution so the shield looks dense out to the edge
      var radFrac = Math.pow(rr(), 0.62);
      var az = rr() * 360;
      var phase = rr();
      var speed = 0.20 + rr() * 0.16;
      var b = i * 4;
      var cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (var k = 0; k < 4; k++) {
        pos.push(0, 0, 0);
        corner.push(cs[k][0], cs[k][1]);
        aIdx.push(i);
        inst.push(az, radFrac, phase, speed);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    var mesh = new B.Mesh("rain", scene);
    var vd = new B.VertexData();
    vd.positions = pos; vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("aCorner", corner, false, 2);
    mesh.setVerticesData("aIdx", aIdx, false, 1);
    mesh.setVerticesData("aInst", inst, false, 4);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;

    var mat = shaderMat(scene, "rainMat", "wdRain", "wdRain",
      ["worldViewProjection", "uRes", "uUp", "uEast", "uNorth", "uR",
       "uPlanetR", "uKmPerUnit", "uTopKm", "uTime", "uCount", "uSwirl",
       "uPixH", "uPixW", "uColor", "uColorHot"],
      ["position", "aCorner", "aIdx", "aInst"]);
    mat.setColor3("uColor", new B.Color3(0.52, 0.78, 0.98));
    mat.setColor3("uColorHot", new B.Color3(0.86, 0.95, 1.0));
    mat.setFloat("uPlanetR", this.R);
    mat.setFloat("uKmPerUnit", this.kmPerUnit);
    mat.setFloat("uTopKm", 34);
    mat.setFloat("uCount", 0);
    mat.setFloat("uSwirl", 22);
    mat.setFloat("uPixW", 0.62);
    mat.setFloat("uPixH", 3.1);
    mat.setVector4("uR", new B.Vector4(1, 1, 1, 1));
    mat.alphaIndex = 8;
    mesh.material = mat;
    this.rain = { mesh: mesh, mat: mat, max: N };
  };

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------- marker */
  /* The centre is drawn as a screen-space reticle rather than a solid ring:
     a thin circle, four outward ticks, a small core, and one slowly rotating
     outer arc that signals "this is draggable". Everything scales with camera
     distance so it never swells into a blob when zoomed in.                 */
  Storm.prototype._buildMarker = function () {
    var scene = this.scene;
    var root = new B.TransformNode("markerRoot", scene);
    this.markerRoot = root;

    function emissive(name, r, g, b, alpha, aidx, parent) {
      var m = new B.StandardMaterial(name, scene);
      m.emissiveColor = new B.Color3(r, g, b);
      m.diffuseColor = B.Color3.Black();
      m.specularColor = B.Color3.Black();
      m.disableLighting = true;
      m.alpha = alpha;
      m.alphaMode = B.Engine.ALPHA_COMBINE;
      if (parent) parent.alphaIndex = aidx;
      return m;
    }

    // main circle — thin, bright, neutral white
    var ring = B.MeshBuilder.CreateTorus("mkRing", {
      diameter: 0.80, thickness: 0.016, tessellation: 80,
    }, scene);
    ring.material = emissive("mkRingMat", 0.94, 0.99, 1.0, 0.95, 40);
    ring.parent = root; ring.isPickable = false; ring.alphaIndex = 40;

    // four cardinal ticks pointing outward from the circle
    this.markerTicks = [];
    for (var i = 0; i < 4; i++) {
      var tick = B.MeshBuilder.CreateBox("mkTick" + i, {
        width: 0.014, height: 0.010, depth: 0.145,
      }, scene);
      tick.material = emissive("mkTickMat" + i, 0.94, 0.99, 1.0, 0.9, 40);
      tick.parent = root; tick.isPickable = false; tick.alphaIndex = 40;
      tick.position.set(0, 0, 0);   // set in _orientMarker
      this.markerTicks.push(tick);
    }

    // core dot
    var hub = B.MeshBuilder.CreateSphere("mkHub", { diameter: 0.085, segments: 12 }, scene);
    hub.material = emissive("mkHubMat", 0.98, 1.0, 1.0, 1.0, 41);
    hub.parent = root; hub.isPickable = false; hub.alphaIndex = 41;

    // slow rotating outer arc: the "drag me" affordance. Built as a thin
    // ring segment so it lives in the same flat plane as the rest.
    var ARC_SEGS = 40, ARC_SPAN = Math.PI * 1.34;
    var arcPts = [];
    for (var k = 0; k <= ARC_SEGS; k++) {
      var th = (k / ARC_SEGS) * ARC_SPAN;
      arcPts.push(new B.Vector3(Math.cos(th) * 0.64, 0, Math.sin(th) * 0.64));
    }
    var arc = B.MeshBuilder.CreateTube("mkArc", {
      path: arcPts, radius: 0.008, tessellation: 6, cap: B.Mesh.NO_CAP,
    }, scene);
    arc.material = emissive("mkArcMat", 0.28, 0.88, 0.84, 0.85, 39);
    arc.parent = root; arc.isPickable = false; arc.alphaIndex = 39;
    this.markerArc = arc;

    // invisible pick target, sized in screen space by update()
    var pick = B.MeshBuilder.CreateSphere("mkPick", { diameter: 0.85, segments: 10 }, scene);
    var pm = new B.StandardMaterial("mkPickMat", scene);
    pm.alpha = 0.0;
    pm.disableLighting = true;
    pm.emissiveColor = B.Color3.Black();
    pm.diffuseColor = B.Color3.Black();
    pm.specularColor = B.Color3.Black();
    pick.material = pm;
    pick.parent = null;
    pick.position = new B.Vector3(0, -999, 0);
    pick.isPickable = true;
    pick.renderingGroupId = 1;
    pick.metadata = { kind: "marker" };
    // NOTE: visibility must stay 1 — Babylon skips invisible meshes when
    // picking, so a zero-visibility target is silently unpickable. The
    // material's alpha of 0 keeps it unseen without disabling the ray test.
    pick.visibility = 1;
    pick.material.alpha = 0.0;
    pick.material.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
    this.markerPick = pick;

    // soft halo flat on the surface
    var glowMesh = fanBuilder("mkGlow", scene, 48, 2);
    var gm = shaderMat(scene, "mkGlowMat", "wdGlow", "wdGlow",
      ["worldViewProjection", "uCam", "uColor", "uAlpha", "uTime"],
      ["position", "normal", "uv"]);
    gm.setColor3("uColor", new B.Color3(0.55, 0.95, 1.0));
    gm.setFloat("uAlpha", 0.14);
    gm.alphaIndex = 38;
    glowMesh.mesh.material = gm;
    glowMesh.mesh.isPickable = false;
    this.markerGlow = { fb: glowMesh, mat: gm };

    this.markerParts = { ring: ring, arc: arc, hub: hub };
  };

  /* Lay the reticle flat on the sphere and point its +Z along the motion. */
  Storm.prototype._orientMarker = function (lat, lon, dirDeg) {
    var root = this.markerRoot;
    var v = GEO.toVec(lat, lon);
    var up = new B.Vector3(v.x, v.y, v.z).normalize();
    var k = this.R + 0.085;
    root.position.set(up.x * k, up.y * k, up.z * k);
    // Build of a frame from the surface normal and the local north.
    var fr = GEO.frame(lat, lon);
    var north = new B.Vector3(fr.north.x, fr.north.y, fr.north.z);
    var east = new B.Vector3(fr.east.x, fr.east.y, fr.east.z);
    var b = dirDeg * GEO.D2R;
    // heading direction in the tangent plane
    var fwd = north.scale(Math.cos(b)).add(east.scale(Math.sin(b))).normalize();
    // right = forward × up (left-handed), then re-orthogonalise
    var right = B.Vector3.Cross(up, fwd).normalize();
    var fwd2 = B.Vector3.Cross(right, up).normalize();
    var m = B.Matrix.Identity();
    // columns: x=right, y=up, z=forward
    m.m[0] = right.x; m.m[1] = right.y; m.m[2] = right.z; m.m[3] = 0;
    m.m[4] = up.x;    m.m[5] = up.y;    m.m[6] = up.z;    m.m[7] = 0;
    m.m[8] = fwd2.x;  m.m[9] = fwd2.y;  m.m[10] = fwd2.z; m.m[11] = 0;
    root.rotationQuaternion = B.Quaternion.FromRotationMatrix(m);
  };

  Storm.prototype._placeGlow = function (lat, lon, radiusKm) {
    var fb = this.markerGlow.fb;
    var segs = fb.segs, rings = fb.rings;
    var pos = fb.mesh.getVerticesData("position");
    var nor = fb.mesh.getVerticesData("normal");
    var uv = fb.mesh.getVerticesData("uv");
    var v = GEO.toVec(lat, lon);
    var k = this.R + 0.03;
    pos[0] = v.x * k; pos[1] = v.y * k; pos[2] = v.z * k;
    nor[0] = v.x; nor[1] = v.y; nor[2] = v.z;
    uv[0] = 0.5; uv[1] = 0.5;
    for (var s = 0; s < segs; s++) {
      var az = s / segs * 360;
      for (var r = 0; r <= rings; r++) {
        var fr = (r + 1) / (rings + 1);
        var d = GEO.destination(lat, lon, az, radiusKm * fr);
        var pv = GEO.toVec(d.lat, d.lon);
        var o = (1 + r * segs + s) * 3;
        pos[o] = pv.x * k; pos[o + 1] = pv.y * k; pos[o + 2] = pv.z * k;
        nor[o] = pv.x; nor[o + 1] = pv.y; nor[o + 2] = pv.z;
        var ar = az * Math.PI / 180;
        var uo = (1 + r * segs + s) * 2;
        uv[uo] = 0.5 + Math.cos(ar) * fr * 0.5;
        uv[uo + 1] = 0.5 + Math.sin(ar) * fr * 0.5;
      }
    }
    fb.mesh.updateVerticesData("position", pos);
    fb.mesh.updateVerticesData("normal", nor);
    fb.mesh.updateVerticesData("uv", uv);
  };

  /* ---------------------------------------------------------- peak glyph */
  /* Peak-intensity milestone: a small diamond on the track, not a second
     storm. It only brightens when the user is near it, so it reads as a place
     marker rather than competing with the typhoon centre. */
  Storm.prototype._buildPeak = function () {
    var p = this.raw[this.meta.peakHour];
    var v = GEO.toVec(p.lat, p.lon);
    var root = new B.TransformNode("peakRoot", this.scene);
    var mat = new B.StandardMaterial("peakMat", this.scene);
    mat.emissiveColor = new B.Color3(1.0, 0.52, 0.34);
    mat.diffuseColor = B.Color3.Black();
    mat.specularColor = B.Color3.Black();
    mat.disableLighting = true;
    mat.alpha = 0.5;
    mat.alphaMode = B.Engine.ALPHA_COMBINE;

    // thin diamond outline on the surface
    var ringPts = [];
    var N = 4;
    for (var i = 0; i <= N; i++) {
      var th = i / N * Math.PI * 2 + Math.PI / 4;
      ringPts.push(new B.Vector3(Math.cos(th) * 0.085, 0, Math.sin(th) * 0.085));
    }
    var diamond = B.MeshBuilder.CreateTube("peakRing", {
      path: ringPts, radius: 0.006, tessellation: 5, cap: B.Mesh.NO_CAP,
    }, this.scene);
    diamond.material = mat;
    diamond.parent = root;
    diamond.isPickable = false;
    diamond.alphaIndex = 37;

    // tiny centre pip so it survives a zoomed-out view
    var pip = B.MeshBuilder.CreateSphere("peakPip", { diameter: 0.026, segments: 8 }, this.scene);
    pip.material = mat;
    pip.parent = root;
    pip.isPickable = false;
    pip.alphaIndex = 37;

    var k = this.R + LIFT.path + 0.004;
    root.position.set(v.x * k, v.y * k, v.z * k);
    var up = new B.Vector3(v.x, v.y, v.z).normalize();
    root.rotationQuaternion = (B.Quaternion.FromUnitVectorsToRef)
      ? B.Quaternion.FromUnitVectorsToRef(new B.Vector3(0, 1, 0), up, new B.Quaternion())
      : quatFromTo(new B.Vector3(0, 1, 0), up);
    this.peakGlyph = { root: root, mat: mat, hour: this.meta.peakHour, base: 0.085 };
  };

  function quatFromTo(a, b) {
    var d = B.Vector3.Dot(a, b);
    if (d > 0.999999) return B.Quaternion.Identity();
    if (d < -0.999999) {
      return B.Quaternion.RotationAxis(new B.Vector3(1, 0, 0), Math.PI);
    }
    var axis = B.Vector3.Cross(a, b).normalize();
    return B.Quaternion.RotationAxis(axis, Math.acos(GEO.clamp(d, -1, 1)));
  }

  /* ============================================================
     time / update
     ============================================================ */
  Storm.prototype.setTime = function (t, immediate) {
    t = GEO.clamp(t, 0, this.HOURS);
    var st = this.sample(t);
    this.time = t;
    this.state = st;

    // marker reticle, laid flat on the sphere and aligned to the track
    this._orientMarker(st.lat, st.lon, st.dir);
    var kp = this.R + 0.085;
    var vm = GEO.toVec(st.lat, st.lon);
    for (var q = 0; q < 4; q++) {
      var tick = this.markerTicks[q];
      var ta = q * Math.PI / 2;
      tick.position.set(Math.cos(ta) * 0.455, 0, Math.sin(ta) * 0.455);
      tick.rotation.y = -ta + Math.PI / 2;
    }
    if (this.markerPick) {
      this.markerPick.position.set(vm.x * kp, vm.y * kp, vm.z * kp);
    }

    // wind fans — rebuilding 700 vertices x3 every frame is the single
    // biggest cost here, and during camera motion nothing has changed, so
    // compare against the last upload first.
    this._fanKey = this._fanKey || {};
    for (var i = 0; i < LEVELS.length; i++) {
      var key = LEVELS[i];
      var f = this.fans[key];
      var radii = key === "r34" ? st.R34 : key === "r50" ? st.R50 : st.R64;
      var sig = st.lat.toFixed(4) + "," + st.lon.toFixed(4) + "," +
        radii[0].toFixed(1) + "," + radii[1].toFixed(1) + "," +
        radii[2].toFixed(1) + "," + radii[3].toFixed(1);
      if (this._fanKey[key] === sig) continue;
      this._fanKey[key] = sig;
      fillFan(f.fb, st.lat, st.lon, radii, this.R, f.lift);
    }
    var cloudSig = st.lat.toFixed(4) + "," + st.lon.toFixed(4) + "," + st.R34[0].toFixed(1);
    if (this._cloudSig !== cloudSig) {
      this._cloudSig = cloudSig;
      this._fillCloud(st.lat, st.lon, st.R34);
    }
    this._placeGlow(st.lat, st.lon, Math.max(80, sectorRadius(st.R34, st.dir) * 0.22));

    // rain
    var rm = this.rain.mat;
    var dens = GEO.clamp((st.rain - 3) / 66, 0, 1);
    rm.setFloat("uCount", Math.round(dens * this.rain.max));
    rm.setVector4("uR", new B.Vector4(st.R34[0], st.R34[1], st.R34[2], st.R34[3]));
    var fr = GEO.frame(st.lat, st.lon);
    rm.setVector3("uUp", new B.Vector3(fr.up.x, fr.up.y, fr.up.z));
    rm.setVector3("uEast", new B.Vector3(fr.east.x, fr.east.y, fr.east.z));
    rm.setVector3("uNorth", new B.Vector3(fr.north.x, fr.north.y, fr.north.z));

    // path uniforms
    this.pathMat.setFloat("uNow", t / this.HOURS);

    // cloud alpha with intensity
    var ca = GEO.clamp((st.vmax - 14) / 52, 0, 1);
    this.cloud.mat.setFloat("uAlpha", 0.05 + 0.26 * ca * ca);

    this._updateCoastCoverage(st, immediate);
  };

  Storm.prototype.update = function (dt, camPos, viewportH, fov) {
    var time = (this._clock = (this._clock || 0) + dt);

    for (var i = 0; i < LEVELS.length; i++) {
      var f = this.fans[LEVELS[i]];
      f.mat.setVector3("uCam", camPos);
      f.mat.setFloat("uTime", time);
    }
    this.pathMat.setVector3("uCam", camPos);
    this.pathMat.setFloat("uTime", time);
    this.coastMat.setVector3("uCam", camPos);
    this.coastMat.setFloat("uTime", time);
    this.coastMat.setFloat("uWorldPerPix", 2 * Math.tan(fov / 2) / viewportH);
    this.cloud.mat.setVector3("uCam", camPos);
    this.cloud.mat.setFloat("uTime", time);
    this.cloud.spin = (this.cloud.spin + dt * 0.055) % (Math.PI * 2);
    this.cloud.mat.setFloat("uSpin", this.cloud.spin);
    // closer camera → pull the texture in a little so detail stays legible
    var camDist = camPos.length();
    this.cloud.mat.setFloat("uZoom",
      GEO.clamp((34 - camDist) / 20, 0, 1));

    this.markerGlow.mat.setVector3("uCam", camPos);
    this.markerGlow.mat.setFloat("uTime", time);
    this.rain.mat.setFloat("uTime", time);
    var cvs = this.scene.getEngine().getRenderingCanvas();
    this.rain.mat.setVector2("uRes", new B.Vector2(
      cvs ? cvs.clientWidth : this.scene.getEngine().getRenderWidth(),
      cvs ? cvs.clientHeight : this.scene.getEngine().getRenderHeight()));

    // reticle sizing: hold ~46 px across regardless of zoom, and let the
    // outer arc rotate so the marker reads as interactive at a glance
    var dist = camPos.length();
    var worldPerPx = 2 * dist * Math.tan(fov / 2) / Math.max(1, viewportH);
    var msc = GEO.clamp((46 * worldPerPx) / 0.80, 0.004, 0.30);
    this.markerRoot.scaling.set(msc, msc, msc);
    this.markerParts.arc.rotation.y = time * 0.55;
    var breath = 1 + Math.sin(time * 2.0) * 0.03;
    this.markerParts.ring.scaling.set(breath, 1, breath);

    // Pick target: a sibling of the root so it keeps its own screen size.
    // It must never grow past the innermost wind circle, or dragging it would
    // swallow clicks meant for the storm core on narrow (portrait) viewports
    // where world-per-pixel is larger.
    if (this.markerPick) {
      // ~26 px radius is comfortable on a mouse and just covers a fingertip.
      // Cap it at half the smallest gale radius so it can never swallow the
      // storm core, but never let the cap drive it below a usable size.
      var coreKm = Math.min.apply(null, this.state.R34);
      var capWorld = Math.max(0.22, (coreKm || 140) / this.kmPerUnit * 0.5);
      var ps = GEO.clamp((26 * worldPerPx) / 0.425, 0.004, capWorld);
      this.markerPick.scaling.set(ps, ps, ps);
    }

    // Peak milestone: a quiet diamond that only lifts when the storm is near
    var pk = this.peakGlyph;
    var near = 1 - GEO.clamp(Math.abs(this.time - pk.hour) / 9, 0, 1);
    pk.mat.alpha = (0.18 + 0.62 * near) * (0.82 + 0.18 * Math.sin(time * 2.0));
  };

  /* nearest time on the track to a world point (for dragging) */
  Storm.prototype.snapTime = function (p, maxKm) {
    var best = 1e9, bi = 0;
    var n = this.dense.length;
    for (var i = 0; i < n; i++) {
      var d = this.dense[i].v.scale(this.R).subtract(p).lengthSquared();
      if (d < best) { best = d; bi = i; }
    }
    // refine within the neighbouring segment
    var a = this.dense[Math.max(0, bi - 1)].v.clone().scale(this.R);
    var b = this.dense[Math.min(n - 1, bi + 1)].v.clone().scale(this.R);
    var ab = b.subtract(a);
    var t = B.Vector3.Dot(p.subtract(a), ab) / Math.max(1e-9, ab.lengthSquared());
    t = GEO.clamp(t, 0, 1);
    var proj = a.add(ab.scale(t));
    var dist = proj.subtract(p).length() * this.kmPerUnit;
    if (maxKm != null && dist > maxKm) return null;
    var frac = (bi + (t - 0.5)) / this.SUB;
    return GEO.clamp(frac, 0, this.HOURS);
  };

  Storm.prototype.dispose = function () { };

  global.Storm = Storm;
  global.StormShaders = { register: registerShaders, sectorRadius: sectorRadius };
})(window);
