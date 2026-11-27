// 核心几何验证：轮廓投影阴影 + 分区采样光强 + 时间轴灯位插值
// 与最终 HTML 中使用的公式保持一致（俯视坐标系：x 向右=东，y 向下=南）

const TANK_W = 960, TANK_H = 640;

// ---------- 水草分区（双重黄金分割：列宽=0.382缸宽，列内按 0.618/0.382 横切） ----------
// 左列 x: 48–350（宽302≈0.382×可用宽792+边距微调）；A/B 分界 y≈273
const zones = [
  { name: 'A', poly: [[48, 48], [350, 48], [350, 263], [48, 263]] },
  { name: 'B', poly: [[48, 283], [350, 283], [350, 592], [48, 592]] },
  { name: 'C', poly: [[370, 48], [912, 48], [912, 592], [370, 592]] },
];

// ---------- 沉木（横卧在 A/B 分界线上，几乎占满左列宽度） ----------
const WOOD = { cx: 200, cy: 273, a: 140, b: 48, rot: (-6 * Math.PI) / 180, height: 120 };
function makeDriftwood() {
  const { cx, cy, a, b, rot } = WOOD;
  const n = 13, poly = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.12 * Math.sin(t * 3 + 0.6) + 0.07 * Math.cos(t * 5);
    const sx = Math.cos(t) * a * wobble, sy = Math.sin(t) * b * wobble;
    poly.push([
      cx + sx * Math.cos(rot) - sy * Math.sin(rot),
      cy + sx * Math.sin(rot) + sy * Math.cos(rot),
    ]);
  }
  return { name: '沉木', poly, height: WOOD.height };
}

// ---------- 石块（带凹凸的近似圆，均在 C 区一侧） ----------
function makeRock(name, cx, cy, r, height, seed) {
  const n = 11, poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * Math.cos(a * 5 + seed * 1.7);
    poly.push([cx + r * wobble * Math.cos(a), cy + r * wobble * Math.sin(a)]);
  }
  return { name, poly, height };
}

const occluders = [
  makeDriftwood(),
  makeRock('石块1', 560, 250, 64, 78, 1.3),
  makeRock('石块2', 720, 460, 46, 58, 2.7),
  makeRock('石块3', 850, 170, 30, 40, 4.1),
];

// ---------- 点在多边形内（射线法） ----------
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- 轮廓投影：阴影多边形 = 物体轮廓各顶点沿灯→地方向平移 ----------
function shadowPoly(obj, lamp) {
  const k = obj.height / lamp.h;               // 投影系数（灯越高阴影越短）
  return obj.poly.map(([x, y]) => [
    x + (x - lamp.x) * k,
    y + (y - lamp.y) * k,
  ]);
}

// ---------- 分区采样：直射光 = 1 - 被遮采样比例 ----------
function zoneLight(zone, lamp) {
  const xs = zone.poly.map(p => p[0]), ys = zone.poly.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const step = 16;
  let total = 0, blocked = 0;
  const blockerHits = {};
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      if (!pointInPoly(x, y, zone.poly)) continue;
      total++;
      for (const obj of occluders) {
        const sp = shadowPoly(obj, lamp);
        if (pointInPoly(x, y, sp)) {
          blocked++;
          blockerHits[obj.name] = (blockerHits[obj.name] || 0) + 1;
          break;
        }
      }
    }
  }
  const frac = total ? blocked / total : 0;
  const direct = 1 - frac;
  const ambient = 0.06;
  const intensity = ambient + 0.94 * direct;
  let main = null;
  for (const [name, cnt] of Object.entries(blockerHits)) {
    if (!main || cnt > main.cnt) main = { name, cnt };
  }
  return { intensity, frac, main: main ? main.name : null, total, blocked };
}

