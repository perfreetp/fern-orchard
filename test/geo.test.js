/* 最终模型验证：叶片开合↔光斑形变、时间轴↔光斑爬墙、Fresnel↔变暗分裂、镜面反射 */
const G = require('../src/geometry.js');

/* 锁定的场景常量（与 src/scene.js 保持一致） */
const XH = 2.5, YH = 10.5, ZH = 3.5;
const OH = 1.8, n = 8, pitch = 0.45, w = 0.225;
const bands = [];
for (let r = 0; r < 7; r++) bands.push({ y0: r * 1.5, y1: (r + 1) * 1.5, row: r });

function sunDir(hour) {
  const t = (hour - 6) / 12;
  const elev = (1.2 + 78.8 * Math.sin(Math.PI * t)) * Math.PI / 180;
  const off = (25 + 30 * Math.max(0, (hour - 12) / 6)) * Math.PI / 180;
  return {
    elevDeg: elev * 180 / Math.PI,
    d: G.norm3([
      Math.cos(elev) * Math.sin(off),
      -Math.sin(elev),
      -Math.cos(elev) * Math.cos(off)
    ])
  };
}

function run(hour, alphaDeg) {
  const s = sunDir(hour);
  const res = G.compute({
    XH, YH, OH, n, pitch, w,
    alpha: alphaDeg * Math.PI / 180, d3: s.d, panelBands: bands
  });
  return { s, res };
}
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const median = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;

console.log('\n[1] 叶片闭合无直射光，全开出现多条条状光斑');
const closed = run(12, 0), open = run(12, 90);
check('闭合时中间缝隙 throughput=0', closed.res.gaps.slice(1, -1).every(g => g.throughput === 0));
check('闭合时无直射地面光斑', closed.res.patches.filter(p => p.surface === 'floor' && !p.bounce).length === 0);
const openFloor = open.res.patches.filter(p => p.surface === 'floor' && !p.bounce);
check('全开时地面多条条状光斑(≥6)', openFloor.length >= 6, 'got ' + openFloor.length);
check('光斑条数 ≤ 缝隙数 n+1=9', openFloor.length <= 9);

console.log('\n[2] 叶片张开角 → 光束宽度正比于 sinα（对应关系要对）');
const mid = run(12, 45);
const wMid = median(mid.res.patches.filter(p => p.surface === 'floor' && !p.bounce).map(p => Math.hypot(p.p2.x - p.p1.x, p.p2.y - p.p1.y)));
const wOpen = median(openFloor.map(p => Math.hypot(p.p2.x - p.p1.x, p.p2.y - p.p1.y)));
check('α=45° 光束宽度 < α=90°', wMid < wOpen, `${wMid.toFixed(3)} vs ${wOpen.toFixed(3)}`);
check('宽度比落在 sin45° 合理区间(0.15~0.85)', (wMid / wOpen) > 0.15 && (wMid / wOpen) < 0.85,
  'ratio=' + (wMid / wOpen).toFixed(3));

console.log('\n[3] 调叶片角 → 光斑整体偏移（板缘随 α 移动）');
const pos = a => JSON.stringify(run(12, a).res.patches.filter(p => !p.bounce).map(p => p.p1.x.toFixed(2)));
check('α=30° 与 α=75° 光斑位置不同', pos(30) !== pos(75));

console.log('\n[4] 时间轴：正午地面 → 下午爬上对面东墙墙顶');
const noon = run(12, 60), dusk = run(18, 60);
const noonFloor = noon.res.patches.filter(p => p.surface === 'floor' && !p.bounce).length;
const noonEast = noon.res.patches.filter(p => p.surface === 'east' && !p.bounce).length;
check('正午以地面光斑为主', noonFloor > noonEast);
const duskEast = dusk.res.patches.filter(p => p.surface === 'east' && !p.bounce);
check('傍晚地面光斑消失', dusk.res.patches.filter(p => p.surface === 'floor' && !p.bounce).length === 0);
check('傍晚光斑落在东墙', duskEast.length > 0);
const topY = Math.max(...duskEast.map(p => p.p2.y));
check('傍晚光斑抵达东墙墙顶 (y>10, 墙高 10.5)', topY > 10, 'topY=' + topY.toFixed(2));
const climb = [13, 15, 16, 17, 18].map(h => Math.max(...run(h, 60).res.patches
  .filter(p => p.surface === 'east' && !p.bounce).map(p => p.p2.y)));
check('东墙光斑上缘随时间单调爬升', climb.every((v, i) => i === 0 || v >= climb[i - 1] - 1e-6),
  JSON.stringify(climb.map(v => v.toFixed(2))));

console.log('\n[5] Fresnel：入射角逼近掠射 → 透射变暗、反射增强（分裂）');
const early = run(13, 60).res.fresnel.east;
const late = run(18, 60).res.fresnel.east;
check('午后入射角随太阳降低而减小(掠射→近法线)', early.theta > late.theta + 30,
  `${early.theta.toFixed(1)}° → ${late.theta.toFixed(1)}°`);
check('掠射端(13h) θ>80°', early.theta > 80, early.theta.toFixed(1));
check('掠射端透射 T<0.45（明显变暗）', early.T < 0.45, 'T=' + early.T.toFixed(3));
check('掠射端反射 R>0.55（分裂出强反射斑）', early.R > 0.55, 'R=' + early.R.toFixed(3));
check('近法线端(18h) T>0.9（光斑变亮）', late.T > 0.9, 'T=' + late.T.toFixed(3));

console.log('\n[6] 镜面幕墙一次反射（忽略多次反弹）');
const r15 = run(15, 60).res;
check('15h 东墙存在一次反射光斑(bounce=1)', r15.patches.some(p => p.bounce === 1));
check('反射光来自东墙、落向地面或西墙(对面)',
  r15.patches.filter(p => p.bounce === 1).every(p => p.sourceWall === 'east' &&
    (p.surface === 'floor' || p.surface === 'west')));
check('反射斑与透射斑同时存在 = 光斑分裂',
  r15.patches.some(p => p.surface === 'east' && p.bounce === 0 && p.weight > 1e-4) &&
  r15.patches.some(p => p.bounce === 1 && p.weight > 1e-4));

console.log('\n[7] 条状光斑与通光缝隙一一对应');
const litGaps = new Set(openFloor.map(p => p.gap)).size;
check('每个通光缝隙产出独立条带', litGaps === openFloor.length);
check('玻璃临界角理论值 ≈41.1°', Math.abs(Math.asin(1 / 1.52) * 180 / Math.PI - 41.14) < 0.05);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
