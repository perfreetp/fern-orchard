const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = path.resolve(__dirname, "..", ".work", "shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p.on("pageerror", (e) => console.log("ERR", e.message));
  await p.goto("http://127.0.0.1:8199/index.html", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    document.getElementById("help").hidden = true;
    window.__APP__._seenHelp = true;
    const A = window.__APP__;
    // hide HUD for clean shots
    for (const id of ["hud-top", "status-card", "quad-panel", "expo-card", "timeline", "peak-toast"]) {
      const el = document.getElementById(id); if (el) el.style.display = "none";
    }
  });
  await p.waitForTimeout(2000);

  // zoom in on the storm
  await p.evaluate(() => {
    const A = window.__APP__;
    A.timeline.onSeek(A.meta.peakHour);
    A.globe.flyTo(27.5, 122.0, 15.5, undefined, 900);
  });
  await p.waitForTimeout(1800);

  const layers = ["cloudCap", "fan_r34", "fan_r50", "fan_r64", "mkGlow", "rain", "coast", "path", "pips"];
  await p.screenshot({ path: path.join(OUT, "L-all.png") });

  for (const keep of [["fan_r34"], ["fan_r34", "fan_r50", "fan_r64"], ["cloudCap"], ["coast"], ["rain"], ["path", "pips"]]) {
    await p.evaluate((keep) => {
      const A = window.__APP__;
      const names = ["cloudCap", "fan_r34", "fan_r50", "fan_r64", "mkGlow", "rain", "coast", "path", "pips"];
      for (const m of A.scene.meshes) {
        if (names.includes(m.name)) m.setEnabled(keep.includes(m.name));
      }
    }, keep);
    await p.waitForTimeout(450);
    await p.screenshot({ path: path.join(OUT, "L-" + keep.join("+") + ".png") });
  }

  // restore all
  await p.evaluate(() => {
    const A = window.__APP__;
    for (const m of A.scene.meshes) m.setEnabled(true);
  });
  await p.waitForTimeout(300);

  const info = await p.evaluate(() => {
    const A = window.__APP__;
    const out = {};
    for (const n of ["cloudCap", "fan_r34", "coast"]) {
      const m = A.scene.getMeshByName(n);
      if (!m) { out[n] = "missing"; continue; }
      const bb = m.getBoundingInfo().boundingSphere.radiusWorld;
      out[n] = { r: +bb.toFixed(3), verts: m.getTotalVertices() };
    }
    out.camRadius = +A.globe.camera.radius.toFixed(2);
    out.R34 = A.storm.state.R34;
    out.kmPerUnit = A.globe.kmPerUnit;
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