// ---------- 灯的时间轴（24h，7:00–18:00 开灯；正午灯最高、阴影最短） ----------
// 端点不取缸边缘：低灯位+极远会让阴影带整体越过分区，选阴影中心对准分区中心的位置
const keys = [
  { t: 7,    x: 200, y: 75,  h: 130 },
  { t: 12.5, x: 200, y: 273, h: 420 },
  { t: 18,   x: 200, y: 385, h: 130 },
];
function lampAt(time) {
  if (time < keys[0].t || time > keys[keys.length - 1].t) return null;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (time >= a.t && time <= b.t) {
      const f = (time - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        h: a.h + (b.h - a.h) * f,
      };
    }
  }
  return null;
}

// ---------- 方向名 ----------
function dirName(dx, dy) {
  const ang = Math.atan2(dy, dx) * 180 / Math.PI; // 0=东,90=南
  const dirs8 = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
  return dirs8[Math.round(((ang + 360) % 360) / 45) % 8];
}
function polyCenter(poly) {
  return [
    poly.reduce((s, p) => s + p[0], 0) / poly.length,
    poly.reduce((s, p) => s + p[1], 0) / poly.length,
  ];
}
function shadeSource(obj, zone) {
  // 遮荫来源方向：从分区中心指向遮挡物中心（对 B 区，沉木在北侧 → 北）
  const [zx, zy] = polyCenter(zone.poly);
  const [ox, oy] = polyCenter(obj.poly);
  return dirName(ox - zx, oy - zy);
}
function shadowDir(obj, lamp) {
  // 阴影投射方向：从遮挡物指向阴影延伸处（与灯位相反）
  const [ox, oy] = polyCenter(obj.poly);
  return dirName(ox - lamp.x, oy - lamp.y);
}

// ================= 参数扫描：找让 B（早）/A（晚）阴影中心对准分区中心的灯位 =================
console.log('=== 灯位扫描（x=200，正对沉木；列出 A/B 遮挡率）===');
console.log('  y   h  |  A遮挡%  B遮挡%');
for (const y of [70, 95, 130, 180, 273, 380, 430, 470, 530, 600]) {
  for (const h of [130, 150, 200]) {
    const lamp = { x: 200, y, h };
    const ra = zoneLight(zones[0], lamp), rb = zoneLight(zones[1], lamp);
    console.log(String(y).padStart(4), String(h).padStart(4), '|',
      (ra.frac * 100).toFixed(0).padStart(5), (rb.frac * 100).toFixed(0).padStart(6));
  }
}

// ================= 测试 =================
console.log('=== 时间轴剧情（7:00 → 18:00，每 1.5h）===');
console.log('time |  lamp(x,y,h)   | A光强(遮挡%) | B光强(遮挡%) | C光强(遮挡%) | A遮荫来源 / B遮荫来源 | 沉木投影方向/长度');
for (let t = 7; t <= 18.01; t += 1.5) {
  const lamp = lampAt(t);
  if (!lamp) { console.log(t.toFixed(1), ' 灯关闭（夜间）'); continue; }
  const la = zoneLight(zones[0], lamp);
  const lb = zoneLight(zones[1], lamp);
  const lc = zoneLight(zones[2], lamp);
  const wood = occluders[0];
  const sa = la.main === wood.name ? shadeSource(wood, zones[0]) : (la.main ? la.main : '无');
  const sb = lb.main === wood.name ? shadeSource(wood, zones[1]) : (lb.main ? lb.main : '无');
  const sp = shadowPoly(wood, lamp);
  const sLen = Math.max(...sp.map(p => Math.hypot(p[0] - 200, p[1] - 273)));
  console.log(
    t.toFixed(1).padStart(4), '|',
    `(${lamp.x.toFixed(0)},${lamp.y.toFixed(0)},${lamp.h.toFixed(0)})`.padEnd(15), '|',
    la.intensity.toFixed(2), `(${(la.frac * 100).toFixed(0)}%)`.padEnd(7), '|',
    lb.intensity.toFixed(2), `(${(lb.frac * 100).toFixed(0)}%)`.padEnd(7), '|',
    lc.intensity.toFixed(2), `(${(lc.frac * 100).toFixed(0)}%)`.padEnd(7), '|',
    String(sa).padEnd(5), '/', String(sb).padEnd(5), '|',
    shadowDir(wood, lamp), `${sLen.toFixed(0)}px`
  );
}

