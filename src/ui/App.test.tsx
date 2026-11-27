import { describe, it, expect } from 'vitest';
import { renderToString } from '@solidjs/web';
import App from './App';

/** SSR 会把非 ASCII 文本转义成 &#...; 实体,断言前先解码 */
function decode(html: string): string {
  return html.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

describe('应用 SSR 冒烟', () => {
  it('App 能完整渲染出工具栏、视口、时间轴三大区域', async () => {
    const html = decode(await renderToString(() => <App />));
    expect(html).toContain('多面体展开折叠动画工坊');
    expect(html).toContain('播放');
    expect(html).toContain('从头回放');
    expect(html).toContain('关键帧');
    // 默认四棱柱有 6 个面 => 6 条轨道
    const trackCount = (html.match(/track-label/g) || []).length;
    expect(trackCount).toBe(6);
  });

  it('工具栏包含全部 8 个多面体预设选项', async () => {
    const html = decode(await renderToString(() => <App />));
    expect(html).toContain('三棱柱');
    expect(html).toContain('六棱锥');
  });

  it('默认工程在时间轴上为每个非根面输出起止关键帧', async () => {
    const html = await renderToString(() => <App />);
    const kfCount = (html.match(/class="keyframe/g) || []).length;
    // 至少覆盖根面 1 帧 + 5 个非根面各自的起止帧
    expect(kfCount).toBeGreaterThanOrEqual(1 + 5 * 2);
    // 折叠曲线(非根面相邻关键帧之间)也被绘制
    expect((html.match(/<path/g) || []).length).toBeGreaterThan(0);
  });
});
