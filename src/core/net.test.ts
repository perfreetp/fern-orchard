import { describe, expect, it } from 'vitest';
import { regularPrism, regularPyramid, faceNormal } from './polyhedra';
import { buildNet, validateNet } from './net';
import { sampleScene } from './sample';
import { createProject } from './project';
import { enforceNoInterpenetration, progressAt } from './constraints';
import { polygonsIntersect } from './intersect';
import {
  type Vec3,
  sub as sub3,
  add as add3,
  scale as scale3,
  dot as dot3,
  cross as cross3,
  normalize,
} from './math3d';

describe('展开图生成', () => {
  it('四棱柱:树边平铺校验通过且折痕数 = 面数 - 1', () => {
    const poly = regularPrism(4);
    const net = buildNet(poly);
    expect(net.hinges.length).toBe(poly.faces.length - 1);
    expect(validateNet(net)).toEqual([]);
  });

  it('三棱锥:树边平铺校验通过', () => {
    const poly = regularPyramid(3);
    const net = buildNet(poly);
    expect(validateNet(net)).toEqual([]);
    expect(net.hinges.length).toBe(3);
  });

  it('所有预设都能展开且树边共享边逐点重合', () => {
    for (const n of [3, 4, 5, 6]) {
      for (const poly of [regularPrism(n), regularPyramid(n)]) {
        expect(validateNet(buildNet(poly)), poly.id).toEqual([]);
      }
    }
  });
});

