import type { Project } from './project';
import { createProject, buildPreset } from './project';
import { buildNet } from './net';

const STORAGE_KEY = 'polyhedron-fold-studio/project/v1';

interface ProjectFile {
  app: 'polyhedron-fold-studio';
  version: 1;
  savedAt: string;
  data: SerializedProject;
}

/** Net 可由多面体完全重建,落盘时只存多面体 id,避免冗余与不一致 */
interface SerializedProject {
  polyhedronId: string;
  duration: number;
  tracks: Project['tracks'];
  groups: Project['groups'];
  markers: Project['markers'];
  selectedFace: number | null;
}

export function serializeProject(project: Project): string {
  const file: ProjectFile = {
    app: 'polyhedron-fold-studio',
    version: 1,
    savedAt: new Date().toISOString(),
    data: {
      polyhedronId: project.polyhedronId,
      duration: project.duration,
      tracks: project.tracks,
      groups: project.groups,
      markers: project.markers,
      selectedFace: project.selectedFace,
    },
  };
  return JSON.stringify(file, null, 2);
}

export function deserializeProject(text: string): Project {
  const file = JSON.parse(text) as ProjectFile;
  if (file.app !== 'polyhedron-fold-studio') {
    throw new Error('不是本工具导出的工程文件');
  }
  if (file.version !== 1) {
    throw new Error(`不支持的工程版本: ${file.version}`);
  }
  return hydrate(file.data);
}

function hydrate(data: SerializedProject): Project {
  const poly = buildPreset(data.polyhedronId);
  const fresh = createProject(poly, data.duration);
  // 用重建的 net 做一致性校验:邻接关系必须和存档时相同
  const rebuilt = buildNet(poly);
  if (rebuilt.hinges.length !== fresh.net.hinges.length) {
    throw new Error('工程与当前多面体模型不匹配');
  }
  return {
    ...fresh,
    duration: data.duration,
    tracks: data.tracks,
    groups: data.groups,
    markers: data.markers,
    selectedFace: data.selectedFace,
    net: rebuilt,
  };
}

export function saveToLocalStorage(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
  } catch (err) {
    console.warn('自动保存失败', err);
  }
}

export function loadFromLocalStorage(): Project | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return deserializeProject(text);
  } catch (err) {
    console.warn('读取本地工程失败', err);
    return null;
  }
}

export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fold-project-${project.polyhedronId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  return deserializeProject(text);
}
