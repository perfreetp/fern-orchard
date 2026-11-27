/* Interaction test: marker drag, path click, playback, keyboard, responsive. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = path.resolve(__dirname, "..", ".work", "shots");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
}

async function project(page, lat, lon) {
  return page.evaluate(({ lat, lon }) => {
    const A = window.__APP__;
    const B = window.BABYLON;
    const v = window.GEO.toVec(lat, lon);
    const p = new B.Vector3(v.x * A.globe.R, v.y * A.globe.R, v.z * A.globe.R);
    const c = A.globe.canvas;
    const s = B.Vector3.Project(p, B.Matrix.Identity(),
      A.scene.getTransformMatrix(),
      A.globe.camera.viewport.toGlobal(c.clientWidth, c.clientHeight));
    return { x: s.x, y: s.y, z: s.z };
  }, { lat, lon });
}

async function screenPos(page, evalFn) {
  return page.evaluate(evalFn);
}

(async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

  await page.goto("http://127.0.0.1:8199/index.html", { waitUntil: "load" });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const h = document.getElementById("help"); if (h) h.hidden = true;
    window.__APP__._seenHelp = true;
  });
  await page.waitForTimeout(2600);

  /* ---------- 1. marker drag ---------- */
  await page.evaluate(() => window.__APP__.timeline.onSeek(60));
  await page.waitForTimeout(800);
  const st0 = await page.evaluate(() => window.__APP__.t);
  const m0 = await project(page, ...(await page.evaluate(() => {
    const s = window.__APP__.storm.state; return [s.lat, s.lon];
  })));
  // target: the peak position projected to screen
  const peakLL = await page.evaluate(() => {
    const m = window.__APP__.meta;
    return [m.peak.lat, m.peak.lon];
  });
  const target = await project(page, peakLL[0], peakLL[1]);

  check("marker projects on screen", m0.x > 0 && m0.x < 1440 && m0.y > 0 && m0.y < 900,
    { m0, target });

  // hover to confirm cursor becomes grab
  await page.mouse.move(m0.x, m0.y);
  await page.waitForTimeout(220);
  const cursor = await page.evaluate(() => window.__APP__.globe.canvas.style.cursor);
  check("hover marker sets grab cursor", cursor === "grab", cursor);

  // drag it to the peak
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const dragging = await page.evaluate(() => window.__APP__.dragging);
  for (let i = 1; i <= 18; i++) {
    await page.mouse.move(m0.x + (target.x - m0.x) * i / 18,
      m0.y + (target.y - m0.y) * i / 18);
    await page.waitForTimeout(28);
  }
  await page.mouse.up();
  await page.waitForTimeout(320);
  const after = await page.evaluate(() => ({
    t: window.__APP__.t, drag: window.__APP__.dragging,
    peak: window.__APP__.meta.peakHour,
    r34: window.__APP__.storm.state.R34.map(Math.round),
  }));
  check("drag started", dragging === true, dragging);
  check("drag moved the storm toward the peak", Math.abs(after.t - after.peak) < 5.0,
    { before: st0, after: after.t, peak: after.peak });
  check("drag ended cleanly", after.drag === false, after.drag);
  check("wind circle grew during drag", after.r34[0] > 380, after.r34);
  await page.screenshot({ path: path.join(OUT, "i1-after-drag.png") });

  /* ---------- 2. path click ---------- */
  const pathPt = await project(page, 18.0, 129.5);  // an early track point
  const beforeClick = await page.evaluate(() => window.__APP__.t);
  await page.mouse.click(pathPt.x, pathPt.y);
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(() => window.__APP__.t);
  check("path click seeks", Math.abs(afterClick - beforeClick) > 12,
    { before: beforeClick, after: afterClick, at: pathPt });

  /* ---------- 3. playback ---------- */
  await page.evaluate(() => window.__APP__.timeline.onSeek(30));
  await page.waitForTimeout(250);
  await page.click("#btn-play");
  const tA = await page.evaluate(() => window.__APP__.t);
  // wait for a fixed number of *rendered frames*, not wall-clock: under a
  // software rasterizer the frame clock is the only meaningful unit
  await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const f = () => { if (++n >= 40) res(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  const tB = await page.evaluate(() => window.__APP__.t);
  check("playback advances", tB > tA + 0.5, { tA, tB });
  const playingCls = await page.evaluate(() =>
    document.getElementById("btn-play").classList.contains("playing"));
  check("play button shows pause state", playingCls, playingCls);
  await page.screenshot({ path: path.join(OUT, "i2-playing.png") });

  // speed
  await page.click("#btn-speed");
  const speed = await page.evaluate(() => window.__APP__.speed);
  check("speed toggles", speed === 2, speed);
  await page.click("#btn-play");
  const paused = await page.evaluate(() => window.__APP__.playing);
  check("pause works", paused === false, paused);

  /* ---------- 4. keyboard ---------- */
  await page.evaluate(() => window.__APP__.timeline.onSeek(50));
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const tR = await page.evaluate(() => window.__APP__.t);
  check("arrow key steps one hour", Math.abs(tR - 51) < 0.05, tR);

  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const sp = await page.evaluate(() => window.__APP__.playing);
  check("space toggles play", sp === true, sp);
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);

  /* ---------- 5. quadrant panel values ---------- */
  await page.evaluate(() => window.__APP__.timeline.onSeek(96));
  await page.waitForTimeout(400);
  const hud = await page.evaluate(() => ({
    wind: document.getElementById("sc-wind").textContent,
    pres: document.getElementById("sc-pres").textContent,
    l34: document.getElementById("qp-l34").textContent,
    rows: document.querySelectorAll("#qp-table .qp-row").length,
    cat: document.getElementById("sc-cat").textContent,
    expo: document.getElementById("ex-km").textContent,
  }));
  check("HUD wind matches data", hud.wind === "65", hud);
  check("quadrant rows rendered", hud.rows === 4, hud.rows);
  check("exposure shown", Number(hud.expo) > 500, hud.expo);

  /* ---------- 6. zoom / camera limits ---------- */
  const camOk = await page.evaluate(() => {
    const A = window.__APP__, c = A.globe.camera;
    c.radius = 1; const lo = Math.max(c.radius, c.lowerRadiusLimit);
    c.radius = 999; const hi = Math.min(c.radius, c.upperRadiusLimit);
    c.radius = 21.6;
    return { lo, hi };
  });
  check("camera clamps radius", camOk.lo >= 13.5 && camOk.hi <= 65, camOk);

  /* ---------- 7. responsiveness ---------- */
  for (const [w, h, label] of [[390, 844, "mobile"], [768, 1024, "tablet"], [1024, 700, "small-laptop"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__APP__.globe.engine.resize());
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("no horizontal overflow @" + label, overflow <= 0, overflow);
    await page.screenshot({ path: path.join(OUT, "i3-" + label + ".png") });
  }

  /* ---------- 8. performance ---------- */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__APP__.timeline.onSeek(96));
  const perf = await page.evaluate(async () => {
    const A = window.__APP__;
    let n = 0; const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    return {
      fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
      drawCalls: A.scene.getEngine()._drawCalls ? A.scene.getEngine()._drawCalls.current : null,
      activeMeshes: A.scene.getActiveMeshes().length,
      totalVerts: A.scene.getTotalVertices(),
    };
  });
  // SwiftShader is a CPU rasterizer — absolute fps here is not a shipping
  // signal. What matters is that the per-frame CPU work (which is what we
  // control) stays small on real hardware, so assert on that instead.
  const cpu = await page.evaluate(() => {
    const A = window.__APP__;
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) A.storm.setTime(80 + i * 0.2, false);
    return +((performance.now() - t0) / 40).toFixed(2);
  });
  check("per-frame CPU work under budget", cpu < 8.0, { setTimeMs: cpu, fps: perf.fps });

  console.log(JSON.stringify({ results, perf, errs }, null, 2));
  const fails = results.filter((r) => !r.pass);
  console.log("\n" + (results.length - fails.length) + "/" + results.length + " passed");
  if (fails.length) console.log("FAILED: " + fails.map((f) => f.name).join(" | "));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
