/*
 * AtriumGeo — 纯几何计算模块（无 Babylon 依赖，可在 Node 中测试）
 *
 * 坐标约定：
 *   中庭室内 x ∈ [-XH, XH]，z ∈ [-ZH, ZH]，y ∈ [0, YH]
 *   天窗叶片沿 z 方向布置，绕 z 轴旋转，在 (x, y) 二维剖面内做光线求交
 *   z 方向由主流程按光线 dz 分量挤出
 *
 * 叶片模型（允许简化为平板）：
 *   叶片 i 中心 cx_i，半宽 w（2w = pitch，闭合时板缘恰好相接）
 *   张开角 α：0 = 水平闭合，90° = 竖直全开
 *   板段端点 A=[cx-w·cosα, YH]，B=[cx+w·cosα, YH-2w·sinα]
 */
(function (global) {
  'use strict';

  /* ---------------- 2D 向量（[x, y]） ---------------- */
  function v2sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function v2cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
  function v2len(a) { return Math.hypot(a[0], a[1]); }
  function v2norm(a) { var l = v2len(a) || 1; return [a[0] / l, a[1] / l]; }
  function v2lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm3(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* Schlick 菲涅尔近似：r0 玻璃≈0.04，镜面取≈0.97 */
  function fresnel(cosTheta, r0) {
    var c = Math.min(1, Math.max(0, cosTheta));
    return r0 + (1 - r0) * Math.pow(1 - c, 5);
  }

  /*
   * 二维射线 P+tD 与线段 A→B 求交，返回 t（t 需 ≥0，u∈[0,1]），不相交返回 null
   * 解：P+tD = A+uE，t = cross(E,f)/cross(D,E)，u = cross(D,f)/cross(D,E)，f=P-A
   */
  function raySeg2D(P, D, A, B) {
    var E = v2sub(B, A), f = v2sub(P, A);
    var den = v2cross(D, E);
    if (Math.abs(den) < 1e-12) return null;
    var t = v2cross(E, f) / den;
    var u = v2cross(D, f) / den;
    if (t >= 1e-7 && u >= -1e-9 && u <= 1 + 1e-9) return t;
    return null;
  }

  /* 叶片板段几何 */
  function bladeSegment(cx, w, alpha, YH) {
    var ca = Math.cos(alpha), sa = Math.sin(alpha);
    return {
      A: [cx - w * ca, YH],
      B: [cx + w * ca, YH - 2 * w * sa]
    };
  }

  /*
   * 构建全部叶片与缝隙。缝隙边界取真实板缘点（含两侧山墙点），
   * 闭合时缝隙宽度为 0，全开时宽度 = pitch。
   */
  /*
   * 构建全部叶片与缝隙。天窗开口居中，范围 [-OH, OH]，两侧 [OH, XH] 为实体檐口。
   * 叶片仅在开口内；缝隙边界取真实板缘点，闭合时缝隙为 0，全开时 = pitch。
   */
  function buildLouver(cfg) {
    var XH = cfg.XH, YH = cfg.YH, n = cfg.n, pitch = cfg.pitch, w = cfg.w, alpha = cfg.alpha;
    var OH = cfg.OH != null ? cfg.OH : XH;
    var blades = [];
    for (var i = 0; i < n; i++) {
      var cx = -OH + pitch * (i + 0.5);
      var seg = bladeSegment(cx, w, alpha, YH);
      seg.cx = cx;
      blades.push(seg);
    }
    var gaps = [];
    for (var g = 0; g <= n; g++) {
      var pl, pr;
      if (g === 0) {
        pl = [-OH, YH];
        pr = blades[0].A;
      } else if (g === n) {
        pl = blades[n - 1].B;
        pr = [OH, YH];
      } else {
        pl = blades[g - 1].B;
        pr = blades[g].A;
      }
      var blockedL = Infinity, blockedR = Infinity;
      for (var b = 0; b < n; b++) {
        var tl = raySeg2D(pl, cfg.d2, blades[b].A, blades[b].B);
        var tr = raySeg2D(pr, cfg.d2, blades[b].A, blades[b].B);
        if (tl !== null && tl < blockedL) blockedL = tl;
        if (tr !== null && tr < blockedR) blockedR = tr;
      }
      gaps.push({
        index: g,
        pl: pl, pr: pr,
        sL: blockedL, sR: blockedR,
        /* 有效开孔率：闭合(α=0)板缘相接无洞→0；竖直全开(α=90°)→1。
           檐口旁的边界缝宽度恒为 pitch/2，按 sinα 缩放 */
        throughput: g === 0 || g === n ? 0.5 * Math.sin(alpha) : Math.sin(alpha)
      });
    }
    return { blades: blades, gaps: gaps, OH: OH };
  }

  /* 带属性顶点（s=沿光程参数，u=缝隙横向插值 0..1） */
  function v(x, y, s, u) { return { x: x, y: y, s: s, u: u }; }
  var BIG = 1e6;

  function stripQuad(pl, pr, d, sL, sR) {
    var a = sL === Infinity ? BIG : sL;
    var b = sR === Infinity ? BIG : sR;
    return [
      v(pl[0], pl[1], 0, 0),
      v(pr[0], pr[1], 0, 1),
      v(pr[0] + b * d[0], pr[1] + b * d[1], b, 1),
      v(pl[0] + a * d[0], pl[1] + a * d[1], a, 0)
    ];
  }

  function lerpVert(S, E, t) {
    return v(
      S.x + (E.x - S.x) * t,
      S.y + (E.y - S.y) * t,
      S.s + (E.s - S.s) * t,
      S.u + (E.u - S.u) * t
    );
  }

  /*
   * Sutherland–Hodgman 半平面裁剪。
   * 有向直线 lp→ld，保留左侧：cross(ld, p-lp) ≥ 0
   */
  function clipHalfPlane(poly, lp, ld) {
    function f(p) { return ld[0] * (p.y - lp[1]) - ld[1] * (p.x - lp[0]); }
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var S = poly[i], E = poly[(i + 1) % poly.length];
      var fS = f(S), fE = f(E);
      var inS = fS >= -1e-9, inE = fE >= -1e-9;
      if (inE) {
        if (!inS) out.push(lerpVert(S, E, fS / (fS - fE)));
        out.push(E);
      } else if (inS) {
        out.push(lerpVert(S, E, fS / (fS - fE)));
      }
    }
    return out;
  }

  /*
   * 求光带四边形在接收线段（地面/墙面）上照亮的子区间，
   * 可按 y 方向面板分带（幕墙横档）切分，返回若干 {p1,p2,row}。
   */
  function litIntervals(quad, rec, bands) {
    var poly = clipHalfPlane(quad, rec.lp, rec.ld);
    var ldLen2 = rec.ld[0] * rec.ld[0] + rec.ld[1] * rec.ld[1];
    var hits = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      var dval = rec.ld[0] * (p.y - rec.lp[1]) - rec.ld[1] * (p.x - rec.lp[0]);
      if (Math.abs(dval) < 1e-7) {
        var k = ((p.x - rec.lp[0]) * rec.ld[0] + (p.y - rec.lp[1]) * rec.ld[1]) / ldLen2;
        if (k >= -1e-7 && k <= rec.len + 1e-7) hits.push({ k: Math.min(rec.len, Math.max(0, k)), p: p });
      }
    }
    if (hits.length < 2) return [];
    var k0 = hits[0].k, k1 = hits[0].k;
    for (var h = 1; h < hits.length; h++) {
      k0 = Math.min(k0, hits[h].k);
      k1 = Math.max(k1, hits[h].k);
    }
    if (k1 - k0 < 1e-6) return [];

    /* 用两端 k 重新插值出标准属性顶点 */
    function pointAt(k) {
      var x = rec.lp[0] + rec.ld[0] * k, y = rec.lp[1] + rec.ld[1] * k;
      var near = hits[0].p, nd = Infinity;
      for (var j = 0; j < hits.length; j++) {
        var dd = Math.abs(hits[j].k - k);
        if (dd < nd) { nd = dd; near = hits[j].p; }
      }
      return v(x, y, near.s, near.u);
    }
    var pA = pointAt(k0), pB = pointAt(k1);

    if (!bands) return [{ p1: pA, p2: pB, row: -1 }];
    var out = [];
    /* 接收线段为竖直墙时，k 即沿 ld 的距离；bands 用世界 y 给出，换算到 k */
    for (var bi = 0; bi < bands.length; bi++) {
      var band = bands[bi];
      var c0 = worldToK(rec, band.y0), c1 = worldToK(rec, band.y1);
      var lo = Math.max(k0, Math.min(c0, c1)), hi = Math.min(k1, Math.max(c0, c1));
      if (hi - lo > 1e-6) {
        var t0 = (lo - k0) / (k1 - k0), t1 = (hi - k0) / (k1 - k0);
        out.push({
          p1: lerpVert(pA, pB, t0),
          p2: lerpVert(pA, pB, t1),
          row: band.row
        });
      }
    }
    return out;
  }

  function worldToK(rec, y) {
    /* lp + k·ld 中解 y（ld 为单位向量） */
    if (Math.abs(rec.ld[1]) < 1e-9) return 0;
    return (y - rec.lp[1]) / rec.ld[1];
  }

  /*
   * 主入口：计算一帧内所有光斑片段（二维剖面），z 挤出与材质由渲染层完成。
   *
   * cfg: { XH, YH, n, pitch, w, alpha, d3:[太阳光方向单位向量], panelBands:[{y0,y1,row}] }
   * 返回: { patches:[...], gaps, fresnel:{east:{cosT,R,T}, west:{...}} }
   */
  function compute(cfg) {
    var XH = cfg.XH, YH = cfg.YH, d3 = cfg.d3;
    var d2 = v2norm([d3[0], d3[1]]);
    cfg.d2 = d2;

    var louver = buildLouver(cfg);
    var patches = [];

    /* 接收面半平面（保留室内一侧） */
    var recFloor = { name: 'floor', lp: [-XH, 0], ld: [1, 0], len: 2 * XH };
    var recWest = { name: 'west', lp: [-XH, 0], ld: [0, -1], len: YH };
    var recEast = { name: 'east', lp: [XH, 0], ld: [0, 1], len: YH };

    /* 菲涅尔：用墙面「内法线」（指向室内）与完整 3D 光向量计算。
       西墙(x=-XH)内法线 +x，光 dx<0（上午）时受光；
       东墙(x=+XH)内法线 -x，光 dx>0（下午）时受光。
       cosθ=-d·n>0 表示光线朝向该墙；≤0 表示背向，该墙不受光。 */
    function fres(n) {
      var cosT = -dot3(d3, n);
      if (cosT <= 0) return null;
      cosT = Math.min(1, cosT);
      var R = fresnel(cosT, 0.04);
      return { cosT: cosT, theta: Math.acos(cosT) * 180 / Math.PI, R: R, T: 1 - R };
    }
    var frWest = fres([1, 0, 0]);
    var frEast = fres([-1, 0, 0]);

    for (var gi = 0; gi < louver.gaps.length; gi++) {
      var gap = louver.gaps[gi];
      var quad = stripQuad(gap.pl, gap.pr, d2, gap.sL, gap.sR);
      var base = { gap: gap.index, throughput: gap.throughput, pl: gap.pl, pr: gap.pr };

      /* 地面（直射） */
      litIntervals(quad, recFloor, null).forEach(function (it) {
        patches.push(Object.assign({}, base, {
          surface: 'floor', bounce: 0, weight: 1,
          p1: it.p1, p2: it.p2, row: -1
        }));
      });

      /* 东西幕墙（直射，按横档分带；只处理 3D 光向量真正朝向的墙面） */
      [['east', recEast, frEast], ['west', recWest, frWest]].forEach(function (wall) {
        var wallName = wall[0], rec = wall[1], fr = wall[2];
        if (!fr) return; /* 该墙不受光 */
        litIntervals(quad, rec, cfg.panelBands).forEach(function (it) {
          /* 直射到玻璃上的部分：透过率 T（镜面面板由渲染层改权重） */
          patches.push(Object.assign({}, base, {
            surface: wallName, bounce: 0, weight: fr.T,
            p1: it.p1, p2: it.p2, row: it.row,
            R: fr.R, T: fr.T, theta: fr.theta
          }));

          /* 一次反射光（忽略多次反弹）。垂直镜面只翻转法线分量(x)，
             切向分量(y,z)保持不变：d2r = (-dx, dy)，东西墙一致。
             向下的光反射后仍向下，落到地面或对面墙下部。 */
          var d2r = [-d2[0], d2[1]];
          var rq = stripQuad([it.p1.x, it.p1.y], [it.p2.x, it.p2.y], d2r, Infinity, Infinity);
          [recFloor, recWest, recEast].forEach(function (rrec) {
            if (rrec.name === wallName) return; /* 不会回打源墙面 */
            litIntervals(rq, rrec, rrec.name === 'floor' ? null : cfg.panelBands).forEach(function (rit) {
              patches.push(Object.assign({}, base, {
                surface: rrec.name, bounce: 1, weight: fr.R,
                p1: rit.p1, p2: rit.p2, row: rit.row,
                sourceWall: wallName, sourceRow: it.row,
                R: fr.R, T: fr.T, theta: fr.theta
              }));
            });
          });
        });
      });
    }

    return {
      patches: patches,
      gaps: louver.gaps,
      blades: louver.blades,
      d2: d2,
      d3: d3,
      fresnel: { east: frEast, west: frWest }
    };
  }

  /*
   * 把二维剖面光斑沿 z 方向挤出成三维薄六面体的 8 个角点（世界坐标）。
   * 光线带 dz 分量，接收面上 z 区间随沿光程 s 平移：z(s)=z0+s·dz/|d2|。
   * 地面 patch：薄盒在 y≈0；东/西墙 patch：薄盒在 x=±XH 内侧，带朝室内的厚度。
   * 返回 { verts:[8×[x,y,z]], normal:[nx,ny,nz], center }，顶点顺序固定便于建 12 三角形。
   */
  function extrudePatch(p, d3, d2, ZH, XH) {
    var zScale = (d3[2] / Math.hypot(d2[0], d2[1]));
    function zAt(vert) {
      var zc = vert.s * zScale;             /* 中心 z 随光程漂移 */
      /* 钳制在房间 z 边界内，避免光斑挤出山墙 */
      return [Math.max(-ZH, zc - ZH), Math.min(ZH, zc + ZH)];
    }
    var z1 = zAt(p.p1), z2 = zAt(p.p2);
    var v, normal;
    if (p.surface === 'floor') {
      var y = 0.03, t = 0.05; /* 微抬 + 薄厚度，防 z-fighting */
      normal = [0, 1, 0];
      /* x 钳制在地面边界内 */
      function cx(x) { return Math.max(-XH + 0.02, Math.min(XH - 0.02, x)); }
      v = [
        [cx(p.p1.x), y, z1[0]], [cx(p.p1.x), y, z1[1]],
        [cx(p.p2.x), y, z2[1]], [cx(p.p2.x), y, z2[0]],
        [cx(p.p1.x), y + t, z1[0]], [cx(p.p1.x), y + t, z1[1]],
        [cx(p.p2.x), y + t, z2[1]], [cx(p.p2.x), y + t, z2[0]]
      ];
    } else {
      /* 朝室内偏移并给 0.08 厚度；东墙内法线 -x，西墙内法线 +x */
      var inward = p.surface === 'east' ? -1 : 1;
      normal = [inward, 0, 0];
      var xFace = (p.surface === 'east' ? XH : -XH) + inward * 0.05;
      var xBack = xFace + inward * 0.08;
      v = [
        [xFace, p.p1.y, z1[0]], [xFace, p.p1.y, z1[1]],
        [xFace, p.p2.y, z2[1]], [xFace, p.p2.y, z2[0]],
        [xBack, p.p1.y, z1[0]], [xBack, p.p1.y, z1[1]],
        [xBack, p.p2.y, z2[1]], [xBack, p.p2.y, z2[0]]
      ];
    }
    var c = [0, 0, 0];
    v.forEach(function (q) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; });
    c = c.map(function (a) { return a / 8; });
    return { verts: v, normal: normal, center: c };
  }

  /* 三维镜面反射 d' = d - 2(d·n)n，墙面内法线沿 ±x */
  function reflect3(d, wallName) {
    var nx = wallName === 'east' ? -1 : 1; /* 内法线 */
    var dn = d[0] * nx;
    return [d[0] - 2 * dn * nx, d[1], d[2]];
  }

  var api = {
    fresnel: fresnel,
    bladeSegment: bladeSegment,
    buildLouver: buildLouver,
    raySeg2D: raySeg2D,
    clipHalfPlane: clipHalfPlane,
    litIntervals: litIntervals,
    stripQuad: stripQuad,
    compute: compute,
    extrudePatch: extrudePatch,
    reflect3: reflect3,
    dot3: dot3,
    norm3: norm3
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AtriumGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
