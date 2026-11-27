const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..", ".work", "shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const fails = [];
  page.on("response", (r) => { if (r.status() >= 400) fails.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => fails.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") fails.push("console " + m.text()); });

  await page.goto("http://127.0.0.1:8199/index.html", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.getElementById("help").hidden = true; window.__APP__._seenHelp = true; });
  await page.waitForTimeout(2600);

  const diag = await page.evaluate(() => {
    const A = window.__APP__;
    const out = {};
    const names = ["earth", "earthRim", "atmo", "atmo2", "sky"];
    out.meshes = {};
    for (const m of A.scene.meshes) {
      if (names.includes(m.name)) {
        const mat = m.material;
        out.meshes[m.name] = {
          enabled: m.isEnabled(),
          hasMat: !!mat,
          matType: mat ? mat.getClassName() : null,
          ready: mat ? (mat.isReady ? mat.isReady(m) : null) : null,
          alphaBlend: mat ? mat.needAlphaBlending() : null,
          diameter: m.getBoundingInfo().boundingSphere.radiusWorld * 2,
        };
      }
    }
    out.shaderErrors = [];
    if (A.scene.getEngine().getEffects) {
      for (const e of A.scene.getEngine().getEffects()) {
        if (!e.isReady()) out.shaderErrors.push(e.name + " :: " + (e.error || "not ready"));
      }
    }
    out.lights = A.scene.lights.map((l) => ({ t: l.getClassName(), i: l.intensity,
      d: l.direction ? [l.direction.x.toFixed(2), l.direction.y.toFixed(2), l.direction.z.toFixed(2)] : null }));
    return out;
  });

  await page.screenshot({ path: path.join(OUT, "diag-00.png") });

  // isolate: hide layers one at a time
  const variants = [
    ["no-atmo", ["atmo", "atmo2"]],
    ["no-sky", ["sky"]],
    ["no-rim", ["earthRim"]],
    ["earth-only", ["atmo", "atmo2", "sky", "earthRim"]],
  ];
  for (const [label, hide] of variants) {
    await page.evaluate((hide) => {
      const A = window.__APP__;
      for (const m of A.scene.meshes) {
        m.__savedEnabled = m.__savedEnabled === undefined ? m.isEnabled() : m.__savedEnabled;
        if (hide.includes(m.name)) m.setEnabled(false);
        else if (!m.name.startsWith("fan_") && !["path", "coast", "rain", "pips", "cloudCap"].includes(m.name)) m.setEnabled(true);
      }
    }, hide);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "diag-" + label + ".png") });
  }

  console.log(JSON.stringify({ diag, fails }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
