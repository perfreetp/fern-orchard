import { createStore } from 'solid-js';
import type { Project, Track, TrackGroup, TimelineMarker, Keyframe } from '../core/project';
import { uid } from '../core/project';
import { createProject, buildPreset, PRESETS } from '../core/project';
import {
  enforceNoInterpenetration,
  setAngleAtTime,
  shiftGroup as shiftGroupCore,
  shiftTrack as shiftTrackCore,
} from '../core/constraints';
import { sampleScene, type SceneSample } from '../core/sample';
import {
  saveToLocalStorage,
  loadFromLocalStorage,
  serializeProject,
  deserializeProject,
  downloadProject,
} from '../core/serialize';
import { clamp } from '../core/math3d';

interface PlayState {
  time: number;
  playing: boolean;
  pausedOnMarker: string | null;
  notice: string | null;
  selectedFace: number | null;
  intersections: string[];
}

export interface StudioState {
  project: Project;
  play: PlayState;
}

function initial(): StudioState {
  const restored = loadFromLocalStorage();
  const project = restored ?? createProject(buildPreset(PRESETS[0].id));
  return {
    project,
    play: {
      time: 0,
      playing: false,
      pausedOnMarker: null,
      notice: null,
      selectedFace: project.selectedFace,
      intersections: [],
    },
  };
}

export const [state, setState] = createStore<StudioState>(initial());

/** 结构化更新 project:拿到可变草稿,原地修改后由 store 发布 */
function mutateProject(fn: (draft: Project) => void): void {
  setState((root) => {
    fn(root.project);
  });
}

function mutatePlay(fn: (draft: PlayState) => void): void {
  setState((root) => {
    fn(root.play);
  });
}

export function currentSample(): SceneSample {
  return sampleScene(state.project, state.play.time);
}

export function sampleAt(time: number): SceneSample {
  return sampleScene(state.project, time);
}

// ---------- 工程 ----------

export function switchPolyhedron(presetId: string): void {
  const project = createProject(buildPreset(presetId), state.project.duration);
  setState((root) => {
    root.project = project;
    root.play.time = 0;
    root.play.playing = false;
    root.play.notice = null;
    root.play.selectedFace = null;
  });
  persist();
}

export function newProject(presetId: string): void {
  const project = createProject(buildPreset(presetId));
  setState((root) => {
    root.project = project;
    root.play.time = 0;
    root.play.playing = false;
    root.play.notice = null;
    root.play.selectedFace = null;
  });
  persist();
}

export function exportProjectFile(): void {
  downloadProject(state.project);
}

export function importProjectText(text: string): void {
  const project = deserializeProject(text);
  setState((root) => {
    root.project = project;
    root.play.time = 0;
    root.play.playing = false;
  });
  persist();
}

export function persist(): void {
  saveToLocalStorage(state.project);
}

export function projectJSON(): string {
  return serializeProject(state.project);
}

// ---------- 播放头 ----------

export function seek(time: number): void {
  const t = clamp(time, 0, state.project.duration);
  mutatePlay((p) => {
    p.time = t;
  });
}

export function setPlaying(playing: boolean): void {
  mutatePlay((p) => {
    p.playing = playing;
    if (playing) p.pausedOnMarker = null;
  });
}

export function setNotice(text: string | null): void {
  mutatePlay((p) => {
    p.notice = text;
  });
}

export function setIntersections(pairs: string[]): void {
  mutatePlay((p) => {
    p.intersections = pairs;
  });
}

export function advance(dt: number): boolean {
  if (!state.play.playing) return false;
  let next = state.play.time + dt;
  const duration = state.project.duration;
  const pause = state.project.markers
    .filter(
      (m) =>
        m.kind === 'pause' &&
        m.time > state.play.time + 1e-9 &&
        m.time <= next,
    )
    .sort((a, b) => a.time - b.time)[0];
  if (pause) {
    mutatePlay((p) => {
      p.time = pause.time;
      p.playing = false;
      p.pausedOnMarker = pause.id;
      p.notice = pause.text || `已在 ${pause.time.toFixed(2)}s 暂停`;
    });
    return false;
  }
  if (next >= duration) {
    mutatePlay((p) => {
      p.time = duration;
      p.playing = false;
    });
    return false;
  }
  mutatePlay((p) => {
    p.time = next;
  });
  return true;
}

// ---------- 选择 ----------

export function selectFace(faceIdx: number | null): void {
  mutatePlay((p) => {
    p.selectedFace = faceIdx;
  });
  mutateProject((pr) => {
    pr.selectedFace = faceIdx;
  });
  persist();
}

