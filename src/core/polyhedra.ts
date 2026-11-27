import type { Vec3 } from './math3d';
import { cross, normalize, sub } from './math3d';

/** 多面体定义:顶点坐标 + 每个面的顶点索引(逆时针,朝外) */
export interface PolyhedronDef {
  id: string;
  name: string;
  vertices: Vec3[];
  faces: number[][];
}

export function faceNormal(poly: PolyhedronDef, faceIdx: number): Vec3 {
  const idx = poly.faces[faceIdx];
  const a = poly.vertices[idx[0]];
  const b = poly.vertices[idx[1]];
  const c = poly.vertices[idx[2]];
  return normalize(cross(sub(b, a), sub(c, a)));
}

export function faceCenter(poly: PolyhedronDef, faceIdx: number): Vec3 {
  const idx = poly.faces[faceIdx];
  const acc: Vec3 = [0, 0, 0];
  for (const i of idx) {
    acc[0] += poly.vertices[i][0];
    acc[1] += poly.vertices[i][1];
    acc[2] += poly.vertices[i][2];
  }
  return [acc[0] / idx.length, acc[1] / idx.length, acc[2] / idx.length];
}

/** 两个面共享的边顶点索引对(无序),无共享边返回 null */
export function sharedEdge(
  poly: PolyhedronDef,
  fi: number,
  fj: number,
): [number, number] | null {
  const a = poly.faces[fi];
  const b = new Set(poly.faces[fj]);
  const common = a.filter((i) => b.has(i));
  if (common.length !== 2) return null;
  return [common[0], common[1]];
}

/** 面邻接表:每个面的相邻面及共享边(以该面 CCW 顺序表示的 [from,to]) */
export interface Adjacency {
  neighbor: number;
  edge: [number, number];
}

export function buildAdjacency(poly: PolyhedronDef): Adjacency[][] {
  const result: Adjacency[][] = poly.faces.map(() => []);
  for (let i = 0; i < poly.faces.length; i++) {
    for (let j = i + 1; j < poly.faces.length; j++) {
      const se = sharedEdge(poly, i, j);
      if (!se) continue;
      result[i].push({ neighbor: j, edge: orientedEdge(poly, i, se) });
      result[j].push({ neighbor: i, edge: orientedEdge(poly, j, se) });
    }
  }
  return result;
}

/** 把无序边对按 fi 面的 CCW 顺序定向 */
function orientedEdge(
  poly: PolyhedronDef,
  fi: number,
  edge: [number, number],
): [number, number] {
  const loop = poly.faces[fi];
  for (let k = 0; k < loop.length; k++) {
    const a = loop[k];
    const b = loop[(k + 1) % loop.length];
    if (
      (a === edge[0] && b === edge[1]) ||
      (a === edge[1] && b === edge[0])
    ) {
      return [a, b];
    }
  }
  return edge;
}

// ---------- 生成器 ----------

/** 正 n 棱柱:上下两个 n 边形 + n 个矩形侧面 */
export function regularPrism(n: number, radius = 1, height = 2): PolyhedronDef {
  const vertices: Vec3[] = [];
  const hz = height / 2;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    vertices.push([radius * Math.cos(t), radius * Math.sin(t), -hz]); // 底 0..n-1
  }
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    vertices.push([radius * Math.cos(t), radius * Math.sin(t), hz]); // 顶 n..2n-1
  }
  const bottom = [...Array(n).keys()].reverse(); // 朝下:反向绕序
  const top = [...Array(n).keys()].map((k) => k + n);
  const faces: number[][] = [bottom, top];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    // 朝外的 CCW 矩形
    faces.push([k, k + n, k2 + n, k2]);
  }
  return {
    id: `prism-${n}`,
    name: `正${n}棱柱`,
    vertices,
    faces,
  };
}

/** 正 n 棱锥:n 边形底 + n 个三角形侧面 */
export function regularPyramid(n: number, radius = 1, height = 2): PolyhedronDef {
  const vertices: Vec3[] = [];
  const hz = height / 2;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    vertices.push([radius * Math.cos(t), radius * Math.sin(t), -hz]);
  }
  const apex = n;
  vertices.push([0, 0, hz]);
  const base = [...Array(n).keys()].reverse(); // 底面朝下
  const faces: number[][] = [base];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    faces.push([k, k2, apex]);
  }
  return {
    id: `pyramid-${n}`,
    name: `正${n}棱锥`,
    vertices,
    faces,
  };
}
