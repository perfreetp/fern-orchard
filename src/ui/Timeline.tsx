import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  state,
  seek,
  setPlaying,
  moveKeyframe,
  setKeyframeAngle,
  setKeyframeEasing,
  deleteKeyframe,
  insertKeyframe,
  dragTrack,
  dragGroup,
  addMarker,
  updateMarker,
  deleteMarker,
  clearNotice,
  createGroup,
  addToGroup,
  removeFromGroup,
} from './studioStore';
import { EASING_NAMES, EASING_LABELS } from '../core/sample';
import { targetAngle } from '../core/constraints';
import type { Track } from '../core/project';

const RULER_H = 36;
const ROW_H = 46;

export default function Timeline() {
  let rulerEl: HTMLDivElement | undefined;
  const [selectedTrack, setSelectedTrack] = createSignal<string | null>(null);
  const [selectedKey, setSelectedKey] = createSignal<{ track: string; key: string } | null>(null);

  const duration = () => state.project.duration;
  const pct = (t: number) => `${(t / duration()) * 100}%`;
  const timeFromEvent = (e: MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * duration();
  };

  // 播放头拖拽(功能点 2)
  const scrub = (e: MouseEvent) => {
    if (!rulerEl) return;
    const move = (ev: MouseEvent) => seek(timeFromEvent(ev, rulerEl!));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    seek(timeFromEvent(e, rulerEl));
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 关键帧拖拽
  const dragKey = (trackId: string, keyId: string) => (e: MouseEvent) => {
    e.stopPropagation();
    setSelectedKey({ track: trackId, key: keyId });
    const row = (e.currentTarget as HTMLElement).closest('.track-row') as HTMLElement;
    const move = (ev: MouseEvent) => moveKeyframe(trackId, keyId, timeFromEvent(ev, row));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 整条轨道平移
  const dragWholeTrack = (track: Track) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('keyframe')) return;
    const row = (e.currentTarget as HTMLElement).closest('.track-row') as HTMLElement;
    const startX = e.clientX;
    const startTime = state.play.time;
    void startTime;
    const move = (ev: MouseEvent) => {
      const delta = ((ev.clientX - startX) / row.clientWidth) * duration();
      dragTrack(track.id, delta);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const ticks = createMemo(() => {
    const n = Math.max(4, Math.round(duration()));
    return Array.from({ length: n + 1 }, (_, i) => (duration() * i) / n);
  });

  const selectedKeyObj = createMemo(() => {
    const sel = selectedKey();
    if (!sel) return null;
    const tr = state.project.tracks.find((t) => t.id === sel.track);
    const kf = tr?.keys.find((k) => k.id === sel.key);
    return tr && kf ? { track: tr, kf } : null;
  });

  const groupOf = (track: Track) =>
    state.project.groups.find((g) => g.id === track.groupId);

  const groupColor = (track: Track) => groupOf(track)?.color ?? 'transparent';

  return (
    <div class="timeline">
      <div class="timeline-toolbar">
        <button class="btn" onClick={() => setPlaying(!state.play.playing)}>
          {state.play.playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button class="btn" onClick={() => { seek(0); setPlaying(true); clearNotice(); }}>
          ⏮ 从头回放
        </button>
        <span class="time-readout">{state.play.time.toFixed(2)}s / {duration().toFixed(1)}s</span>
        <button
          class="btn"
          onClick={() => {
            const g = createGroup(`编组 ${state.project.groups.length + 1}`, '#2a9d8f');
            const ids = state.project.tracks.filter((t) => t.groupId === null).map((t) => t.id);
            if (ids.length) addToGroup(ids, g);
          }}
        >
          ＋ 把未编组轨道成组
        </button>
        <button
          class="btn"
          onClick={() => addMarker('pause', state.play.time, '在此暂停并观察折角')}
        >
          ⏸ 在播放头加暂停点
        </button>
        <button
          class="btn"
          onClick={() => addMarker('note', state.play.time, '文字提示内容')}
        >
          💬 在播放头加提示
        </button>
      </div>

      <div class="timeline-body">
        {/* 轨道名称列 */}
        <div class="track-labels" style={{ height: `${RULER_H + state.project.tracks.length * ROW_H}px` }}>
          <div class="ruler-spacer" style={{ height: `${RULER_H}px` }}>轨道 / 面</div>
          <For each={state.project.tracks}>
            {(track) => (
              <div
                class={`track-label${selectedTrack() === track.id ? ' active' : ''}`}
                style={{ height: `${ROW_H}px`, 'border-left': `4px solid ${track.color}` }}
                onClick={() => setSelectedTrack(track.id === selectedTrack() ? null : track.id)}
              >
                <div class="track-name">{track.name}</div>
                <div class="track-meta">
                  <Show when={track.groupId} fallback={<span class="muted">未编组</span>}>
                    <span class="group-tag" style={{ background: groupColor(track) }}>
                      {groupOf(track)?.name}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* 时间格 */}
        <div class="track-area">
          <div class="ruler" ref={rulerEl} style={{ height: `${RULER_H}px` }} onMouseDown={scrub}>
            <For each={ticks()}>
              {(t) => (
                <div class="tick" style={{ left: pct(t) }}>
                  <span>{t.toFixed(1)}</span>
                </div>
              )}
            </For>
            {/* 标记点 */}
            <For each={state.project.markers}>
              {(m) => (
                <div
                  class={`marker ${m.kind === 'pause' ? 'pause' : 'note'}`}
                  style={{ left: pct(m.time) }}
                  title={`${m.kind === 'pause' ? '暂停点' : '提示'}: ${m.text}`}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {m.kind === 'pause' ? '⏸' : '💬'}
                  <div class="marker-pop">
                    <input
                      value={m.text}
                      onInput={(e) => updateMarker(m.id, { text: e.currentTarget.value })}
                    />
                    <input
                      type="number"
                      step="0.1"
                      value={m.time.toFixed(2)}
                      onInput={(e) => updateMarker(m.id, { time: Number(e.currentTarget.value) })}
                    />
                    <button class="btn small" onClick={() => deleteMarker(m.id)}>删除</button>
                  </div>
                </div>
              )}
            </For>
            <div class="playhead" style={{ left: pct(state.play.time) }} />
          </div>

          <For each={state.project.tracks}>
            {(track) => (
              <div
                class="track-row"
                style={{
                  height: `${ROW_H}px`,
                  background: track.groupId ? groupColor(track) + '22' : 'transparent',
                }}
                onMouseDown={dragWholeTrack(track)}
                onClick={() => setSelectedTrack(track.id)}
              >
                {/* 角度关键帧(功能点 3) */}
                <For each={[...track.keys].sort((a, b) => a.time - b.time)}>
                  {(kf, i) => {
                    const prev = [...track.keys].sort((a, b) => a.time - b.time)[i() - 1];
                    return (
                      <>
                        <Show when={prev}>
                          <svg class="curve" preserveAspectRatio="none" viewBox="0 0 100 100">
                            <path d={curvePath(prev, kf, duration(), targetAngle(state.project, track.faceIdx))} />
                          </svg>
                        </Show>
                        <div
                          class={`keyframe${selectedKey()?.key === kf.id ? ' selected' : ''}`}
                          style={{ left: pct(kf.time), background: track.color }}
                          onMouseDown={dragKey(track.id, kf.id)}
                          title={`t=${kf.time.toFixed(2)}s 角=${kf.angle.toFixed(1)}° ${EASING_LABELS[kf.easing]}`}
                        />
                      </>
                    );
                  }}
                </For>
                <Show when={track.faceIdx !== state.project.net.rootFace}>
                  <button
                    class="btn small add-kf"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      insertKeyframe(track.faceIdx, state.play.time);
                    }}
                  >
                    ＋关键帧
                  </button>
                </Show>
              </div>
            )}
          </For>
          <div class="playhead-line" style={{ left: pct(state.play.time) }} />
        </div>
      </div>

      {/* 选中关键帧编辑器 */}
      <Show when={selectedKeyObj()}>
        {(sel) => (
          <div class="key-editor">
            <span>关键帧:</span>
            <label>时间
              <input
                type="number"
                step="0.1"
                value={sel().kf.time.toFixed(2)}
                onInput={(e) => moveKeyframe(sel().track.id, sel().kf.id, Number(e.currentTarget.value))}
              />s
            </label>
            <label>角度
              <input
                type="number"
                step="1"
                value={sel().kf.angle.toFixed(1)}
                onInput={(e) => setKeyframeAngle(sel().track.id, sel().kf.id, Number(e.currentTarget.value))}
              />°
            </label>
            <label>折叠曲线
              <select
                value={sel().kf.easing}
                onChange={(e) => setKeyframeEasing(sel().track.id, sel().kf.id, e.currentTarget.value as any)}
              >
                <For each={EASING_NAMES}>{(name) => <option value={name}>{EASING_LABELS[name]}</option>}</For>
              </select>
            </label>
            <button class="btn small danger" onClick={() => { deleteKeyframe(sel().track.id, sel().kf.id); setSelectedKey(null); }}>
              删除关键帧
            </button>
          </div>
        )}
      </Show>

      {/* 编组管理 */}
      <Show when={state.project.groups.length > 0}>
        <div class="group-bar">
          <For each={state.project.groups}>
            {(g) => {
              const members = createMemo(() => state.project.tracks.filter((t) => t.groupId === g.id));
              return (
                <div class="group-chip" style={{ background: g.color }}>
                  <span>{g.name}（{members().length} 条轨道,整组拖动保持相对时间）</span>
                  <button
                    class="btn small"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dragGroup(g.id, duration() * 0.05)}
                  >
                    整组右移
                  </button>
                  <button
                    class="btn small"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dragGroup(g.id, -duration() * 0.05)}
                  >
                    整组左移
                  </button>
                  <button
                    class="btn small"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => members().forEach((t) => removeFromGroup(t.id))}
                  >
                    解散
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** 用缓动函数生成关键帧之间的折叠曲线 SVG path */
function curvePath(
  a: { time: number; angle: number; easing: string },
  b: { time: number; angle: number; easing: string },
  duration: number,
  target: number,
): string {
  const span = Math.abs(target) || 1;
  const x0 = (a.time / duration) * 100;
  const x1 = (b.time / duration) * 100;
  // 角度映射到纵向(0..100),折叠角越大越靠上
  const yOf = (angle: number) => 100 - (Math.abs(angle) / span) * 90 - 5;
  const y0 = yOf(a.angle);
  const y1 = yOf(b.angle);
  return `M ${x0} ${y0} L ${x1} ${y1}`;
}
