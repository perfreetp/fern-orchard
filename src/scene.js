/*
 * scene.js — Babylon.js 渲染层
 * 物理光斑/叶片遮挡/Fresnel 全部来自 geometry.js（AtriumGeo），本文件只负责建模与可视化。
 */
(function () {
  'use strict';
  var G = window.AtriumGeo;

  /* ---------------- 与 geometry 测试锁定的场景常量 ---------------- */
  var CFG = {
    XH: 2.5, YH: 10.5, ZH: 3.5,          // 中庭半宽 / 墙高 / 半深
    OH: 1.8, n: 8, pitch: 0.45, w: 0.225, // 天窗开口 / 叶片
    floorH: 3.5,                          // 每层层高（3 层到 10.5）
    outer: 5.0                            // 建筑外轮廓半宽（环形楼板）
  };
  var PANEL_ROWS = 7, ROW_H = CFG.YH / PANEL_ROWS;
  var panelBands = [];
  for (var r = 0; r < PANEL_ROWS; r++) {
    panelBands.push({ y0: r * ROW_H, y1: (r + 1) * ROW_H, row: r });
  }

  var canvas = document.getElementById('renderCanvas');
  var engine = new BABYLON.Engine(canvas, true, { stencil: true, antialias: true });
  var scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05, 0.07, 0.11, 1);

  /* ---------------- 相机 ---------------- */
  /* 相机置于南侧 -z（半透明南墙一侧），俯视中庭，可同时看到天窗、地面与东墙光斑。
     支持 URL 参数 cam=(alpha,beta,radius) 调整视角便于观察不同墙面 */
  var camQs = new URLSearchParams(location.search).get('cam');
  var camAlpha = -1.05, camBeta = 0.78, camR = 15.5;
  if (camQs) {
    var cp = camQs.split(',').map(Number);
    if (cp.length === 3 && cp.every(function (v) { return !isNaN(v); })) {
      camAlpha = cp[0]; camBeta = cp[1]; camR = cp[2];
    }
  }
  var camera = new BABYLON.ArcRotateCamera('cam', camAlpha, camBeta, camR,
    new BABYLON.Vector3(0, 4.2, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 30;
  camera.upperBetaLimit = Math.PI / 2.05; camera.lowerBetaLimit = 0.15;
  camera.wheelDeltaPercentage = 0.01;

  /* ---------------- 灯光 ---------------- */
  var hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55; hemi.groundColor = new BABYLON.Color3(0.18, 0.16, 0.14);
  var sunLight = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(0, -1, 0), scene);
  sunLight.intensity = 1.1;

  /* ---------------- 材质 ---------------- */
  function std(name, opts) {
    var m = new BABYLON.StandardMaterial(name, scene);
    Object.keys(opts || {}).forEach(function (k) { m[k] = opts[k]; });
    return m;
  }
  var matConcrete = std('concrete', { diffuseColor: new BABYLON.Color3(0.5, 0.49, 0.47), specularColor: new BABYLON.Color3(0.05, 0.05, 0.05) });
  var matFloor = std('floor', { diffuseColor: new BABYLON.Color3(0.52, 0.48, 0.42), specularColor: new BABYLON.Color3(0.06, 0.06, 0.06) });
  var matCutaway = std('cutaway', { diffuseColor: new BABYLON.Color3(0.42, 0.41, 0.4), specularColor: new BABYLON.Color3(0.04, 0.04, 0.04), alpha: 0.16 });
  var matFrame = std('frame', { diffuseColor: new BABYLON.Color3(0.12, 0.13, 0.15), specularColor: new BABYLON.Color3(0.3, 0.3, 0.3) });
  var matBlade = std('blade', { diffuseColor: new BABYLON.Color3(0.28, 0.31, 0.35), specularColor: new BABYLON.Color3(0.4, 0.4, 0.45) });
  var matSolid = std('solid', { diffuseColor: new BABYLON.Color3(0.45, 0.44, 0.42) });
  var matGlass = new BABYLON.StandardMaterial('glass', scene);
  matGlass.diffuseColor = new BABYLON.Color3(0.5, 0.72, 0.83);
  matGlass.alpha = 0.16; matGlass.specularColor = new BABYLON.Color3(0.85, 0.9, 0.95);
  matGlass.emissiveColor = new BABYLON.Color3(0.04, 0.07, 0.1);
  var matMirror = new BABYLON.StandardMaterial('mirror', scene);
  matMirror.diffuseColor = new BABYLON.Color3(0.85, 0.9, 0.95);
  matMirror.specularColor = new BABYLON.Color3(1, 1, 1);
  matMirror.emissiveColor = new BABYLON.Color3(0.25, 0.3, 0.38);

  /* ---------------- 建筑体块 ---------------- */
  function box(name, w, h, d, x, y, z, mat) {
    var b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z); b.material = mat; return b;
  }

  /* 地面与中庭三层楼板边线（中央通高中庭，楼板退到中庭之外、不遮挡剖面视线） */
  box('ground', CFG.XH * 2 + 1.5, 0.2, CFG.ZH * 2 + 1.5, 0, -0.1, 0, matConcrete);
  [1, 2].forEach(function (lv) {
    var y = lv * CFG.floorH;
    /* 仅在东西幕墙外侧做窄楼板带，表达三层体量而不挡住中庭内部 */
    var lip = 0.55;
    box('lip' + lv + 'E', lip, 0.22, CFG.ZH * 2, CFG.XH + lip / 2, y, 0, matFloor);
    box('lip' + lv + 'W', lip, 0.22, CFG.ZH * 2, -CFG.XH - lip / 2, y, 0, matFloor);
  });
  /* 中庭实墙：南墙半透明（剖面视角，让相机看到室内光斑），北墙保留实体 */
  box('wallN', CFG.XH * 2, CFG.YH, 0.3, 0, CFG.YH / 2, CFG.ZH + 0.15, matConcrete);
  var wallS = box('wallS', CFG.XH * 2, CFG.YH, 0.3, 0, CFG.YH / 2, -CFG.ZH - 0.15, matCutaway);
  /* 四角结构柱 */
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (s, i) {
    box('col' + i, 0.35, CFG.YH, 0.35, s[0] * CFG.XH, CFG.YH / 2, s[1] * CFG.ZH, matFrame);
  });

  /* 东西玻璃幕墙：横档 + 可点选玻璃面板 */
  var glassMeshes = [];
  function buildCurtain(side) {
    var x = side * (CFG.XH + 0.02);
    for (var rr = 0; rr <= PANEL_ROWS; rr++) {
      box('mull' + side + '_' + rr, 0.12, 0.08, CFG.ZH * 2, x, rr * ROW_H, 0, matFrame);
    }
    for (var row = 0; row < PANEL_ROWS; row++) {
      var panel = BABYLON.MeshBuilder.CreatePlane('glass' + side + '_' + row,
        { height: ROW_H - 0.1, width: CFG.ZH * 2 - 0.1 }, scene);
      panel.position.set(x + side * 0.01, row * ROW_H + ROW_H / 2, 0);
      panel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      panel.material = matGlass;
      panel.metadata = { side: side, row: row, isMirror: false };
      glassMeshes.push(panel);
    }
    /* 竖向边框 */
    box('frame' + side + 'A', 0.12, CFG.YH, 0.1, x, CFG.YH / 2, CFG.ZH, matFrame);
    box('frame' + side + 'B', 0.12, CFG.YH, 0.1, x, CFG.YH / 2, -CFG.ZH, matFrame);
  }
  buildCurtain(1); buildCurtain(-1);

  /* 屋面：两侧窄檐口 + 中央天窗开口（檐口收窄，避免遮挡墙顶光斑） */
  var eaveW = 0.32;
  box('eaveE', eaveW, 0.28, CFG.ZH * 2, CFG.XH - eaveW / 2, CFG.YH, 0, matSolid);
  box('eaveW', eaveW, 0.28, CFG.ZH * 2, -CFG.XH + eaveW / 2, CFG.YH, 0, matSolid);

  /* 天窗叶片阵列（绕 z 轴的平板，绕板「上缘」A 点开合，与 geometry.bladeSegment 对齐） */
  var blades = [];
  for (var i = 0; i < CFG.n; i++) {
    var blade = BABYLON.MeshBuilder.CreateBox('blade' + i,
      { width: CFG.w * 2, height: 0.06, depth: CFG.ZH * 2 - 0.15 }, scene);
    var cx = -CFG.OH + CFG.pitch * (i + 0.5);
    /* 几何板段：A=[cx-w·cosα, YH]，B=[cx+w·cosα, YH-2w·sinα]。
       以 A 为枢轴：把网格中心相对 A 偏移 -w·x，再绕 z 转 -α */
    blade.position.set(cx, CFG.YH, 0);
    blade.setPivotMatrix(BABYLON.Matrix.Translation(-CFG.w, 0, 0), false);
    blade.material = matBlade;
    blade.metadata = { cx: cx };
    blades.push(blade);
  }
  function setBladeAngle(alphaDeg) {
    var a = alphaDeg * Math.PI / 180;
    blades.forEach(function (blade) {
      blade.rotation.z = -a;
      /* 枢轴 A 的世界位置随 α 移动到 [cx - w·cosα, YH] */
      blade.position.x = blade.metadata.cx - CFG.w * Math.cos(a);
      blade.position.y = CFG.YH;
    });
  }

  /* ---------------- 太阳光可视化 ---------------- */
  var sunSphere = BABYLON.MeshBuilder.CreateSphere('sun', { diameter: 0.9 }, scene);
  var sunMat = new BABYLON.StandardMaterial('sunMat', scene);
  sunMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0.35);
  sunMat.disableLighting = true;
  sunSphere.material = sunMat;

  /* ---------------- 光斑网格池（复用，避免每帧 GC） ---------------- */
  var patchPool = [];
  var shaftPool = [];
  function makePatchMaterial(name, color) {
    var m = new BABYLON.StandardMaterial(name, scene);
    m.emissiveColor = color; m.diffuseColor = color;
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    m.alpha = 0.95; m.disableLighting = true;
    m.backFaceCulling = false; /* 双面，确保墙面光斑任意视角可见 */
    return m;
  }
  var matPatchDirect = makePatchMaterial('pDirect', new BABYLON.Color3(1, 0.86, 0.45));
  var matPatchReflect = makePatchMaterial('pReflect', new BABYLON.Color3(1, 0.5, 0.2));
  var matShaft = new BABYLON.StandardMaterial('shaft', scene);
  matShaft.emissiveColor = new BABYLON.Color3(1, 0.85, 0.5);
  matShaft.alpha = 0.055; matShaft.disableLighting = true;

  function acquire(pool, name) {
    for (var k = 0; k < pool.length; k++) if (!pool[k].isEnabled()) return pool[k];
    var m = new BABYLON.Mesh(name, scene);
    pool.push(m); return m;
  }
  function releaseAll(pool) { pool.forEach(function (m) { m.setEnabled(false); }); }

  /* 六面体 12 三角形索引（8 顶点，front/back 各 4） */
  var HEX_FACES = [
    0, 1, 2, 0, 2, 3,       // front
    4, 6, 5, 4, 7, 6,       // back
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0
  ];
  function buildHexMesh(mesh, verts, mat) {
    var pos = [];
    verts.forEach(function (v) { pos.push(v[0], v[1], v[2]); });
    var normals = new Array(pos.length).fill(0);
    var ud = new BABYLON.VertexData();
    ud.positions = pos; ud.indices = HEX_FACES;
    BABYLON.VertexData.ComputeNormals(pos, HEX_FACES, normals); /* 每面真实法线 */
    ud.normals = normals;
    ud.applyToMesh(mesh, true);
    mesh.material = mat; mesh.setEnabled(true);
    mesh.useVertexAlpha = false;
  }

  /* 镜面面板集合：key = side_row */
  var mirrors = {};
  function isMirror(p) {
    if (p.bounce === 0 && p.surface !== 'floor') {
      return !!mirrors[p.surface + '_' + p.row];
    }
    if (p.bounce === 1) return !!mirrors[p.sourceWall + '_' + p.sourceRow];
    return false;
  }

  /* ---------------- 主更新 ---------------- */
  var state = { hour: 12, alpha: 60 };

  function sunDirection(hour) {
    var t = (hour - 6) / 12;
    var elev = (1.2 + 78.8 * Math.sin(Math.PI * t)) * Math.PI / 180;
    var off = (25 + 30 * Math.max(0, (hour - 12) / 6)) * Math.PI / 180;
    return {
      elev: elev, off: off,
      d: G.norm3([
        Math.cos(elev) * Math.sin(off),
        -Math.sin(elev),
        -Math.cos(elev) * Math.cos(off)
      ])
    };
  }

  function update() {
    var sun = sunDirection(state.hour);
    var geo = G.compute({
      XH: CFG.XH, YH: CFG.YH, OH: CFG.OH, n: CFG.n, pitch: CFG.pitch, w: CFG.w,
      alpha: state.alpha * Math.PI / 180, d3: sun.d, panelBands: panelBands
    });
    setBladeAngle(state.alpha);

    /* 太阳位置（与光向相反，在建筑外） */
    var sunPos = new BABYLON.Vector3(-sun.d[0] * 22, CFG.YH - sun.d[1] * 22, -sun.d[2] * 22);
    sunSphere.position = sunPos;
    sunLight.direction.copyFromFloats(sun.d[0], sun.d[1], sun.d[2]);

    releaseAll(patchPool); releaseAll(shaftPool);

    var countDirect = 0, countReflect = 0;
    geo.patches.forEach(function (p) {
      var mirror = isMirror(p);
      var weight;
      if (p.bounce === 0) {
        if (p.surface === 'floor') weight = 1;
        else weight = mirror ? 0.12 : p.weight; /* 镜面：直射透射被抑制，光斑变暗 */
      } else {
        weight = mirror ? Math.min(1, p.weight + 0.55) : p.weight * 0.5;
      }
      if (weight < 0.03) return;
      var ext = G.extrudePatch(p, geo.d3, geo.d2, CFG.ZH, CFG.XH);
      var mesh = acquire(patchPool, 'patch');
      var mat = p.bounce === 1 ? matPatchReflect : matPatchDirect;
      buildHexMesh(mesh, ext.verts, mat);
      mesh.visibility = Math.min(1, 0.25 + weight * 0.75);
      if (p.bounce === 1) countReflect++; else countDirect++;
    });

    /* 光束体可视化：取若干通光缝隙，从屋面缝隙沿光向挤出半透明体 */
    var shown = 0;
    geo.gaps.forEach(function (gap, gi) {
      if (gap.throughput < 0.12 || shown >= 6) return;
      if (gi % 2 !== 0) return;
      var pl = gap.pl, pr = gap.pr;
      var d2 = geo.d2, len = CFG.YH / Math.max(0.25, -d2[1]);
      var verts = [
        [pl[0], pl[1] - 0.05, -CFG.ZH], [pl[0], pl[1] - 0.05, CFG.ZH],
        [pr[0], pr[1] - 0.05, CFG.ZH], [pr[0], pr[1] - 0.05, -CFG.ZH],
        [pl[0] + d2[0] * len, pl[1] + d2[1] * len, -CFG.ZH],
        [pl[0] + d2[0] * len, pl[1] + d2[1] * len, CFG.ZH],
        [pr[0] + d2[0] * len, pr[1] + d2[1] * len, CFG.ZH],
        [pr[0] + d2[0] * len, pr[1] + d2[1] * len, -CFG.ZH]
      ];
      var sm = acquire(shaftPool, 'shaft');
      buildHexMesh(sm, verts, matShaft);
      sm.visibility = 0.5 + gap.throughput * 0.5;
      shown++;
    });

    updateHUD(sun, geo, countDirect, countReflect);
  }

  /* ---------------- 点选玻璃 → 镜面 ---------------- */
  scene.onPointerObservable.add(function (info) {
    if (info.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
    var picked = info.pickInfo.pickedMesh;
    if (!picked || !picked.metadata || picked.metadata.row === undefined) return;
    var key = (picked.metadata.side > 0 ? 'east' : 'west') + '_' + picked.metadata.row;
    if (mirrors[key]) { delete mirrors[key]; picked.metadata.isMirror = false; picked.material = matGlass; }
    else { mirrors[key] = true; picked.metadata.isMirror = true; picked.material = matMirror; }
    update();
  });

  /* ---------------- HUD ---------------- */
  function el(id) { return document.getElementById(id); }
  function updateHUD(sun, geo, cd, cr) {
    var fe = geo.fresnel.east, fw = geo.fresnel.west;
    function f(x) { return x ? x.theta.toFixed(1) + '° (R=' + x.R.toFixed(2) + ',T=' + x.T.toFixed(2) + ')' : '背阴'; }
    el('hud').innerHTML =
      '<b>时刻</b> ' + state.hour.toFixed(1) + ' 时　|　太阳高度 ' + (sun.elev * 180 / Math.PI).toFixed(1) + '°　方位偏西 ' + (sun.off * 180 / Math.PI).toFixed(1) + '°<br>' +
      '<b>叶片张开</b> ' + state.alpha.toFixed(0) + '°（0° 闭合 / 90° 全开）　开孔率 ' +
      (geo.gaps.reduce(function (s, g) { return s + g.throughput; }, 0) / geo.gaps.length).toFixed(2) + '<br>' +
      '<b>东墙入射角</b> ' + f(fe) + '　<b>西墙</b> ' + f(fw) + '<br>' +
      '<b>光斑</b> 直射 ' + cd + ' 条' + (cr ? '，镜面反射 ' + cr + ' 条（橙色）' : '') +
      '　|　镜面面板 ' + Object.keys(mirrors).length + ' 块';
  }

  /* ---------------- UI 绑定 ---------------- */
  var timeSlider = el('time'), angleSlider = el('angle');
  timeSlider.addEventListener('input', function () {
    state.hour = parseFloat(timeSlider.value); update();
  });
  angleSlider.addEventListener('input', function () {
    state.alpha = parseFloat(angleSlider.value); update();
  });
  el('btnNoon').addEventListener('click', function () {
    state.hour = 12; timeSlider.value = 12; update();
  });
  el('btnDusk').addEventListener('click', function () {
    state.hour = 17.8; timeSlider.value = 17.8; update();
  });
  el('btnClose').addEventListener('click', function () {
    state.alpha = 0; angleSlider.value = 0; update();
  });
  el('btnOpen').addEventListener('click', function () {
    state.alpha = 90; angleSlider.value = 90; update();
  });

  /* 初始：支持 URL 参数 ?hour=&angle= 便于定位，默认正午 + 一块东墙镜面 */
  var qs = new URLSearchParams(location.search);
  if (qs.has('hour')) { state.hour = parseFloat(qs.get('hour')); timeSlider.value = state.hour; el('tVal').textContent = state.hour.toFixed(1) + ' 时'; }
  if (qs.has('angle')) { state.alpha = parseFloat(qs.get('angle')); angleSlider.value = state.alpha; el('aVal').textContent = state.alpha + '°'; }
  mirrors.east_3 = true;
  glassMeshes.forEach(function (p) {
    if (p.metadata.side > 0 && p.metadata.row === 3) p.material = matMirror;
  });
  update();

  window.addEventListener('resize', function () { engine.resize(); });
  engine.runRenderLoop(function () { scene.render(); });
})();
