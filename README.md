# 多面体展开折叠动画工坊

基于 **SolidJS + three.js + TypeScript** 的多面体展开图折叠回立体动画系统。选择棱柱或棱锥后,系统自动把每个面拆成独立可折叠片并生成折痕,通过多轨道时间轴驱动各面按折痕角度从平铺逐步折成立体。

## 功能与实现对照

| # | 需求 | 实现位置 |
|---|------|----------|
| 1 | 选棱柱/棱锥,自动拆面并在相邻面间生成折痕 | `src/core/net.ts`(`buildNet`:BFS 生成树 + 共享边刚体对齐 + 铰链反解) |
| 2 | 拖动播放头,各面角度随进度连续变化 | `src/ui/Timeline.tsx` + `src/core/sample.ts`(`sampleScene`) |
| 3 | 每面一条轨道,独立起止角度,可错开时间 | `src/core/project.ts` + `Timeline.tsx` 关键帧编辑 |
| 4 | 多轨道编组,整组拖动保持组内相对时间 | `src/core/constraints.ts`(`shiftGroup`)+ `studioStore.ts` |
| 5 | 改折叠曲线后相邻面关键帧跟随重排,防穿插 | `src/core/constraints.ts`(`enforceNoInterpenetration`)+ `src/core/intersect.ts` |
| 6 | 暂停点与文字提示,播放到点停住显示当前折角 | `studioStore.ts`(`advance`/`addMarker`)+ `Timeline.tsx` |
| 7 | 画面直接拖面调折角,时间轴关键帧跟随 | `src/ui/Viewport.tsx` + `dragFaceAngle` |
| 8 | 预览/回放/拖动播放头结果一致 | 唯一样像入口 `sampleScene`,所有入口共用 |
| 9 | 工程存盘可再打开继续编辑 | `src/core/serialize.ts`(JSON + localStorage 自动保存) |

## 架构

```
src/
  core/            框架无关的纯 TypeScript 领域层(可在 node 单测)
    math3d.ts        向量/刚体变换/旋转矩阵反解轴角
    polyhedra.ts     正 n 棱柱、正 n 棱锥生成器 + 面邻接
    net.ts           展开图生成:每面独立 2D 系、折痕铰链(精确轴角反解)
    sample.ts        唯一样像入口:时间 -> 每面折叠角与世界变换
    constraints.ts   防穿插约束、关键帧/编组时间重排
    intersect.ts     凸多边形立体穿插检测(诊断用)
    project.ts       工程数据模型与默认工程工厂
    serialize.ts     工程 JSON 序列化/反序列化、localStorage
  three/
    FoldScene.ts     three.js 枢轴层级渲染,变换与 core 完全一致
  ui/
    studioStore.ts   Solid store:响应式状态 + 全部编辑操作
    Viewport.tsx     3D 视口、轨道相机、画面拖拽折痕、自交诊断
    Timeline.tsx     多轨道时间轴、播放头、关键帧、编组、标记
    Toolbar.tsx      多面体切换、工程导入导出
```

### 关键数学:折叠角不靠法线手算符号

每条折痕的目标旋转由两个刚体变换精确反解:

- `rest` = 平铺时子面 2D 几何对齐到父面共享边的刚体;
- `folded` = `parent.foldedToNet ∘ child.foldedToNet⁻¹`(立体相对变换);
- `deltaR = folded.R · rest.Rᵀ` 必然是绕铰链轴的单轴旋转,用 Rodrigues 反解出轴与角,**符号自动正确**,深层嵌套也不会累积误差。

验证:所有 8 种预设折到终点后,共享顶点偏差 ~1e-15,与原多面体刚体全等;平铺时所有点 z≈0、折痕共享边逐点重合。

## 关于棱柱自交的数学边界

棱锥(所有侧面共享一个顶点)在任意折叠时序下都**严格零自交**。棱柱的侧面形成环,刚性平面片在平铺→立体的中间构型存在**固有自交**——真实折纸靠纸面微小弯曲让开,纯刚性体无法数学消除。系统的处理:

- 约束器保证可严格证明的**生成树父子层级**进度单调(子面不会先于父面折);
- 相交检测器作为**实时诊断**,在视口 HUD 对当前时刻的自交面给出警告;
- 默认工程按 BFS 串行折叠,把自交限制在"已折面 vs 仍平铺面"的扫掠阶段。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器(默认 http://localhost:5173)
npm run build      # 类型检查 + 生产构建
npm test           # 运行核心层单测(19 个)
npx tsx scripts/browser-smoke.ts   # 无头浏览器端到端冒烟(需 Chromium)
```

## 技术栈版本

- SolidJS 2(`@solidjs/web` 渲染,store 草稿式更新,`onSettled` 生命周期)
- three.js 0.187
- Vite 8 + `@solidjs/vite-plugin`
- TypeScript 严格模式、Vitest 5
