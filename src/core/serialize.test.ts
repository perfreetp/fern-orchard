import { describe, expect, it } from 'vitest';
import { regularPrism, regularPyramid } from './polyhedra';
import { createProject } from './project';
import { serializeProject, deserializeProject } from './serialize';
import { sampleScene } from './sample';
import { setAngleAtTime, enforceNoInterpenetration } from './constraints';

describe('工程序列化(功能点 9)', () => {
  it('工程存成 JSON 再打开,轨道/关键帧/编组/标记全部还原', () => {
    const project = createProject(regularPrism(4), 8);
    // 做一些编辑:加关键帧、加编组、加标记
    const track = project.tracks[2];
    setAngleAtTime(project, track, 3.5, 45);
    enforceNoInterpenetration(project);
    const gid = 'group-test';
    project.groups.push({ id: gid, name: '测试组', color: '#2a9d8f' });
    project.tracks[2].groupId = gid;
    project.tracks[3].groupId = gid;
    project.markers.push({
      id: 'm1',
      time: 2.5,
      kind: 'pause',
      text: '停一下看角度',
    });

    const json = serializeProject(project);
    const restored = deserializeProject(json);

    expect(restored.polyhedronId).toBe(project.polyhedronId);
    expect(restored.duration).toBe(8);
    expect(restored.tracks.length).toBe(project.tracks.length);
    expect(restored.groups).toEqual(project.groups);
    expect(restored.markers).toEqual(project.markers);
    // 关键帧角度一致
    const rt = restored.tracks.find((t) => t.faceIdx === 2)!;
    const ot = project.tracks.find((t) => t.faceIdx === 2)!;
    expect(rt.keys.map((k) => [k.time, k.angle])).toEqual(
      ot.keys.map((k) => [k.time, k.angle]),
    );
  });

  it('非法文件抛出明确错误', () => {
    expect(() => deserializeProject('{"app":"wrong"}')).toThrow();
    expect(() => deserializeProject('not json')).toThrow();
  });
});

describe('预览/回放一致性(功能点 8)', () => {
  it('同一时刻无论从哪个入口采样,画面角度与数值完全相同', () => {
    const project = createProject(regularPyramid(4), 6);
    // 模拟拖动播放头到任意位置 vs 顺序播放到同一位置
    const times = [0, 0.7, 1.3, 2.9, 4.1, 5.5, 6];
    for (const t of times) {
      const a = sampleScene(project, t);
      const b = sampleScene(project, t);
      expect(JSON.stringify(a.angles)).toBe(JSON.stringify(b.angles));
      a.faces.forEach((f, i) => {
        expect(f.worldVerts).toEqual(b.faces[i].worldVerts);
      });
    }
  });

  it('拖动播放头到任意时间,角度始终在合法范围内', () => {
    const project = createProject(regularPrism(3), 6);
    const track = project.tracks[1];
    for (const t of [0, 1.5, 3, 4.5, 6]) {
      const sample = sampleScene(project, t);
      const angle = sample.angles.get(track.faceIdx);
      const hinge = project.net.hingeByChild.get(track.faceIdx)!;
      const bound = Math.abs(hinge.foldDeg);
      expect(Math.abs(angle ?? 0)).toBeLessThanOrEqual(bound + 1e-9);
      expect(Math.abs(angle ?? 0)).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
