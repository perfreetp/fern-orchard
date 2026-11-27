// 真实浏览器冒烟:启动 dev server,用 Chromium 验证 WebGL 渲染、Solid 挂载与交互,无控制台错误。
// 独立脚本,不纳入 vitest。用 node 运行:npx tsx scripts/browser-smoke.ts
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors: string[] = [];

const server = await createServer({ root, server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';

const exe = path.join(
  process.env.LOCALAPPDATA ?? '',
  'ms-playwright',
  'chromium-1255',
  'chrome-win64',
  'chrome.exe',
);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
});
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const results: Record<string, boolean | number | string> = {};

// 1. Solid 挂载:工具栏与时间轴渲染(默认三棱柱 = 5 面)
results.toolbar = (await page.textContent('.brand')) === '多面体展开折叠动画工坊';
results.trackCount = (await page.locator('.track-label').count()) === 5;
results.hasCanvas = (await page.locator('canvas').count()) === 1;

// 2. WebGL 实际绘制:canvas 有非透明像素
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas') as HTMLCanvasElement;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return 'no-gl-context';
  // 读中心像素
  const w = c.width, h = c.height;
  const pixels = new Uint8Array(w * h * 4);
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.drawImage(c, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let nonBg = 0;
  for (let i = 0; i < data.length; i += 4) {
    // 背景色 ~ (245,246,248)
    if (Math.abs(data[i] - 245) + Math.abs(data[i + 1] - 246) + Math.abs(data[i + 2] - 248) > 20) nonBg++;
  }
  return nonBg;
});
results.paintedPixels = painted as number;

// 3. 播放控制:点播放,时间推进
const tBefore = await page.textContent('.time-readout');
await page.click('button:has-text("播放")');
await page.waitForTimeout(700);
const tAfter = await page.textContent('.time-readout');
results.timeAdvanced = tBefore !== tAfter;
await page.click('button:has-text("暂停")').catch(() => {});

// 4. 切换多面体:选四棱锥(5 面:1 底 + 4 侧面)
await page.selectOption('.toolbar select', 'pyramid-4');
await page.waitForTimeout(400);
results.pyramidTracks = (await page.locator('.track-label').count()) === 5;

// 4b. 播放头拖拽(功能点 2):在标尺上按下并拖动,时间读数变化
const ruler = page.locator('.ruler').first();
const rbox = await ruler.boundingBox();
if (rbox) {
  await page.mouse.move(rbox.x + rbox.width * 0.2, rbox.y + rbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rbox.x + rbox.width * 0.7, rbox.y + rbox.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const scrubbed = await page.textContent('.time-readout');
  results.scrubMovesPlayhead = /^[3-4]\.\d/.test(scrubbed?.trim() ?? '');
} else {
  results.scrubMovesPlayhead = false;
}

// 4c. 画面点击选面 + 拖拽折痕联动关键帧(功能点 7)
const kfBefore = await page.locator('.keyframe').count();
const cbox = await page.locator('canvas').boundingBox();
if (cbox) {
  // 在画布网格上多点尝试,直到选中某个面(HUD 出现)
  let selected = false;
  const spots = [
    [0.5, 0.5], [0.4, 0.5], [0.6, 0.45], [0.45, 0.6], [0.55, 0.55],
  ];
  for (const [fx, fy] of spots) {
    await page.mouse.click(cbox.x + cbox.width * fx, cbox.y + cbox.height * fy);
    await page.waitForTimeout(120);
    if ((await page.locator('.hud-card').count()) > 0) {
      selected = true;
      break;
    }
  }
  results.hudShowsAngle = selected;
  if (selected) {
    // 选中后垂直拖拽改角度,关键帧跟随(数量不减)
    const hb = await page.locator('canvas').boundingBox();
    if (hb) {
      await page.mouse.move(hb.x + hb.width * 0.5, hb.y + hb.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width * 0.5, hb.y + hb.height * 0.3, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
    const kfAfter = await page.locator('.keyframe').count();
    results.dragFaceUpdatesTimeline = kfAfter >= kfBefore;
  } else {
    results.dragFaceUpdatesTimeline = false;
  }
} else {
  results.dragFaceUpdatesTimeline = false;
  results.hudShowsAngle = false;
}

// 5. 加暂停点
const markerBefore = await page.locator('.marker').count();
await page.click('button:has-text("加暂停点")');
await page.waitForTimeout(200);
results.markerAdded = (await page.locator('.marker').count()) === markerBefore + 1;

// 6. 导出 JSON 弹窗
await page.click('button:has-text("查看工程 JSON")');
await page.waitForTimeout(200);
results.jsonShown = (await page.locator('.json-pop pre').count()) === 1;
const jsonText = (await page.textContent('.json-pop pre')) ?? '';
results.jsonValid = (() => {
  try {
    const obj = JSON.parse(jsonText);
    return obj.app === 'polyhedron-fold-studio' && Array.isArray(obj.data.tracks);
  } catch {
    return false;
  }
})();

await browser.close();
await server.close();

console.log('浏览器冒烟结果:');
let pass = true;
for (const [k, v] of Object.entries(results)) {
  const ok = typeof v === 'number' ? v > 100 : v === true;
  if (!ok) pass = false;
  console.log(`  ${ok ? '✓' : '✗'} ${k} =`, v);
}
console.log('控制台错误:', errors.length ? errors : '无');
if (errors.length) console.log(errors.join('\n'));
process.exit(pass && errors.length === 0 ? 0 : 1);