// ---------- 轨道 / 关键帧 ----------

export function trackOf(faceIdx: number): Track | undefined {
  return state.project.tracks.find((t) => t.faceIdx === faceIdx);
}

export function dragFaceAngle(faceIdx: number, angle: number): void {
  const track = trackOf(faceIdx);
  if (!track) return;
  const time = state.play.time;
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.faceIdx === faceIdx)!;
    setAngleAtTime(p, tr, time, angle);
    enforceNoInterpenetration(p);
  });
  persist();
}

export function moveKeyframe(trackId: string, keyId: string, time: number): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId)!;
    const kf = tr.keys.find((k) => k.id === keyId);
    if (!kf) return;
    kf.time = clamp(time, 0, p.duration);
    tr.keys = [...tr.keys].sort((a, b) => a.time - b.time);
    enforceNoInterpenetration(p);
  });
  persist();
}

export function setKeyframeAngle(trackId: string, keyId: string, angle: number): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId)!;
    const kf = tr.keys.find((k) => k.id === keyId);
    if (!kf) return;
    kf.angle = angle;
    enforceNoInterpenetration(p);
  });
  persist();
}

export function setKeyframeEasing(
  trackId: string,
  keyId: string,
  easing: Keyframe['easing'],
): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId)!;
    const kf = tr.keys.find((k) => k.id === keyId);
    if (!kf) return;
    kf.easing = easing;
    enforceNoInterpenetration(p);
  });
  persist();
}

export function insertKeyframe(faceIdx: number, time: number): Keyframe | null {
  let created: Keyframe | null = null;
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.faceIdx === faceIdx);
    if (!tr) return;
    const angle = sampleScene(p, time).angles.get(faceIdx) ?? 0;
    created = setAngleAtTime(p, tr, time, angle);
    enforceNoInterpenetration(p);
  });
  persist();
  return created;
}

export function deleteKeyframe(trackId: string, keyId: string): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId)!;
    if (tr.keys.length <= 1) return;
    tr.keys = tr.keys.filter((k) => k.id !== keyId);
  });
  persist();
}

export function dragTrack(trackId: string, delta: number): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId)!;
    shiftTrackCore(p, tr, delta);
  });
  persist();
}

// ---------- 编组 ----------

export function createGroup(name: string, color: string): string {
  const id = uid('group');
  mutateProject((p) => {
    p.groups.push({ id, name, color });
  });
  persist();
  return id;
}

export function addToGroup(trackIds: string[], groupId: string): void {
  mutateProject((p) => {
    trackIds.forEach((tid) => {
      const tr = p.tracks.find((t) => t.id === tid);
      if (tr) tr.groupId = groupId;
    });
  });
  persist();
}

export function removeFromGroup(trackId: string): void {
  mutateProject((p) => {
    const tr = p.tracks.find((t) => t.id === trackId);
    if (tr) tr.groupId = null;
  });
  persist();
}

export function dragGroup(groupId: string, delta: number): void {
  mutateProject((p) => {
    shiftGroupCore(p, groupId, delta);
  });
  persist();
}

export function deleteGroup(groupId: string): void {
  mutateProject((p) => {
    p.tracks.forEach((t) => {
      if (t.groupId === groupId) t.groupId = null;
    });
    p.groups = p.groups.filter((g) => g.id !== groupId);
  });
  persist();
}

// ---------- 暂停点 / 提示 ----------

export function addMarker(kind: TimelineMarker['kind'], time: number, text: string): void {
  mutateProject((p) => {
    p.markers.push({ id: uid('marker'), kind, time, text });
    p.markers.sort((a, b) => a.time - b.time);
  });
  persist();
}

export function updateMarker(id: string, patch: Partial<TimelineMarker>): void {
  mutateProject((p) => {
    const m = p.markers.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    p.markers.sort((a, b) => a.time - b.time);
  });
  persist();
}

export function deleteMarker(id: string): void {
  mutateProject((p) => {
    p.markers = p.markers.filter((m) => m.id !== id);
  });
  persist();
}

export function clearNotice(): void {
  mutatePlay((p) => {
    p.notice = null;
    p.pausedOnMarker = null;
  });
}

export function setDuration(d: number): void {
  mutateProject((p) => {
    p.duration = clamp(d, 1, 60);
    p.tracks.forEach((t) =>
      t.keys.forEach((k) => {
        k.time = clamp(k.time, 0, p.duration);
      }),
    );
  });
  seek(Math.min(state.play.time, state.project.duration));
  persist();
}

export type { Track, TrackGroup };
