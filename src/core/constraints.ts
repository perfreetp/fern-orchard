import type { Keyframe, Project, Track } from './project';
import { uid } from './project';
import type { Net } from './net';
import { clamp } from './math3d';

/** 角度 -> 相对目标折叠角的进度 0..1(带符号归一) */
export function angleToProgress(track: Track, net: Net): (angle: number) => number {
  const hinge = net.hingeByChild.get(track.faceIdx);
  const target = hinge ? hinge.foldDeg : 0;
  if (Math.abs(target) < 1e-9) return () => 1;
  return (angle: number) => clamp(angle / target, 0, 1);
}

export function targetAngle(project: Project, faceIdx: number): number {
  return project.net.hingeByChild.get(faceIdx)?.foldDeg ?? 0;
}

/** 求轨道在 time 处的进度(0..1),端点外取常量 */
export function progressAt(project: Project, track: Track, time: number): number {
  const toP = angleToProgress(track, project.net);
  const kfs = [...track.keys].sort((a, b) => a.time - b.time);
  if (time <= kfs[0].time) return toP(kfs[0].angle);
  if (time >= kfs[kfs.length - 1].time)
    return toP(kfs[kfs.length - 1].angle);
  for (let i = 0; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) {
      const a = kfs[i];
      const b = kfs[i + 1];
      const u = (time - a.time) / Math.max(1e-9, b.time - a.time);
      const pa = toP(a.angle);
      const pb = toP(b.angle);
      return pa + (pb - pa) * u; // 进度空间线性足够做层级比较
    }
  }
  return toP(kfs[kfs.length - 1].angle);
}

/**
 * 防穿插核心:凸多面体的平铺网沿生成树折叠时,
 * 只要任意时刻子面的折叠进度不超过父面,子树就不会与祖先面穿插。
 * 本函数在任一轨道被编辑后,自上而下重排所有后代关键帧的时间。
 */
export function enforceNoInterpenetration(project: Project): void {
  const net = project.net;
  const trackMap = new Map(project.tracks.map((t) => [t.faceIdx, t]));

  const fixChild = (parentFace: number) => {
    for (const childFace of net.childrenOf.get(parentFace) ?? []) {
      const parent = trackMap.get(parentFace)!;
      const child = trackMap.get(childFace);
      if (child) fixTrackTimes(project, parent, child);
      fixChild(childFace);
    }
  };
  fixChild(net.rootFace);
}

/** 调整 child 的关键帧时间,使其进度处处 <= parent 的进度 */
function fixTrackTimes(project: Project, parent: Track, child: Track): void {
  const duration = project.duration;
  const sorted = [...child.keys].sort((a, b) => a.time - b.time);
  for (const kf of sorted) {
    const want = angleToProgress(child, project.net)(kf.angle);
    // 父轨道达到该进度的最早时间;子关键帧不得早于它
    const earliest = earliestTimeForProgress(project, parent, want);
    if (kf.time < earliest - 1e-6) {
      kf.time = clamp(earliest, 0, duration);
    }
  }
  // 重排后保持时间单调;冲突时依次向后推
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time < sorted[i - 1].time) {
      sorted[i].time = sorted[i - 1].time;
    }
  }
  child.keys = sorted;
}

/** 父轨道进度首次达到 want 的时间(分段线性反解) */
function earliestTimeForProgress(
  project: Project,
  track: Track,
  want: number,
): number {
  const toP = angleToProgress(track, project.net);
  const kfs = [...track.keys].sort((a, b) => a.time - b.time);
  if (want <= toP(kfs[0].angle)) return kfs[0].time;
  for (let i = 0; i < kfs.length - 1; i++) {
    const pa = toP(kfs[i].angle);
    const pb = toP(kfs[i + 1].angle);
    if (want >= Math.min(pa, pb) && want <= Math.max(pa, pb)) {
      const denom = pb - pa;
      const u = Math.abs(denom) < 1e-9 ? 0 : (want - pa) / denom;
      return kfs[i].time + u * (kfs[i + 1].time - kfs[i].time);
    }
  }
  return kfs[kfs.length - 1].time;
}

/** 直接设置某轨道在 time 处的角度(画面拖拽折痕用):移动最近关键帧或插入新帧 */
export function setAngleAtTime(
  project: Project,
  track: Track,
  time: number,
  angle: number,
): Keyframe {
  const target = targetAngle(project, track.faceIdx);
  const clamped = clamp(angle, Math.min(0, target), Math.max(0, target));
  const sorted = [...track.keys].sort((a, b) => a.time - b.time);
  const snap = 0.12;
  const near = sorted.find((k) => Math.abs(k.time - time) <= snap);
  if (near) {
    near.angle = clamped;
    return near;
  }
  const kf: Keyframe = {
    id: uid('kf'),
    time: clamp(time, 0, project.duration),
    angle: clamped,
    easing: 'linear',
  };
  track.keys = [...sorted, kf].sort((a, b) => a.time - b.time);
  return kf;
}

/** 整组轨道按 delta 平移,组内相对时间保持不变;平移后再做防穿插修正 */
export function shiftGroup(
  project: Project,
  groupId: string,
  delta: number,
): void {
  const members = project.tracks.filter((t) => t.groupId === groupId);
  for (const t of members) {
    for (const k of t.keys) {
      k.time = clamp(k.time + delta, 0, project.duration);
    }
  }
  enforceNoInterpenetration(project);
}

/** 单条轨道整体平移(不改变关键帧间距) */
export function shiftTrack(project: Project, track: Track, delta: number): void {
  for (const k of track.keys) {
    k.time = clamp(k.time + delta, 0, project.duration);
  }
  enforceNoInterpenetration(project);
}
