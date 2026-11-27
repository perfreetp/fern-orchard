/* ============================================================
   timeline.js — scrub rail with an intensity/rain sparkline
   ============================================================ */
(function (global) {
  "use strict";

  function Timeline(root, meta, track, onSeek, onScrub) {
    this.root = root;
    this.meta = meta;
    this.track = track;
    this.onSeek = onSeek;
    this.onScrub = onScrub;
    this.rail = root.querySelector("#tl-rail");
    this.canvas = root.querySelector("#tl-canvas");
    this.progress = root.querySelector("#tl-progress");
    this.handle = root.querySelector("#tl-handle");
    this.ticks = root.querySelector("#tl-ticks");
    this.t = 0;
    this._buildTicks();
    this._buildMarks();
    this._bind();
    var self = this;
    // the rail has no width until layout settles — paint once it does
    var paint = function () { self._paint(); };
    requestAnimationFrame(function () { requestAnimationFrame(paint); });
    global.addEventListener("resize", paint);
    if (global.ResizeObserver) new ResizeObserver(paint).observe(this.rail);
  }

  var MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

  function fmtClock(startISO, hours) {
    var d = new Date(startISO);
    d.setTime(d.getTime() + hours * 3600 * 1000);
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  Timeline.prototype._buildTicks = function () {
    var h = this.meta.hours;
    var frag = document.createDocumentFragment();
    for (var i = 0; i <= h; i += 6) {
      var major = i % 24 === 0;
      var el = document.createElement("i");
      el.style.left = (i / h * 100) + "%";
      if (major) el.className = "major";
      frag.appendChild(el);
    }
    this.ticks.innerHTML = "";
    this.ticks.appendChild(frag);
  };

  Timeline.prototype._buildMarks = function () {
    var h = this.meta.hours;
    var pk = this.root.querySelector("#tl-peak");
    var ld = this.root.querySelector("#tl-land");
    if (pk) { pk.style.left = (this.meta.peakHour / h * 100) + "%"; pk.classList.add("on"); }
    if (ld && this.meta.landfallHour != null) {
      ld.style.left = (this.meta.landfallHour / h * 100) + "%";
      ld.classList.add("on");
    }
    this.t0 = this.root.querySelector("#tl-t0");
    this.t1 = this.root.querySelector("#tl-t1");
    this.now = this.root.querySelector("#tl-now");
    if (this.t0) this.t0.textContent = fmtClock(this.meta.startISO, 0);
    if (this.t1) this.t1.textContent = fmtClock(this.meta.startISO, h);
  };

  Timeline.prototype._paint = function () {
    var cv = this.canvas;
    if (!cv) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var tr = this.track;
    var n = tr.length;
    var top = 3, bottom = h - 3;
    var i, x, y;
    // normalise on the observed maxima so the curve fills the rail
    var maxV = 0, maxR = 0;
    for (i = 0; i < n; i++) {
      if (tr[i].vmax > maxV) maxV = tr[i].vmax;
      if (tr[i].rain > maxR) maxR = tr[i].rain;
    }

    function curve(get) {
      g.beginPath();
      for (var j = 0; j < n; j++) {
        var xx = j / (n - 1) * w;
        var yy = bottom - get(tr[j]) * (bottom - top);
        if (j === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
      }
    }

    // rain band (area)
    var grad = g.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, "rgba(88,158,216,.40)");
    grad.addColorStop(1, "rgba(88,158,216,.02)");
    curve(function (p) { return p.rain / maxR; });
    g.lineTo(w, bottom); g.lineTo(0, bottom); g.closePath();
    g.fillStyle = grad; g.fill();

    // wind area
    var grad2 = g.createLinearGradient(0, top, 0, bottom);
    grad2.addColorStop(0, "rgba(255,150,80,.42)");
    grad2.addColorStop(1, "rgba(255,93,77,.02)");
    curve(function (p) { return p.vmax / maxV; });
    g.lineTo(w, bottom); g.lineTo(0, bottom); g.closePath();
    g.fillStyle = grad2; g.fill();

    // wind stroke
    curve(function (p) { return p.vmax / maxV; });
    g.strokeStyle = "rgba(255,178,124,.92)";
    g.lineWidth = 1.2;
    g.stroke();

    // rain stroke, thin
    curve(function (p) { return p.rain / maxR; });
    g.strokeStyle = "rgba(120,186,236,.5)";
    g.lineWidth = 0.9;
    g.stroke();

    this._w = w;
  };

  Timeline.prototype.setT = function (t) {
    this.t = t;
    var pct = (t / this.meta.hours) * 100;
    this.progress.style.width = pct + "%";
    this.handle.style.left = pct + "%";
    if (this.now) this.now.textContent = fmtClock(this.meta.startISO, t);
  };

  Timeline.prototype._posToT = function (clientX) {
    var r = this.rail.getBoundingClientRect();
    var x = GEO.clamp((clientX - r.left) / r.width, 0, 1);
    return x * this.meta.hours;
  };

  Timeline.prototype._bind = function () {
    var self = this;
    var rail = this.rail;
    var dragging = false;

    function down(e) {
      e.preventDefault();
      dragging = true;
      rail.setPointerCapture && rail.setPointerCapture(e.pointerId);
      self.handle.classList.add("grabbing");
      var t = self._posToT(e.clientX);
      self.onScrub && self.onScrub(t);
      self.onSeek && self.onSeek(t);
    }
    function move(e) {
      if (!dragging) return;
      var t = self._posToT(e.clientX);
      self.onScrub && self.onScrub(t);
      self.onSeek && self.onSeek(t);
    }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      self.handle.classList.remove("grabbing");
      rail.releasePointerCapture && rail.releasePointerCapture(e.pointerId);
    }
    rail.addEventListener("pointerdown", down);
    rail.addEventListener("pointermove", move);
    rail.addEventListener("pointerup", up);
    rail.addEventListener("pointercancel", up);
    rail.addEventListener("pointerleave", function (e) { if (dragging) up(e); });

    // keyboard
    rail.tabIndex = 0;
    rail.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 6 : 1;
      if (e.key === "ArrowRight") { self.onSeek(GEO.clamp(self.t + step, 0, self.meta.hours)); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { self.onSeek(GEO.clamp(self.t - step, 0, self.meta.hours)); e.preventDefault(); }
      else if (e.key === "Home") { self.onSeek(0); e.preventDefault(); }
      else if (e.key === "End") { self.onSeek(self.meta.hours); e.preventDefault(); }
    });
  };

  global.Timeline = Timeline;
  global.fmtClock = fmtClock;
})(window);