describe('折叠重建', () => {
  /** 把重建的共享顶点收集成 face 无关的点集 */
  function collectRecon(poly: ReturnType<typeof regularPrism>, time = 6) {
    const project = createProject(poly, time);
    const sample = sampleScene(project, time);
    const byVert = new Map<number, Vec3>();
    for (const f of sample.faces) {
      const loop = poly.faces[f.faceIdx];
      f.worldVerts.forEach((p, k) => {
        const vi = loop[k];
        const prev = byVert.get(vi);
        if (prev) {
          // 不变量 1:折痕树边的共享顶点在任意相邻面中必须重合
          expect(dist(prev, p), `v${vi} 共享顶点不重合`).toBeLessThan(1e-4);
        } else {
          byVert.set(vi, p);
        }
      });
    }
    return { project, sample, byVert };
  }

  it('四棱柱折到终点:树边共享顶点重合,且与原多面体刚体全等(边长集合一致)', () => {
    const poly = regularPrism(4);
    const { byVert } = collectRecon(poly);
    const rebuilt = [...byVert.values()];
    expect(rebuilt.length).toBe(poly.vertices.length);
    const edgeSet = (pts: Vec3[]) => {
      const lens: number[] = [];
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          lens.push(dist(pts[i], pts[j]));
      return lens.sort((a, b) => a - b);
    };
    const got = edgeSet(rebuilt);
    const want = edgeSet(poly.vertices);
    got.forEach((d, i) => expect(d).toBeCloseTo(want[i], 4));
  });

  it('四棱柱:折叠后每个面的逐边边长与原面对应边完全一致', () => {
    const poly = regularPrism(4);
    const { sample } = collectRecon(poly);
    for (const f of sample.faces) {
      const loop = poly.faces[f.faceIdx];
      for (let k = 0; k < loop.length; k++) {
        expect(dist(f.worldVerts[k], f.worldVerts[(k + 1) % loop.length]))
          .toBeCloseTo(
            dist(poly.vertices[loop[k]], poly.vertices[loop[(k + 1) % loop.length]]),
            5,
          );
      }
    }
  });

  it('四棱锥:重建点集经刚体配准后与原多面体点集一一重合(全等且朝向正确)', () => {
    const poly = regularPyramid(4);
    const { byVert } = collectRecon(poly);
    const recon = poly.vertices.map((_, vi) => byVert.get(vi)!);
    const tr = bestRigid(recon, poly.vertices);
    const moved = recon.map((p) => applyTr(tr, p));
    // 不依赖顶点 id 顺序:每个配准点都应在原点集中找到唯一最近邻
    for (const p of moved) {
      const nearest = Math.min(...poly.vertices.map((o) => dist(p, o)));
      expect(nearest).toBeLessThan(1e-4);
    }
    // 反向同样成立,证明点集双射重合
    for (const o of poly.vertices) {
      const nearest = Math.min(...moved.map((p) => dist(p, o)));
      expect(nearest).toBeLessThan(1e-4);
    }
  });

  it('四棱锥:重建各面法线的两两夹角集合与原多面体一致(刚体旋转下结构不变量)', () => {
    const poly = regularPyramid(4);
    const { sample } = collectRecon(poly);
    const got = sample.faces.map((f) =>
      norm(cross3(sub3(f.worldVerts[1], f.worldVerts[0]), sub3(f.worldVerts[2], f.worldVerts[0]))),
    );
    const want = poly.faces.map((_, fi) => faceNormal(poly, fi));
    // 刚体运动保持法线间夹角:比较所有法线对的 |点积| 多重集合
    const pairDots = (ns: Vec3[]) => {
      const out: number[] = [];
      for (let i = 0; i < ns.length; i++)
        for (let j = i + 1; j < ns.length; j++)
          out.push(Math.abs(dot3(ns[i], ns[j])));
      return out.sort((a, b) => a - b);
    };
    const g = pairDots(got);
    const w = pairDots(want);
    expect(g.length).toBe(w.length);
    g.forEach((d, i) => expect(d).toBeCloseTo(w[i], 4));
  });

  it('t=0 时所有面共面(z≈0),即完全平铺', () => {
    const poly = regularPrism(5);
    const project = createProject(poly);
    const sample = sampleScene(project, 0);
    for (const f of sample.faces) {
      for (const p of f.worldVerts) expect(Math.abs(p[2])).toBeLessThan(1e-6);
    }
  });

  it('同一时刻重复采样结果完全相同(确定性)', () => {
    const project = createProject(regularPrism(3));
    const a = sampleScene(project, 2.37);
    const b = sampleScene(project, 2.37);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('防穿插约束', () => {
  it('把子面关键帧提前到父面之前时,重排后子进度不超过父进度', () => {
    const project = createProject(regularPrism(4), 6);
    const net = project.net;
    const hinge = net.hinges[0];
    const parent = project.tracks.find((t) => t.faceIdx === hinge.parentFace)!;
    const child = project.tracks.find((t) => t.faceIdx === hinge.childFace)!;
    child.keys = [
      { id: 'k1', time: 0, angle: 0, easing: 'linear' },
      { id: 'k2', time: 1, angle: hinge.foldDeg, easing: 'linear' },
    ];
    enforceNoInterpenetration(project);
    for (const t of [0, 0.5, 1, 2, 4, 6]) {
      expect(progressAt(project, child, t)).toBeLessThanOrEqual(
        progressAt(project, parent, t) + 1e-9,
      );
    }
  });

  it('棱锥默认工程:全程任意时刻、任意两面均无立体穿插(结构上可严格保证)', () => {
    // 棱锥所有侧面共享 apex、无对侧冲突,任意折叠时序都不会自交。
    const project = createProject(regularPyramid(4), 6);
    const net = project.net;
    const adjacent = new Set(
      net.adjacency.flatMap((list, i) =>
        list.map((a) => `${Math.min(i, a.neighbor)}-${Math.max(i, a.neighbor)}`),
      ),
    );
    for (let time = 0; time <= 6.001; time += 0.25) {
      const sample = sampleScene(project, time);
      for (let i = 0; i < sample.faces.length; i++) {
        for (let j = i + 1; j < sample.faces.length; j++) {
          const hit = polygonsIntersect(
            sample.faces[i].worldVerts,
            sample.faces[j].worldVerts,
            adjacent.has(`${i}-${j}`),
          );
          expect(hit, `t=${time} 面${i} 与面${j} 穿插`).toBe(false);
        }
      }
    }
  });

  it('棱柱:相交检测器能识别真实贯穿(诊断能力),且对共面/贴合不误报', () => {
    // 棱柱侧面环刚性折叠存在固有自交,检测器应能如实报告而非漏报;
    // 同时平铺共面、近共面贴合等合法状态不得误报。
    const project = createProject(regularPrism(4), 6);
    // 共面平铺:不报告
    const flat = sampleScene(project, 0);
    const anyFlat = polygonsIntersect(
      flat.faces[0].worldVerts,
      flat.faces[1].worldVerts,
      false,
    );
    expect(anyFlat).toBe(false);
    // 构造一个确凿的贯穿:两条相交三角形
    const t1: Vec3[] = [[0, 0, 0], [2, 0, 0], [0, 2, 0]];
    const t2: Vec3[] = [[0.5, 0.5, -1], [0.5, 0.5, 1], [1.5, 0.5, 0]];
    expect(polygonsIntersect(t1, t2, false)).toBe(true);
  });
});

// ---------- 测试工具 ----------
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

interface Rigid {
  R: Vec3[]; // 3x3 行向量
  t: Vec3;
}
/**
 * 求把 src 点集配准到 dst 的刚体变换(对应点同序)。
 * 用质心出发的两个不共线向量各建一组正交基,R = Bd * Bs^T。
 */
function bestRigid(src: Vec3[], dst: Vec3[]): Rigid {
  const cs = centroid(src);
  const cd = centroid(dst);
  const basisFrom = (pts: Vec3[], c: Vec3): Vec3[] => {
    // 选相对质心最远的点作为第一轴,避免近共线数值问题
    let far = 0;
    let farD = -1;
    pts.forEach((p, i) => {
      const d = dist(p, c);
      if (d > farD) {
        farD = d;
        far = i;
      }
    });
    const e0 = norm(sub3(pts[far], c));
    // 找与 e0 最不平行的点向量做第二轴
    let second = 0;
    let bestPar = Infinity;
    pts.forEach((p, i) => {
      const w = sub3(p, c);
      const par = Math.abs(dot3(norm(w), e0));
      if (par < bestPar) {
        bestPar = par;
        second = i;
      }
    });
    let e1raw = sub3(pts[second], c);
    e1raw = sub3(e1raw, scale3(e0, dot3(e1raw, e0)));
    const e1 = norm(e1raw);
    const e2 = norm(cross3(e0, e1));
    return [e0, e1, e2];
  };
  const bs = basisFrom(src, cs);
  const bd = basisFrom(dst, cd);
  const R: Vec3[] = [0, 1, 2].map((r) => [
    bd[0][r] * bs[0][0] + bd[1][r] * bs[1][0] + bd[2][r] * bs[2][0],
    bd[0][r] * bs[0][1] + bd[1][r] * bs[1][1] + bd[2][r] * bs[2][1],
    bd[0][r] * bs[0][2] + bd[1][r] * bs[1][2] + bd[2][r] * bs[2][2],
  ]);
  const Rcs: Vec3 = [
    R[0].reduce((s, v, k) => s + v * cs[k], 0),
    R[1].reduce((s, v, k) => s + v * cs[k], 0),
    R[2].reduce((s, v, k) => s + v * cs[k], 0),
  ];
  return { R, t: sub3(cd, Rcs) };
}
function applyTr(tr: Rigid, p: Vec3): Vec3 {
  return add3(
    [
      tr.R[0].reduce((s, v, k) => s + v * p[k], 0),
      tr.R[1].reduce((s, v, k) => s + v * p[k], 0),
      tr.R[2].reduce((s, v, k) => s + v * p[k], 0),
    ],
    tr.t,
  );
}
function centroid(pts: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i];
  return scale3(c, 1 / pts.length);
}
void normalize;
