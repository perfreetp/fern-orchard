import type { EasingName } from './sample';
import type { Net } from './net';
import { buildNet } from './net';
import {
  type PolyhedronDef,
  regularPrism,
  regularPyramid,
} from './polyhedra';

export interface Keyframe {
  id: string;
  time: number;
  angle: number; // 折叠角(度),0 = 平铺
  easing: EasingName; // 到下一帧之间使用的缓动
}

export interface Track {
  id: string;
  faceIdx: number;
  name: string;
  color: string;
  keys: Keyframe[];
  groupId: string | null;
  /** 组内相对偏移(秒),编组拖动时保持 */
  groupOffset: number;
}

export interface TrackGroup {
  id: string;
  name: string;
  color: string;
}

export interface TimelineMarker {
  id: string;
  time: number;
  kind: 'pause' | 'note';
  text: string;
}

export interface Project {
  version: 1;
  polyhedronId: string;
  duration: number;
  net: Net;
  tracks: Track[];
  groups: TrackGroup[];
  markers: TimelineMarker[];
  selectedFace: number | null;
}

let idCounter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const FACE_COLORS = [
  '#e8734a',
  '#4a90e2',
  '#50b86c',
  '#d6a13b',
  '#9b59b6',
  '#3aa6b9',
  '#e05f8a',
  '#7f8c8d',
];

/**
 * 为一个多面体生成默认工程。
 * 非根面按生成树 BFS 序分配串行时间槽,一个面折完再折下一个:
 * 既保证子面进度不超过父面(树层级),也避免同深度对侧面同步抬起时的扫掠穿插。
 */
export function createProject(poly: PolyhedronDef, duration = 6): Project {
  const net = buildNet(poly);

  // BFS 序遍历所有非根面
  const order: number[] = [];
  const queue = [net.rootFace];
  const seen = new Set<number>([net.rootFace]);
  while (queue.length) {
    const fi = queue.shift()!;
    for (const c of net.childrenOf.get(fi) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      order.push(c);
      queue.push(c);
    }
  }
  const slotIndex = new Map(order.map((fi, i) => [fi, i]));
  const slotCount = Math.max(order.length, 1);

  const tracks: Track[] = net.poly.faces.map((_, fi) => {
    const hinge = net.hingeByChild.get(fi);
    const target = hinge ? hinge.foldDeg : 0;
    const color = FACE_COLORS[fi % FACE_COLORS.length];
    if (!hinge) {
      return {
        id: uid('track'),
        faceIdx: fi,
        name: `面 ${fi + 1}(根)`,
        color,
        groupId: null,
        groupOffset: 0,
        keys: [{ id: uid('kf'), time: 0, angle: 0, easing: 'linear' }],
      };
    }
    const idx = slotIndex.get(fi)!;
    const begin = (duration * idx) / slotCount;
    const finish = (duration * (idx + 1)) / slotCount;
    return {
      id: uid('track'),
      faceIdx: fi,
      name: `面 ${fi + 1}`,
      color,
      groupId: null,
      groupOffset: 0,
      keys: [
        { id: uid('kf'), time: 0, angle: 0, easing: 'linear' },
        { id: uid('kf'), time: begin, angle: 0, easing: 'linear' },
        { id: uid('kf'), time: finish, angle: target, easing: 'easeInOutQuad' },
      ],
    };
  });
  return {
    version: 1,
    polyhedronId: poly.id,
    duration,
    net,
    tracks,
    groups: [],
    markers: [],
    selectedFace: null,
  };
}

export interface PresetDef {
  id: string;
  name: string;
  build: () => PolyhedronDef;
}

export const PRESETS: PresetDef[] = [
  { id: 'prism-3', name: '三棱柱', build: () => regularPrism(3) },
  { id: 'prism-4', name: '四棱柱(长方体)', build: () => regularPrism(4) },
  { id: 'prism-5', name: '五棱柱', build: () => regularPrism(5) },
  { id: 'prism-6', name: '六棱柱', build: () => regularPrism(6) },
  { id: 'pyramid-3', name: '三棱锥(四面体)', build: () => regularPyramid(3) },
  { id: 'pyramid-4', name: '四棱锥', build: () => regularPyramid(4) },
  { id: 'pyramid-5', name: '五棱锥', build: () => regularPyramid(5) },
  { id: 'pyramid-6', name: '六棱锥', build: () => regularPyramid(6) },
];

export function buildPreset(id: string): PolyhedronDef {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`未知预设: ${id}`);
  return preset.build();
}
