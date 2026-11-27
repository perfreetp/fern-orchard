// DOM 桩测试：真实加载 HTML 内联脚本，验证页面代码的几何输出与渲染不抛错
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 通用桩：任意属性/方法都可安全调用 ----
function universalStub() {
  const f = function () { return stub; };
  const stub = new Proxy(f, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;           // 避免被当 thenable
      if (prop === 'style' || prop === 'classList' || prop === 'dataset') return stub;
      if (prop === 'value') return '';
      if (prop === 'width' || prop === 'height') return 960;
      if (prop === 'getContext' || prop === 'getBoundingClientRect' ||
          prop === 'addEventListener' || prop === 'setPointerCapture' ||
          prop === 'appendChild' || prop === 'querySelector' ||
          prop === 'createElement' || prop === 'getElementById') return stub;
      return stub;
    },
    set() { return true; },
    apply() { return stub; },
  });
  return stub;
}

const ctxStub = universalStub();
// createLinearGradient/RadialGradient 需要 addColorStop
ctxStub.createLinearGradient = () => ({ addColorStop() {} });
ctxStub.createRadialGradient = () => ({ addColorStop() {} });

const elementStub = () => {
  const el = universalStub();
  el.style = {};
  el.classList = { add() {}, remove() {} };
  el.value = '0';
  el.textContent = '';
  el.innerHTML = '';
  el.addEventListener = () => {};
  el.querySelector = () => ({ style: {}, textContent: '' });
  el.appendChild = () => {};
  return el;
};

const rafQueue = [];
const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return 1; },
  cancelAnimationFrame: () => {},
  document: {
    getElementById: () => elementStub(),
    createElement: () => elementStub(),
  },
  Math, Date, JSON, Object, Array, Number, String, Boolean, isNaN, parseInt, parseFloat,
  location: { hash: '' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(path.join(__dirname, '..', 'planted-tank-lighting.html'), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const exportLine = `\n;globalThis.__api = { zoneLight, lampAt, shadowPoly, occluders, zones, state, applyTime, draw, shadeSource, KEYS, AMBIENT };`;
vm.runInContext(inline + exportLine, sandbox);

const api = sandbox.__api;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? '→ ' + extra : ''); }
}

console.log('=== 1. 页面内联脚本几何输出（与 Node 验证脚本同公式）===');
// 早晨关键帧
const morning = api.lampAt(7);
const lm = api.zones.map(z => api.zoneLight(z, morning, 1.23));
check('7:00 A 明亮 (>0.9)', lm[0].intensity > 0.9, lm[0].intensity);
check('7:00 B 被沉木遮暗 (<0.5)', lm[1].intensity < 0.5, lm[1].intensity);
check('7:00 B 主遮挡物=沉木', lm[1].main === '沉木', lm[1].main);
check('7:00 B 遮荫来源方向=北', api.shadeSource(api.occluders[0], api.zones[1]) === '北');

// 正午
const noon = api.lampAt(12.5);
const ln = api.zones.map(z => api.zoneLight(z, noon, 2.34));
check('12:30 A/B 恢复明亮 (>0.75)', ln[0].intensity > 0.75 && ln[1].intensity > 0.75,
  `${ln[0].intensity}/${ln[1].intensity}`);

// 傍晚
const evening = api.lampAt(18);
const le = api.zones.map(z => api.zoneLight(z, evening, 3.45));
check('18:00 A 被遮暗 (<0.35)', le[0].intensity < 0.35, le[0].intensity);
check('18:00 B 明亮 (>0.9)', le[1].intensity > 0.9, le[1].intensity);
check('18:00 A 主遮挡物=沉木', le[0].main === '沉木');
check('18:00 A 遮荫来源方向=南', api.shadeSource(api.occluders[0], api.zones[0]) === '南');

// C 区对照
check('C 区全天基本不受沉木影响', lm[2].intensity > 0.8 && le[2].intensity > 0.8);

// 此消彼长（手动两端）
const north = api.zoneLight(api.zones[1], { x: 200, y: 75, h: 130 }, 0.5);
const south = api.zoneLight(api.zones[0], { x: 200, y: 385, h: 130 }, 0.5);
check('北灯 B 遮挡>50%', north.frac > 0.5, north.frac);
check('南灯 A 遮挡>75%', south.frac > 0.75, south.frac);

console.log('\n=== 2. 波纹抖动只微动边缘，不改变光强档位 ===');
const phases = [0, 0.7, 1.4, 2.1, 3.0, 4.2, 5.5];
const vals = phases.map(p => api.zoneLight(api.zones[1], morning, p).intensity);
const spread = Math.max(...vals) - Math.min(...vals);
check('B 区光强在波纹下波动 < 0.08', spread < 0.08, `spread=${spread.toFixed(3)} vals=${vals.map(v=>v.toFixed(2)).join(',')}`);

console.log('\n=== 3. 灯高→阴影长度单调 ===');
const lens = [120, 200, 300, 420].map(h => {
  const sp = api.shadowPoly(api.occluders[0], { x: 200, y: 75, h }, null);
  return Math.max(...sp.map(p => Math.hypot(p[0] - 200, p[1] - 273)));
});
check('阴影最远点随灯高增加而递减', lens.every((v, i) => i === 0 || v < lens[i - 1]), lens.map(v => v.toFixed(0)).join('>'));

console.log('\n=== 4. 时间轴开关灯 ===');
check('3:00 关灯返回 null', api.lampAt(3) === null);
check('20:00 关灯返回 null', api.lampAt(20) === null);
check('7:00/18:00 边界有灯', api.lampAt(7) !== null && api.lampAt(18) !== null);

console.log('\n=== 5. applyTime 切换夜间状态 ===');
api.state.time = 3; api.applyTime();
check('夜间 lampOn=false', api.state.lampOn === false);
api.state.time = 10; api.applyTime();
check('白天 lampOn=true 且灯位被关键帧驱动', api.state.lampOn === true && typeof api.state.lamp.y === 'number');

console.log('\n=== 6. 全时段 draw() 不抛错（含夜间、波纹各相位）===');
let drawOk = true; const errs = [];
for (const t of [0, 3, 6.9, 7, 9.5, 12.5, 16, 18, 21, 24]) {
  try {
    api.state.time = t; api.applyTime();
    api.state.wavePhase = t * 0.37;
    api.draw(0);
  } catch (e) { drawOk = false; errs.push(`t=${t}: ${e.message}`); }
}
check('draw() 全部通过', drawOk, errs.join(' | '));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
