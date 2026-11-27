/* 无头运行 scene.js：mock BABYLON 与 DOM，验证完整更新循环不抛错、光斑网格被正确构建 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---- mock DOM ---- */
const handlers = {};
function makeEl(id) {
  return {
    id, value: id === 'time' ? '12' : '60', innerHTML: '', textContent: '',
    addEventListener: (ev, fn) => { (handlers[id + ':' + ev] = handlers[id + ':' + ev] || []).push(fn); },
  };
}
const els = {};
['renderCanvas', 'time', 'angle', 'hud', 'btnNoon', 'btnDusk', 'btnClose', 'btnOpen', 'tVal', 'aVal']
  .forEach(id => { els[id] = makeEl(id); });
const documentMock = {
  getElementById: id => els[id] || makeEl(id),
};
const pointerHandlers = [];
const canvasMock = {
  style: {}, addEventListener: () => {}, removeEventListener: () => {},
  getContext: () => null, width: 800, height: 600,
};

/* ---- mock BABYLON（只实现 scene.js 用到的接口，记录网格构建） ---- */
const builtMeshes = [];
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copyFromFloats(x, y, z) { this.x = x; this.y = y; this.z = z; }
}
class Matrix { static Translation(x, y, z) { return { m: [x, y, z] }; } }
class Color3 { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } }
class Color4 { constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a; } }
class BaseMesh {
  constructor(name) { this.name = name; this.enabled = true; this.visibility = 1; this.metadata = {}; this.rotation = { x: 0, y: 0, z: 0 }; this.position = new Vector3(); }
  setEnabled(v) { this.enabled = v; }
  isEnabled() { return this.enabled; }
  setPivotMatrix() { }
}
class Mesh extends BaseMesh {
  constructor(name) { super(name); builtMeshes.push({ name, verts: 0 }); this._idx = builtMeshes.length - 1; }
  applyVertexData(ud) { this.vertexCount = ud.positions.length / 3; builtMeshes[this._idx].verts = this.vertexCount; }
}
const MeshBuilder = {
  CreateBox: (name) => new Mesh(name),
  CreatePlane: (name) => new Mesh(name),
  CreateSphere: (name) => new Mesh(name),
};
class VertexData {
  constructor() { this.positions = []; this.indices = []; this.normals = []; }
  static ComputeNormals(pos, idx, out) { for (let i = 0; i < pos.length; i++) out[i] = 0; }
  applyToMesh(mesh) { mesh.applyVertexData(this); }
}
class Material {
  constructor(name) { this.name = name; this.alpha = 1; }
}
class StandardMaterial extends Material {
  constructor() { super(); this.diffuseColor = new Color3(); this.specularColor = new Color3(); this.emissiveColor = new Color3(); }
}
class EmissiveMaterial extends Material {
  constructor() { super(); this.diffuseColor = new Color3(); this.emissiveColor = new Color3(); }
}
class Light { constructor() { this.intensity = 1; this.direction = new Vector3(); } }
class HemisphericLight extends Light { constructor(n, v) { super(); this.groundColor = new Color3(); } }
class DirectionalLight extends Light { }
class ArcRotateCamera {
  constructor() { this.attachControl = () => {}; this.lowerRadiusLimit = 0; this.upperRadiusLimit = 0; this.upperBetaLimit = 0; this.wheelDeltaPercentage = 0; }
}
class Scene {
  constructor() { this.clearColor = null; this._pointers = []; }
  onPointerObservable = { add: (o) => pointerHandlers.push(o) };
}
class Engine {
  constructor() { }
  resize() { }
  runRenderLoop(fn) { this._loop = fn; }
}
const BABYLON = {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  StandardMaterial, EmissiveMaterial, Vector3, Matrix, Color3, Color4,
  Mesh, MeshBuilder, VertexData,
  PointerEventTypes: { POINTERPICK: 'pick' },
};

const sandbox = {
  window: {}, document: documentMock, BABYLON, console,
  setTimeout, clearTimeout, URLSearchParams, URL,
  location: { search: '' },
};
sandbox.window.addEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* 加载 geometry.js（UMD 会挂到 window/globalThis） */
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/geometry.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scene.js'), 'utf8'), sandbox);

let pass = 0, fail = 0;
const check = (name, cond, d) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (d ? ' — ' + d : '')); } };

console.log('\n[1] 初始帧（正午 + 东墙镜面）构建了光斑与光束网格');
const n1 = builtMeshes.length;
const names = new Set(builtMeshes.map(m => m.name));
check('生成了多种网格（建筑体块/叶片/玻璃/光斑池）', names.size >= 8, 'unique=' + names.size);
check('含光斑(patch)与光束(shaft)网格', [...names].some(n => n === 'patch') && [...names].some(n => n === 'shaft'),
  [...names].join(','));
check('光斑网格带有效顶点(六面体8点)', builtMeshes.filter(m => m.name === 'patch').every(m => m.verts === 8));
check('HUD 已渲染', els.hud.innerHTML.includes('时刻'), els.hud.innerHTML.slice(0, 40));
check('HUD 显示直射光斑条数', /直射 \d+ 条/.test(els.hud.innerHTML));

console.log('\n[2] 拖时间轴到傍晚，触发 input 处理，网格重建不抛错');
els.time.value = '17.8';
let threw = false;
try { handlers['time:input'].forEach(fn => fn()); } catch (e) { threw = true; console.log(e.stack); }
check('时间轴 input 无异常', !threw);
check('傍晚 HUD 显示东墙入射角', els.hud.innerHTML.includes('东墙入射角'));

console.log('\n[3] 调叶片到闭合/全开，网格重建不抛错，闭合时光斑减少');
els.angle.value = '0';
threw = false; try { handlers['angle:input'].forEach(fn => fn()); } catch (e) { threw = true; }
const closedHud = els.hud.innerHTML;
check('闭合 0° 无异常', !threw);
const closedCount = parseInt((closedHud.match(/直射 (\d+) 条/) || [])[1] || '0', 10);
els.angle.value = '90';
handlers['angle:input'].forEach(fn => fn());
const openCount = parseInt((els.hud.innerHTML.match(/直射 (\d+) 条/) || [])[1] || '0', 10);
check('全开光斑数 > 闭合光斑数', openCount > closedCount, `open=${openCount} closed=${closedCount}`);
check('闭合时开孔率≈0', closedHud.includes('开孔率 0.00') || /开孔率 0\.0/.test(closedHud), (closedHud.match(/开孔率 [\d.]+/) || [''])[0]);

console.log('\n[4] 预置按钮（正午/傍晚/闭合/全开）');
threw = false;
try {
  handlers['btnNoon:click'].forEach(fn => fn());
  handlers['btnDusk:click'].forEach(fn => fn());
  handlers['btnClose:click'].forEach(fn => fn());
  handlers['btnOpen:click'].forEach(fn => fn());
} catch (e) { threw = true; console.log(e.stack); }
check('四个预置按钮均无异常', !threw);

console.log('\n[5] 点选玻璃面板切换镜面（pointer pick）');
const pickInfo = { pickedMesh: { metadata: { side: -1, row: 2 }, material: {} } };
threw = false;
try { pointerHandlers.forEach(o => o({ type: 'pick', pickInfo })); } catch (e) { threw = true; console.log(e.stack); }
check('点选西墙玻璃无异常', !threw);
check('HUD 镜面面板数变为 2（初始东墙1 + 西墙1）', els.hud.innerHTML.includes('镜面面板 2'),
  (els.hud.innerHTML.match(/镜面面板 \d+/) || [''])[0]);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
