import { sub, cross, dot, normalize, type Vec3 } from './math3d';

/** 扇形三角剖分(面均为凸多边形) */
export function triangulate(poly: Vec3[]): [Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3][] = [];
  for (let i = 1; i < poly.length - 1; i++) {
    out.push([poly[0], poly[i], poly[i + 1]]);
  }
  return out;
}

function polyNormal(p: Vec3[]): Vec3 {
  return normalize(cross(sub(p[1], p[0]), sub(p[2], p[0])));
}

function edgesOf(p: Vec3[]): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i < p.length; i++) out.push([p[i], p[(i + 1) % p.length]]);
  return out;
}

/**
 * 两个凸多边形面是否在立体空间中真正互相穿插。
 * - 近共面(法线夹角 <约5°):共面平摊叠放是展开平铺的合法状态,判否;
 * - 否则用边-三角形严格贯穿(线段两端严格分居平面两侧且交点落在内部),
 *   铰链点/共面接触点豁免,排除扫掠投影假阳性。
 * 共边相邻面直接豁免。
 */
export function polygonsIntersect(
  a: Vec3[],
  b: Vec3[],
  shareEdge: boolean,
): boolean {
  if (shareEdge) return false;
  const na = polyNormal(a);
  const nb = polyNormal(b);
  const normalDot = Math.abs(dot(na, nb));

  // 近共面:共面的两个面只可能平摊叠放(展开平铺的合法状态),
  // 不构成立体穿插,直接判否;平行且有间距更不可能相交。
  if (normalDot > 0.996) {
    return false;
  }

  // 一般情形:任一面的边严格贯穿另一面的三角形
  const ta = triangulate(a);
  const tb = triangulate(b);
  for (const [p, q] of edgesOf(a)) {
    for (const tri of tb) {
      if (segmentPiercesTriangle(p, q, tri)) return true;
    }
  }
  for (const [p, q] of edgesOf(b)) {
    for (const tri of ta) {
      if (segmentPiercesTriangle(p, q, tri)) return true;
    }
  }
  return false;
}

/** 线段严格贯穿三角形:两端严格分居平面两侧(铰链点/共面接触点豁免),且交点在内部 */
function segmentPiercesTriangle(
  p0: Vec3,
  p1: Vec3,
  tri: [Vec3, Vec3, Vec3],
): boolean {
  const [a, b, c] = tri;
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const normal = cross(e1, e2);
  const d0 = dot(normal, sub(p0, a));
  const d1 = dot(normal, sub(p1, a));
  // 必须严格异侧:任一端点落在平面上(铰链/共面接触)都不算穿透
  const eps = 1e-7;
  if (d0 > -eps && d1 > -eps) return false;
  if (d0 < eps && d1 < eps) return false;
  // 求交点并做内部判定
  const denom = d0 - d1;
  if (Math.abs(denom) < 1e-12) return false;
  const t = d0 / denom; // 交点参数
  if (t <= 1e-6 || t >= 1 - 1e-6) return false;
  const hit: Vec3 = [
    p0[0] + (p1[0] - p0[0]) * t,
    p0[1] + (p1[1] - p0[1]) * t,
    p0[2] + (p1[2] - p0[2]) * t,
  ];
  return pointInTriangle(hit, a, b, c);
}

/** 点在三角形内(叉积同侧判定) */
function pointInTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const n = cross(sub(b, a), sub(c, a));
  const s1 = dot(n, cross(sub(b, a), sub(p, a)));
  const s2 = dot(n, cross(sub(c, b), sub(p, b)));
  const s3 = dot(n, cross(sub(a, c), sub(p, c)));
  return s1 >= -1e-7 && s2 >= -1e-7 && s3 >= -1e-7;
}
