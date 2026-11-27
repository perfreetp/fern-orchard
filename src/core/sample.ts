import {
  type Mat3,
  type Transform,
  type Vec3,
  applyMat3,
  applyTransform,
  composeTransform,
  identityTransform,
  sub,
} from './math3d';
import type { Net } from './net';
import type { Project, Track } from './project';

export interface SampledFace {
  faceIdx: number;
  /** 当前折叠角(度,相对平铺) */
  angleDeg: number;
  /** 该面 pivot 中心到世界的刚体变换 */
  world: Transform;
  /** 世界空间下的面顶点(相交检测与拾取用) */
  worldVerts: Vec3[];
}

export interface SceneSample {
  time: number;
  faces: SampledFace[];
  /** 每条轨道当前角度,faceIdx -> angle */
  angles: Map<number, number>;
}

/** 轨道在给定时间的折叠角(度),关键帧外取端点常量 */
export function sampleTrackAngle(track: Track, time: number): number {
  const kfs = [...track.keys].sort((a, b) => a.time - b.time);
  if (kfs.length === 0) return 0;
  if (time <= kfs[0].time) return kfs[0].angle;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].angle;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      const u = (time - a.time) / Math.max(1e-9, b.time - a.time);
      const e = b.easing ?? 'linear';
      return a.angle + (b.angle - a.angle) * easingFn(e)(u);
    }
  }
  return kfs[kfs.length - 1].angle;
}

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'hold';

export function easingFn(name: EasingName): (u: number) => number {
  switch (name) {
    case 'linear':
      return (u) => u;
    case 'easeInQuad':
      return (u) => u * u;
    case 'easeOutQuad':
      return (u) => 1 - (1 - u) * (1 - u);
    case 'easeInOutQuad':
      return (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    case 'easeInCubic':
      return (u) => u * u * u;
    case 'easeOutCubic':
      return (u) => 1 - Math.pow(1 - u, 3);
    case 'easeInOutCubic':
      return (u) =>
        u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    case 'hold':
      return (u) => (u >= 1 ? 1 : 0);
    default:
      return (u) => u;
  }
}

export const EASING_NAMES: EasingName[] = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'hold',
];

export const EASING_LABELS: Record<EasingName, string> = {
  linear: '线性',
  easeInQuad: '二次缓入',
  easeOutQuad: '二次缓出',
  easeInOutQuad: '二次缓入缓出',
  easeInCubic: '三次缓入',
  easeOutCubic: '三次缓出',
  easeInOutCubic: '三次缓入缓出',
  hold: '阶跃保持',
};

/** 绕经过 pivot 的 axis 轴旋转 angle(父面 2D 系),铰链点保持不动 */
function rotAbout(pivot: Vec3, axis: Vec3, angle: number): Transform {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const C = 1 - c;
  const R: Mat3 = [
    c + x * x * C, x * y * C + z * s, x * z * C - y * s,
    y * x * C - z * s, c + y * y * C, y * z * C + x * s,
    z * x * C + y * s, z * y * C - x * s, c + z * z * C,
  ];
  return { R, t: sub(pivot, applyMat3(R, pivot)) };
}

/**
 * 唯一样像入口:播放、拖动播放头、预览全部走这里,保证逐帧一致。
 *
 * 每个子面相对父面的局部变换:
 *   local(s) = rotAbout(pivot, axis, foldRad * s) ∘ rest
 * 其中 rest 把子面平铺几何放到父面共享边,s=0 平铺、s=1 立体。
 * s 由当前折叠角 / 目标折叠角得到,因此中间帧是单轴定轴旋转的线性插值。
 */
export function sampleScene(project: Project, time: number): SceneSample {
  const net = project.net;
  const angles = new Map<number, number>();
  for (const t of project.tracks) {
    angles.set(t.faceIdx, sampleTrackAngle(t, time));
  }

  const sampled = new Map<number, SampledFace>();

  const walk = (fi: number, parentWorld: Transform) => {
    const node = net.faces[fi];
    const angle = angles.get(fi) ?? 0;
    let local: Transform;
    if (node.parent === null) {
      local = identityTransform();
    } else {
      const hinge = net.hingeByChild.get(fi)!;
      const target = hinge.foldDeg;
      const s = Math.abs(target) < 1e-9 ? 0 : angle / target;
      const rot = rotAbout(hinge.pivot, hinge.axis, hinge.foldRad * s);
      local = composeTransform(rot, hinge.rest);
    }
    const world = composeTransform(parentWorld, local);
    const worldVerts = net.poly.faces[fi].map((vi) =>
      applyTransform(world, node.net2D.get(vi)!),
    );
    sampled.set(fi, { faceIdx: fi, angleDeg: angle, world, worldVerts });
    for (const child of net.childrenOf.get(fi) ?? []) {
      walk(child, world);
    }
  };

  walk(net.rootFace, identityTransform());

  return {
    time,
    faces: net.poly.faces.map((_, fi) => sampled.get(fi)!),
    angles,
  };
}

/** 折叠完成度(0..1) */
export function foldProgress(project: Project, time: number): number {
  const sample = sampleScene(project, time);
  let total = 0;
  let weighted = 0;
  for (const hinge of project.net.hinges) {
    const target = Math.abs(hinge.foldDeg);
    if (target < 1e-6) continue;
    const cur = Math.abs(sample.angles.get(hinge.childFace) ?? 0);
    weighted += Math.min(1, cur / target) * target;
    total += target;
  }
  return total === 0 ? 0 : weighted / total;
}