console.log('\n=== 关键剧情点检查 ===');
function check(time) {
  const lamp = lampAt(time);
  const r = zones.map(z => zoneLight(z, lamp));
  console.log(`t=${time}: A=${r[0].intensity.toFixed(2)}(遮${(r[0].frac * 100).toFixed(0)}%) B=${r[1].intensity.toFixed(2)}(遮${(r[1].frac * 100).toFixed(0)}%) C=${r[2].intensity.toFixed(2)}`);
  return r;
}
const r7 = check(7);
const rm = check(12.5);
const r18 = check(18);

console.log('\n[剧情1] 早晨 B 区已被沉木遮暗而 A 区明亮?', r7[0].intensity > 0.9 && r7[1].intensity < 0.5);
console.log('[交汇]  正午灯高悬，A/B 为全天最亮（贴边淡影可接受）?',
  rm[0].intensity > 0.75 && rm[1].intensity > 0.75 && rm[0].intensity > r7[1].intensity);
console.log('[反转]  傍晚 A 区被沉木遮暗而 B 区明亮（此消彼长）?', r18[1].intensity > 0.9 && r18[0].intensity < 0.35);
console.log('[对照]  C 区全天基本不受沉木影响?', r7[2].intensity > 0.8 && r18[2].intensity > 0.8);
console.log('[方向]  早晨 B 的遮荫来源=北、傍晚 A 的遮荫来源=南?',
  r7[1].main === '沉木' && shadeSource(occluders[0], zones[1]) === '北' &&
  r18[0].main === '沉木' && shadeSource(occluders[0], zones[0]) === '南');

console.log('\n=== 手动拖灯到北侧（y=75）/ 南侧（y=385），h=130 ===');
for (const [tag, y] of [['北侧', 75], ['南侧', 385]]) {
  const lamp = { x: 200, y, h: 130 };
  const ra = zoneLight(zones[0], lamp), rb = zoneLight(zones[1], lamp);
  const sa = ra.main ? shadeSource(occluders.find(o => o.name === ra.main), zones[0]) : '无';
  const sb = rb.main ? shadeSource(occluders.find(o => o.name === rb.main), zones[1]) : '无';
  console.log(
    `灯在${tag}: A=${ra.intensity.toFixed(2)}(遮${(ra.frac * 100).toFixed(0)}%,来源:${sa})`,
    ` B=${rb.intensity.toFixed(2)}(遮${(rb.frac * 100).toFixed(0)}%,来源:${sb})`
  );
}
const north = zoneLight(zones[1], { x: 200, y: 75, h: 130 });
const south = zoneLight(zones[0], { x: 200, y: 385, h: 130 });
console.log('[此消彼长] 北灯B暗(>50%) / 南灯A暗(>75%)，明暗反向?',
  north.frac > 0.5 && south.frac > 0.75);

console.log('\n=== 灯高对阴影长度的影响（沉木，灯在正北侧 y=75）===');
for (const h of [120, 200, 300, 420]) {
  const lamp = { x: 200, y: 75, h };
  const wood = occluders[0];
  const sp = shadowPoly(wood, lamp);
  const sLen = Math.max(...sp.map(p => Math.hypot(p[0] - 200, p[1] - 273)));
  const rb = zoneLight(zones[1], lamp);
  console.log(`h=${h}: 沉木阴影最远点≈${sLen.toFixed(0)}px, B区遮挡=${(rb.frac * 100).toFixed(0)}%`);
}

console.log('\n=== 夜间关灯 ===');
console.log('t=3:00 lamp =', lampAt(3), '（应为 null，全缸走环境光）');
