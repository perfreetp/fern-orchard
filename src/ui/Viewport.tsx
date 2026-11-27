import { onSettled, Show } from 'solid-js';
import { FoldScene } from '../three/FoldScene';
import {
  state,
  currentSample,
  selectFace,
  dragFaceAngle,
  setIntersections,
  trackOf,
  advance as advancePlay,
} from './studioStore';
import { polygonsIntersect } from '../core/intersect';
import { targetAngle } from '../core/constraints';
import { clamp } from '../core/math3d';
import type { SceneSample } from '../core/sample';

export default function Viewport() {
  let container: HTMLDivElement | undefined;
  let scene: FoldScene | undefined;
  let lastTs = 0;

  // Solid 2:onSettled 在首次稳定渲染后于受控作用域运行,返回值作为销毁清理
  onSettled(() => {
    if (!container) return;
    const localScene = new FoldScene(container, state.project);
    scene = localScene;
    localScene.setFaceClickHandler((fi) => selectFace(fi));
    localScene.startLoop();

    const dom = localScene.renderer.domElement;
    let draggingFace: number | null = null;
    let startY = 0;
    let startAngle = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey) return; // shift+拖拽旋转视角,普通拖拽改折角
      const rect = dom.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const fi = localScene.pickFace(nx, ny);
      if (fi === null || fi === state.project.net.rootFace) return;
      draggingFace = fi;
      startY = e.clientY;
      startAngle = currentSample().angles.get(fi) ?? 0;
      dom.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (draggingFace === null) return;
      const dy = startY - e.clientY; // 向上拖折得更拢
      const target = targetAngle(state.project, draggingFace);
      const span = Math.abs(target) || 90;
      const next = clamp(
        startAngle + (dy / 200) * span,
        Math.min(0, target),
        Math.max(0, target),
      );
      dragFaceAngle(draggingFace, next);
    };
    const onUp = () => {
      draggingFace = null;
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = (ts: number) => {
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      if (state.play.playing) advancePlay(dt);
      const sample = currentSample();
      localScene.update(sample);
      localScene.setHighlight(state.play.selectedFace);
      diagnose(sample);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      localScene.dispose();
      scene = undefined;
    };
  });

  function diagnose(sample: SceneSample) {
    const net = state.project.net;
    const adjacent = new Set(
      net.adjacency.flatMap((list, i) =>
        list.map((a) => `${Math.min(i, a.neighbor)}-${Math.max(i, a.neighbor)}`),
      ),
    );
    const pairs: string[] = [];
    for (let i = 0; i < sample.faces.length; i++) {
      for (let j = i + 1; j < sample.faces.length; j++) {
        if (
          polygonsIntersect(
            sample.faces[i].worldVerts,
            sample.faces[j].worldVerts,
            adjacent.has(`${i}-${j}`),
          )
        ) {
          pairs.push(`${i}-${j}`);
        }
      }
    }
    if (pairs.join(',') !== state.play.intersections.join(',')) {
      setIntersections(pairs);
    }
  }

  const selectedAngle = () => {
    const fi = state.play.selectedFace;
    if (fi === null) return null;
    return currentSample().angles.get(fi) ?? 0;
  };
  const selectedTarget = () => {
    const fi = state.play.selectedFace;
    if (fi === null) return null;
    return targetAngle(state.project, fi);
  };

  return (
    <div class="viewport">
      <div class="viewport-canvas" ref={container} />
      <div class="viewport-hud">
        <Show when={state.play.selectedFace !== null}>
          <div class="hud-card">
            <div>
              选中:<strong> 面 {(state.play.selectedFace ?? 0) + 1}</strong>
              <Show when={trackOf(state.play.selectedFace!)?.groupId}>
                {' '}（已编组）
              </Show>
            </div>
            <div>
              当前折角:<strong>{selectedAngle()?.toFixed(1)}°</strong>
              <Show when={selectedTarget() !== null}>
                {' '}/ 目标 {selectedTarget()?.toFixed(1)}°
              </Show>
            </div>
            <div class="hud-hint">在面上按住上下拖动可直接调折角,时间轴关键帧自动跟随</div>
          </div>
        </Show>
        <Show when={state.play.intersections.length > 0}>
          <div class="hud-warn">
            ⚠ 当前时刻检测到面穿插:
            {state.play.intersections.map((p) => `面${p.replace('-', '/')}`).join('、')}
          </div>
        </Show>
        <Show when={state.play.notice}>
          <div class="hud-notice">{state.play.notice}</div>
        </Show>
      </div>
    </div>
  );
}
