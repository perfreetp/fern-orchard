// 最小 3D 数学库:向量 / 旋转矩阵 / 刚体变换。核心层不依赖 three.js,可在 node 中单测。

export type Vec3 = [number, number, number];
export type Mat3 = number[]; // 长度 9,列优先

export const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

export const EPS = 1e-7;

export const approxEqual = (a: Vec3, b: Vec3, eps = 1e-5): boolean =>
  length(sub(a, b)) < eps;

/** 罗德里格斯公式:绕过原点的轴旋转 */
export function rotMatrix(axis: Vec3, angleRad: number): Mat3 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const C = 1 - c;
  // 列优先
  return [
    c + x * x * C, x * y * C + z * s, x * z * C - y * s,
    y * x * C - z * s, c + y * y * C, y * z * C + x * s,
    z * x * C + y * s, z * y * C - x * s, c + z * z * C,
  ];
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      r[col * 3 + row] =
        a[0 * 3 + row] * b[col * 3 + 0] +
        a[1 * 3 + row] * b[col * 3 + 1] +
        a[2 * 3 + row] * b[col * 3 + 2];
    }
  }
  return r;
}

export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** 旋转矩阵(列优先)反解轴角;零旋转返回 +z 轴、0 角 */
export function matrixToAxisAngle(R: Mat3): { axis: Vec3; angle: number } {
  const trace = R[0] + R[4] + R[8];
  const cosA = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const angle = Math.acos(cosA);
  if (angle < 1e-9) return { axis: [0, 0, 1], angle: 0 };
  const s = Math.sin(angle);
  const axis: Vec3 = [
    (R[7] - R[5]) / (2 * s),
    (R[2] - R[6]) / (2 * s),
    (R[3] - R[1]) / (2 * s),
  ];
  return { axis: normalize(axis), angle };
}

export function applyMat3(m: Mat3, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
    m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
    m[2] * p[0] + m[5] * p[1] + m[8] * p[2],
  ];
}

/** 刚体变换:world = R * local + t */
export interface Transform {
  R: Mat3;
  t: Vec3;
}

export const identityTransform = (): Transform => ({
  R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  t: [0, 0, 0],
});

export function applyTransform(tr: Transform, p: Vec3): Vec3 {
  return add(applyMat3(tr.R, p), tr.t);
}

export function composeTransform(parent: Transform, local: Transform): Transform {
  return {
    R: mulMat3(parent.R, local.R),
    t: add(applyMat3(parent.R, local.t), parent.t),
  };
}

/** 刚体变换的逆 */
export function invertRigid(tr: Transform): Transform {
  const Rt = transposeMat3(tr.R);
  return { R: Rt, t: scale(applyMat3(Rt, tr.t), -1) };
}

/** 绕经过 p0、方向为 axis 的轴旋转 angle 的局部刚体变换(等价 translate(p0) R translate(-p0)) */
export function hingeTransform(p0: Vec3, axis: Vec3, angleRad: number): Transform {
  const R = rotMatrix(axis, angleRad);
  return { R, t: sub(p0, applyMat3(R, p0)) };
}

/** 从 a 方向到 b 方向绕给定轴的有符号角(弧度),轴应同时垂直于 a、b 的偏差分量 */
export function signedAngleAround(a: Vec3, b: Vec3, axis: Vec3): number {
  const n = normalize(axis);
  return Math.atan2(dot(cross(a, b), n), dot(a, b));
}

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
