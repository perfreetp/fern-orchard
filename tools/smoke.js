/* Headless smoke test: load the app, capture console errors, screenshot. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..", ".work", "shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ""}`));
  page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure() && r.failure().errorText}`));

  await page.goto("http://127.0.0.1:8199/index.html", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const h = document.getElementById("help");
    if (h) h.hidden = true;
    window.__APP__ && (window.__APP__._seenHelp = true);
  });
  await page.waitForTimeout(3500);

  const info = await page.evaluate(() => {
    const A = window.__APP__;
    if (!A || !A.globe) return { ok: false };
    return {
      ok: true,
      t: A.t,
      fps: Math.round(A._fps),
      quality: A._quality,
      cam: {
        alpha: +A.globe.camera.alpha.toFixed(3),
        beta: +A.globe.camera.beta.toFixed(3),
        radius: +A.globe.camera.radius.toFixed(2),
      },
      meshes: A.scene.meshes.length,
      exposure: Math.round(A.storm.liveExposure),
      vmax: A.storm.state.vmax,
    };
  });

  await page.screenshot({ path: path.join(OUT, "01-initial.png") });

  // jump to peak
  await page.evaluate(() => {
    const A = window.__APP__;
    A.timeline.onSeek(A.meta.peakHour);
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, "02-peak.png") });

  const peak = await page.evaluate(() => {
    const A = window.__APP__;
    return {
      t: A.t,
      vmax: Math.round(A.storm.state.vmax),
      R34: A.storm.state.R34.map(Math.round),
      exposure: Math.round(A.storm.liveExposure),
      peakHour: A.meta.peakHour,
      toast: document.getElementById("peak-toast").classList.contains("on"),
    };
  });

  // start of track
  await page.evaluate(() => window.__APP__.timeline.onSeek(8));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "03-early.png") });

  // landfall
  await page.evaluate(() => window.__APP__.timeline.onSeek(window.__APP__.meta.landfallHour));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "04-landfall.png") });

  console.log(JSON.stringify({ info, peak, logs }, null, 2));

  await browser.close();
})().catch((e) => {
  console.error("TEST FAILED", e);
  process.exit(1);
});
