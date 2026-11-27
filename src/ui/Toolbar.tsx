import { For, createSignal } from 'solid-js';
import { PRESETS } from '../core/project';
import {
  state,
  switchPolyhedron,
  exportProjectFile,
  importProjectText,
  newProject,
  setDuration,
  projectJSON,
} from './studioStore';

export default function Toolbar() {
  const [showJson, setShowJson] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const onPickFile = async (file: File) => {
    const text = await file.text();
    importProjectText(text);
  };

  return (
    <div class="toolbar">
      <div class="brand">多面体展开折叠动画工坊</div>
      <label class="field">
        多面体
        <select
          value={state.project.polyhedronId}
          onChange={(e) => switchPolyhedron(e.currentTarget.value)}
        >
          <For each={PRESETS}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
      </label>
      <label class="field">
        总时长
        <input
          type="number"
          min="1"
          max="60"
          step="1"
          value={state.project.duration}
          onChange={(e) => setDuration(Number(e.currentTarget.value))}
        />s
      </label>
      <button class="btn" onClick={() => newProject(state.project.polyhedronId)}>
        ↺ 重置为默认工程
      </button>
      <span class="spacer" />
      <button class="btn" onClick={exportProjectFile}>💾 导出工程</button>
      <button class="btn" onClick={() => fileInput?.click()}>📂 打开工程</button>
      <button class="btn ghost" onClick={() => setShowJson(!showJson())}>
        {showJson() ? '隐藏 JSON' : '查看工程 JSON'}
      </button>
      <input
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        ref={fileInput}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onPickFile(f);
          e.currentTarget.value = '';
        }}
      />
      {showJson() && (
        <div class="json-pop">
          <pre>{projectJSON()}</pre>
        </div>
      )}
    </div>
  );
}
