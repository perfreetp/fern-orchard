/* ============================================================
   app.js — wiring: scene ⇄ HUD ⇄ timeline ⇄ pointer interaction
   ============================================================ */
(function (global) {
  "use strict";

  var GEO = global.GEO;
  var B = global.BABYLON;

  var $ = function (id) { return document.getElementById(id); };

  var App = {
    playing: false,
    speed: 1,
    t: 0,
    dragging: false,
    dragOffset: 0,
    _lastFrame: 0,
    _fps: 60,
    _slow: 0,
    _quality: 1,
  };

  /* ============================================================
     boot
     ============================================================ */
  function boot() {
    var canvas = $("scene");
    if (!B) { showNoWebGL(); return; }

    var data = global.TYPHOON_DATA;
    if (!data) { showNoWebGL(); return; }

    try {
      App.globe = new global.Globe(canvas);
    } catch (err) {
      console.error(err);
      showNoWebGL();
      return;
    }

    global.StormShaders.register();
    App.scene = App.globe.scene;
    App.storm = new global.Storm(App.scene, App.globe, data);
    App.meta = data.meta;

    App.timeline = new global.Timeline($("timeline"), App.meta, App.storm.raw,
      function (t) { seek(t, true); },
      function (t) { previewSeek(t); });

    buildQuadGrid();
    bindUI();
    updateHUD(App.storm.state, true);

    App.t = App.storm.time;
    App.timeline.setT(App.t);

    App.globe.engine.runRenderLoop(function () { frame(); });

    // fade the boot screen once the first frames are in
    var started = false;
    App.scene.onAfterRenderObservable.addOnce(function () {
      if (started) return;
      started = true;
      setTimeout(function () {
        var b = $("boot");
        if (b) b.classList.add("done");
      }, 260);
    });

    // frame the theatre and hand over
    setTimeout(function () {
      App.globe.camera.alpha = App.globe.homeView.alpha + 0.42;
      App.globe.flyTo(25.6, 124.4, 16.6, undefined, 1600);
      setTimeout(function () {
        if (App._seenHelp) return;
        var seen = false;
        try { seen = sessionStorage.getItem("lx-help-seen") === "1"; } catch (e) { }
        if (!seen) showHelp(true);
      }, 1000);
    }, 120);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause();
    });
  }

  function showNoWebGL() {
    var m = $("no-webgl");
    if (m) m.hidden = false;
    var b = $("boot");
    if (b) b.classList.add("done");
  }

  /* ============================================================
     frame
     ============================================================ */
  function frame() {
    var now = performance.now();
    var dt = App._lastFrame ? Math.min(0.06, (now - App._lastFrame) / 1000) : 1 / 60;
    App._lastFrame = now;

    if (App.playing) {
      var rate = App.speed * (App.meta.intervalHours ? 1 : 1);
      // one track hour per 0.30 s at 1×
      var next = App.t + (dt / 0.30) * App.speed;
      if (next >= App.meta.hours) {
        next = App.meta.hours;
        setPlaying(false);
      }
      setTime(next, false);
    }

    var g = App.globe;
    var cam = g.camera.position;
    var eng = g.engine;
    g.update(dt);
    App.storm.update(dt, cam, eng.getRenderHeight(), g.camera.fov);

    App.scene.render();

    // adaptive quality
    var inst = 1 / Math.max(1e-4, eng.getDeltaTime() / 1000);
    App._fps = App._fps * 0.92 + inst * 0.08;
    adaptQuality();
  }

  var _slowFrames = 0, _fastFrames = 0, _hinted = false;
  function adaptQuality() {
    if (App._fps < 34) {
      _slowFrames++;
      if (_slowFrames > 90 && App._quality > 0.55) {
        App._quality = Math.max(0.55, App._quality - 0.15);
        App.globe.engine.setHardwareScalingLevel(
          (1 / Math.min(global.devicePixelRatio || 1, 2)) / App._quality);
        _slowFrames = 0;
        if (!_hinted) {
          _hinted = true;
          var h = $("perf-hint");
          if (h) { h.hidden = false; setTimeout(function () { h.hidden = true; }, 4200); }
        }
      } else if (_slowFrames > 30 && App._quality <= 0.55) {
        App._slowFrames = 0;
      }
    } else {
      _slowFrames = 0;
    }
  }

  /* ============================================================
     time control
     ============================================================ */
  function setTime(t, full) {
    App.t = GEO.clamp(t, 0, App.meta.hours);
    App.storm.setTime(App.t);
    App.timeline.setT(App.t);
    if (full !== false) updateHUD(App.storm.state);
    else updateHUD(App.storm.state, false);
    checkPeak();
  }

  function previewSeek(t) {
    // if the user grabs the rail mid-play, stop
    if (App.playing) setPlaying(false);
  }

  function seek(t, fromUI) {
    if (fromUI && App.playing) setPlaying(false);
    setTime(t, true);
  }

  function setPlaying(on) {
    App.playing = on;
    var btn = $("btn-play");
    if (btn) btn.classList.toggle("playing", on);
    if (on && App.t >= App.meta.hours - 0.001) setTime(0, true);
  }
  function pause() { if (App.playing) setPlaying(false); }

  /* ============================================================
     HUD
     ============================================================ */
  var lastCat = null;

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function updateHUD(st, force) {
    if (!st) return;

    $("sc-cat").textContent = st.cat.cn;
    if (lastCat !== st.cat.cls) {
      var el = $("sc-cat");
      el.className = "sc-cat " + st.cat.cls;
      lastCat = st.cat.cls;
    }
    $("sc-time").textContent = global.fmtClock(App.meta.startISO, st.t);
    $("sc-wind").textContent = Math.round(st.vmax);
    $("sc-pres").textContent = Math.round(st.mslp);
    $("sc-rain").textContent = Math.round(st.rain);
    $("sc-bar").style.width = GEO.clamp(st.vmax / 70, 0, 1) * 100 + "%";
    $("sc-pos").textContent =
      "北纬 " + st.lat.toFixed(1) + "° · 东经 " + st.lon.toFixed(1) + "°";
    $("sc-coast").textContent = st.distCoast < 12
      ? "已登陆"
      : "距海岸 " + Math.round(st.distCoast) + " km";

    // quadrant
    updateQuadPanel(st);
    updateExposure(st);
  }

  var QP_R_MAX = 620;
  function buildQuadGrid() {
    var g = $("qp-grid");
    if (!g || g.childNodes.length) return;
    var ns = "http://www.w3.org/2000/svg";
    for (var r = 1; r <= 3; r++) {
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("r", (r / 3) * 100);
      g.appendChild(c);
    }
    var l1 = document.createElementNS(ns, "line");
    l1.setAttribute("x1", -100); l1.setAttribute("y1", 0);
    l1.setAttribute("x2", 100); l1.setAttribute("y2", 0);
    g.appendChild(l1);
    var l2 = document.createElementNS(ns, "line");
    l2.setAttribute("x1", 0); l2.setAttribute("y1", -100);
    l2.setAttribute("x2", 0); l2.setAttribute("y2", 100);
    g.appendChild(l2);
    var t1 = document.createElementNS(ns, "text");
    t1.setAttribute("x", 3); t1.setAttribute("y", -84);
    t1.textContent = "200";
    g.appendChild(t1);
    var t2 = document.createElementNS(ns, "text");
    t2.setAttribute("x", 3); t2.setAttribute("y", -51);
    t2.textContent = "400";
    g.appendChild(t2);
  }

  function quadPath(R) {
    // SVG space: y is up-negative, so NE is (+x, -y)
    var d = "";
    var S = 100 / QP_R_MAX;
    var Q = [-45, 45, 135, 225]; // screen angles for NE SE SW NW (SVG y-down)
    for (var q = 0; q < 4; q++) {
      var r = R[q] * S;
      var a0 = Q[q];
      var a1 = Q[(q + 1) % 4];
      // a quarter arc, plus a tiny inner radius so the shape reads as a ring
      var x0 = Math.cos(a0 * GEO.D2R) * r, y0 = Math.sin(a0 * GEO.D2R) * r;
      var x1 = Math.cos(a1 * GEO.D2R) * r, y1 = Math.sin(a1 * GEO.D2R) * r;
      if (q === 0) d += "M " + x0.toFixed(2) + " " + y0.toFixed(2);
      d += " A " + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2);
    }
    d += " Z";
    return d;
  }

  function updateQuadPanel(st) {
    var p34 = quadPath(st.R34), p50 = quadPath(st.R50), p64 = quadPath(st.R64);
    $("qp-shape-34").setAttribute("d", p34);
    $("qp-shape-50").setAttribute("d", p50);
    $("qp-shape-64").setAttribute("d", p64);

    $("qp-l34").textContent = Math.round(st.R34[0]) + " km";
    $("qp-l50").textContent = Math.round(st.R50[0]) + " km";
    $("qp-l64").textContent = Math.round(st.R64[0]) + " km";

    // table
    var tbl = $("qp-table");
    var hdr = '<div class="qp-row hdr"><span></span><span class="qv">NE</span>' +
      '<span class="qv">SE</span><span class="qv">SW</span><span class="qv">NW</span></div>';
    var rows = "";
    var keys = [["r34", "34", st.R34], ["r50", "50", st.R50], ["r64", "64", st.R64]];
    for (var i = 0; i < keys.length; i++) {
      rows += '<div class="qp-row ' + keys[i][0] + '"><span class="qn">' + keys[i][1] + ' m/s</span>';
      for (var q = 0; q < 4; q++) {
        var v = keys[i][2][q];
        rows += '<span class="qv' + (v < 1 ? " zero" : "") + '">' +
          (v < 1 ? "—" : Math.round(v)) + '</span>';
      }
      rows += "</div>";
    }
    tbl.innerHTML = hdr + rows;

    // quadrant dots + motion arrow
    var dots = "";
    var S = 100 / QP_R_MAX;
    var Q = [-45, 45, 135, 225];
    for (var q2 = 0; q2 < 4; q2++) {
      var r = st.R34[q2] * S;
      var a = Q[q2] * GEO.D2R;
      dots += '<circle cx="' + (Math.cos(a) * r).toFixed(1) + '" cy="' +
        (Math.sin(a) * r).toFixed(1) + '" r="2.4"/>';
    }
    $("qp-dots").innerHTML = dots;

    // motion arrow (meteorological direction: where it is heading)
    var m = (st.dir - 90) * GEO.D2R;  // screen angle
    var ax = Math.cos(m), ay = Math.sin(m);
    var ar = '<path d="M ' + (ax * 16).toFixed(1) + ' ' + (ay * 16).toFixed(1) +
      ' L ' + (ax * 62).toFixed(1) + ' ' + (ay * 62).toFixed(1) + '"/>' +
      '<path d="M ' + (ax * 62 - ay * 4 - ax * 7).toFixed(1) + ' ' +
      (ay * 62 + ax * 4 - ay * 7).toFixed(1) + ' L ' + (ax * 62).toFixed(1) + ' ' +
      (ay * 62).toFixed(1) + ' L ' + (ax * 62 + ay * 4 - ax * 7).toFixed(1) + ' ' +
      (ay * 62 - ax * 4 - ay * 7).toFixed(1) + '"/>';
    $("qp-motion-arrow").setAttribute("d", "M 0 0 L " + (ax * 16).toFixed(1) + " " +
      (ay * 16).toFixed(1));
    $("qp-spd").textContent = st.speed.toFixed(0);
    $("qp-dir").textContent = dirName(st.dir);
  }

  var DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  function dirName(deg) {
    var i = Math.round(((deg % 360) / 45)) % 8;
    return DIRS[i] + " " + Math.round(deg) + "°";
  }

  var EXPO_MAX = 2000;
  function updateExposure(st) {
    var km = App.storm.liveExposure || 0;
    var shown = st.exposure;
    $("ex-km").textContent = Math.round(km);
    $("ex-fill").style.width = GEO.clamp(km / EXPO_MAX, 0, 1) * 100 + "%";
    var note = $("ex-note");
    if (km < 1) {
      note.textContent = "风圈尚未触及陆地";
      note.classList.remove("alert");
    } else if (km < 400) {
      note.textContent = "风圈边缘擦过海岸线";
      note.classList.add("alert");
    } else {
      note.textContent = "七级风圈已覆盖海岸线 · 沿岸大风";
      note.classList.add("alert");
    }
  }

  /* peak toast: fire when the user first brings the storm near the peak */
  var peakShown = false;
  function checkPeak() {
    if (peakShown) return;
    if (Math.abs(App.t - App.meta.peakHour) <= 1.2) {
      peakShown = true;
      var km = Math.round(App.storm.liveExposure || App.meta.exposure[App.meta.peakHour]);
      $("toast-km").textContent = km;
      $("peak-toast").classList.add("on");
      clearTimeout(App._toastT);
      App._toastT = setTimeout(function () {
        $("peak-toast").classList.remove("on");
      }, 8200);
    }
  }

  /* ============================================================
     pointer interaction
     ============================================================ */
  function bindUI() {
    var scene = App.scene;
    var canvas = App.globe.canvas;

    $("btn-play").addEventListener("click", function () {
      setPlaying(!App.playing);
    });

    $("btn-speed").addEventListener("click", function () {
      var steps = [1, 2, 4, 8];
      var i = steps.indexOf(App.speed);
      App.speed = steps[(i + 1) % steps.length];
      $("btn-speed").textContent = App.speed + "×";
    });

    $("btn-reset-view").addEventListener("click", function () {
      App.globe.resetView();
    });

    $("btn-help").addEventListener("click", function () { showHelp(false); });
    $("btn-help-close").addEventListener("click", function () { hideHelp(); });
    $("toast-close").addEventListener("click", function () {
      $("peak-toast").classList.remove("on");
    });
    $("help").addEventListener("click", function (e) {
      if (e.target === $("help")) hideHelp();
    });

    document.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!$("help").hidden) { hideHelp(); return; }
        setPlaying(!App.playing);
      } else if (e.key === "r" || e.key === "R") {
        App.globe.resetView();
      } else if (e.key === "?" || e.key === "/") {
        showHelp(false);
      } else if (e.key === "Escape") {
        hideHelp();
        $("peak-toast").classList.remove("on");
      } else if (e.key === "ArrowRight" && !e.shiftKey) {
        setPlaying(false); setTime(App.t + 1, true);
      } else if (e.key === "ArrowLeft" && !e.shiftKey) {
        setPlaying(false); setTime(App.t - 1, true);
      }
    });

    /* ---- picking: grab the marker, or click the track ----
       Track picking is done entirely in screen space against the projected
       polyline: a 7-side tube is far too thin to hit reliably, and a screen
       test also gives a predictable "near the line" feel on every device.  */
    var downPos = null;
    var moved = false;

    canvas.addEventListener("pointerdown", function (ev) {
      downPos = { x: ev.clientX, y: ev.clientY };
      moved = false;

      // scene.pick takes CSS pixels — it applies the hardware scaling itself,
      // so pre-multiplying by canvas.width/clientWidth lands the ray off-target
      var hit = scene.pick(ev.offsetX, ev.offsetY,
        function (m) { return m.isPickable && m.isEnabled(); });
      var kind = hit && hit.hit && hit.pickedMesh && hit.pickedMesh.metadata
        ? hit.pickedMesh.metadata.kind : null;

      if (kind === "marker") {
        beginDrag(ev);
      } else {
        // remember a candidate track time; commit on pointerup if not dragged
        var t = pickTrackTime(ev, 26);
        App._pendingTrackT = t;
      }
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (App.dragging) { dragMove(ev); return; }
      if (downPos && (Math.abs(ev.clientX - downPos.x) > 6 ||
        Math.abs(ev.clientY - downPos.y) > 6)) moved = true;
    }, { passive: true });

    canvas.addEventListener("pointerup", function (ev) {
      if (App.dragging) { endDrag(ev); downPos = null; return; }
      // a genuine click (not a camera drag) on/near the track seeks there
      if (downPos && !moved && App._pendingTrackT != null) {
        setPlaying(false);
        setTime(App._pendingTrackT, true);
      }
      App._pendingTrackT = null;
      downPos = null;
    });
    canvas.addEventListener("pointercancel", function (ev) {
      if (App.dragging) endDrag(ev);
      App._pendingTrackT = null;
      downPos = null;
    });

    function beginDrag(ev) {
      setPlaying(false);
      App.dragging = true;
      App.globe.camera.detachControl();
      canvas.style.cursor = "grabbing";
      // while dragging the storm snaps to the nearest point on the track with
      // no distance limit — the gesture itself is the intent
      var t = pickTrackTime(ev, 1e9);
      if (t != null) {
        App.dragOffset = App.t - t;
        setTime(GEO.clamp(t + App.dragOffset, 0, App.meta.hours), true);
      }
      if (ev.cancelable) ev.preventDefault();
    }

    function dragMove(ev) {
      var t = pickTrackTime(ev, 1e9);
      if (t != null) setTime(GEO.clamp(t + App.dragOffset, 0, App.meta.hours), true);
    }

    function endDrag(ev) {
      App.dragging = false;
      App.globe.camera.attachControl(canvas, true);
      canvas.style.cursor = "";
    }

    // change cursor when hovering the marker or the track
    var lastHoverPick = 0;
    canvas.addEventListener("pointermove", function (ev) {
      if (App.dragging) return;
      var now = performance.now();
      if (now - lastHoverPick < 60) return;   // throttle: picking is not free
      lastHoverPick = now;
      var hit = scene.pick(ev.offsetX, ev.offsetY,
        function (m) { return m.isPickable && m.isEnabled(); });
      var k = hit && hit.hit && hit.pickedMesh && hit.pickedMesh.metadata
        ? hit.pickedMesh.metadata.kind : null;
      if (k === "marker") { canvas.style.cursor = "grab"; return; }
      var tt = pickTrackTime(ev, 16);
      canvas.style.cursor = tt != null ? "pointer" : "";
    }, { passive: true });
  }

  /* project a screen point onto the track and return the nearest time */
  function pickTrackTime(ev, tolPx) {
    var scene = App.scene;
    var canvas = App.globe.canvas;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var tol = tolPx || 26;
    var storm = App.storm;
    var n = storm.dense.length;
    var camPos = App.globe.camera.position;
    var vp = App.globe.camera.viewport.toGlobal(w, h);
    var ident = B.Matrix.Identity();
    var tm = scene.getTransformMatrix();

    var best = Infinity, bestT = null;
    var bestSeg = null;
    var prev = null;

    for (var i = 0; i < n; i++) {
      var p = storm.dense[i].v.scale(storm.R);
      // skip samples on the far side of the globe
      var toP = p.subtract(camPos);
      if (B.Vector3.Dot(toP, p) > 0) { prev = null; continue; }

      var s = B.Vector3.Project(p, ident, tm, vp);
      if (s.z < 0 || s.z > 1) { prev = null; continue; }
      var pt = { x: s.x, y: s.y, t: i / storm.SUB };

      if (prev) {
        // distance from the pointer to this screen segment
        var ax = prev.x, ay = prev.y, bx = pt.x, by = pt.y;
        var dx = bx - ax, dy = by - ay;
        var len2 = dx * dx + dy * dy;
        var u = len2 > 1e-9
          ? GEO.clamp(((ev.offsetX - ax) * dx + (ev.offsetY - ay) * dy) / len2, 0, 1)
          : 0;
        var qx = ax + dx * u, qy = ay + dy * u;
        var ddx = qx - ev.offsetX, ddy = qy - ev.offsetY;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < best) {
          best = d2;
          bestT = prev.t + (pt.t - prev.t) * u;
          bestSeg = { a: prev, b: pt, u: u };
        }
      }
      prev = pt;
    }

    if (bestT == null) return null;
    if (best > tol * tol) return null;
    App._lastHitPx = Math.sqrt(best);
    return bestT;
  }

  /* ============================================================
     help
     ============================================================ */
  function showHelp(first) {
    App._seenHelp = true;
    try { sessionStorage.setItem("lx-help-seen", "1"); } catch (e) { }
    $("help").hidden = false;
  }
  function hideHelp() { $("help").hidden = true; }

  /* ============================================================ */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.__APP__ = App;
})(window);
