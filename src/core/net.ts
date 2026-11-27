import {
  type Mat3,
  type Transform,
  type Vec3,
  applyMat3,
  applyTransform,
  composeTransform,
  cross,
  deg,
  identityTransform,
  invertRigid,
  matrixToAxisAngle,
  mulMat3,
  normalize,
  sub,
  transposeMat3,
} from './math3d';
import {
  type Adjacency,
  type PolyhedronDef,
  buildAdjacency,
  faceNormal,
} from './polyhedra';

/**
 * 一条折痕。所有几何量表达在【父面的 net2D 局部系】中:
 * - rest:   平铺静止姿势下,子面 net2D -> 父面 net2D 的 2D 刚体(共享边逐点重合)
 * - pivot/axis/foldRad:从"立体相对旋转 folded.R * rest.R^T"反解出的精确单轴旋转
 */
export interface Hinge {
  id: string;
  parentFace: number;
  childFace: number;
  pivot: Vec3;
  axis: Vec3;
  /** 目标折叠角(度,带符号) */
  foldDeg: number;
  /** 目标折叠角(弧度) */
  foldRad: number;
  /** 平铺相对刚体变换(子局部 -> 父局部) */
  rest: Transform;
  edgeVerts: [number, number];
}

export interface NetFace {
  faceIdx: number;
  parent: number | null;
  hingeId: string | null;
  /** 该面自身 2D 局部系顶点(顶点 id -> 坐标,z=0) */
  net2D: Map<number, Vec3>;
  /** 立体 3D 点 -> 该面 2D 局部点 的刚体变换 */
  foldedToNet: Transform;
  basis: { ex: Vec3; ey: Vec3; ez: Vec3 };
}

export interface Net {
  poly: PolyhedronDef;
  faces: NetFace[];
  hinges: Hinge[];
  hingeByChild: Map<number, Hinge>;
  childrenOf: Map<number, number[]>;
  rootFace: number;
  adjacency: Adjacency[][];
  /** 每面 2D 局部 -> 统一平铺世界(校验/整体布局用) */
  localToFlatWorld: Transform[];
}

function faceBasis(poly: PolyhedronDef, fi: number) {
  const loop = poly.faces[fi];
  const ez = faceNormal(poly, fi);
  const ex = normalize(sub(poly.vertices[loop[1]], poly.vertices[loop[0]]));
  const ey = cross(ez, ex);
  return { ex, ey, ez };
}

function transformFromBasis(
  origin3D: Vec3,
  basis: { ex: Vec3; ey: Vec3; ez: Vec3 },
): Transform {
  const R: Mat3 = [
    basis.ex[0], basis.ex[1], basis.ex[2],
    basis.ey[0], basis.ey[1], basis.ey[2],
    basis.ez[0], basis.ez[1], basis.ez[2],
  ];
  return { R, t: origin3D };
}

function rotZ(angleRad: number): Mat3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

/** 求把线段 (a0,a1) 刚体映射到 (b0,b1) 的 2D(绕 z)刚体变换 */
function alignRigid2D(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): Transform {
  const src = sub(a1, a0);
  const dst = sub(b1, b0);
  const angle = Math.atan2(
    src[0] * dst[1] - src[1] * dst[0],
    src[0] * dst[0] + src[1] * dst[1],
  );
  const R = rotZ(angle);
  return { R, t: sub(b0, applyMat3(R, a0)) };
}

/**
 * 展开多面体并求每条折痕的精确铰链参数。
 * 折叠角不靠法线手算符号,而是由立体相对旋转矩阵反解轴角,天然带正确符号。
 */
export function buildNet(poly: PolyhedronDef, rootFace = 0): Net {
  const adjacency = buildAdjacency(poly);
  const faces: (NetFace | undefined)[] = new Array(poly.faces.length);
  const hinges: Hinge[] = [];
  const hingeByChild = new Map<number, Hinge>();
  const childrenOf = new Map<number, number[]>();
  const localToFlatWorld: Transform[] = new Array(poly.faces.length);

  const makeNode = (fi: number): NetFace => {
    const basis = faceBasis(poly, fi);
    const origin = poly.vertices[poly.faces[fi][0]];
    const localTo3D = transformFromBasis(origin, basis);
    const foldedToNet = invertRigid(localTo3D);
    const net2D = new Map<number, Vec3>();
    for (const vi of poly.faces[fi]) {
      net2D.set(vi, applyTransform(foldedToNet, poly.vertices[vi]));
    }
    return { faceIdx: fi, parent: null, hingeId: null, net2D, foldedToNet, basis };
  };

  const rootNode = makeNode(rootFace);
  faces[rootFace] = rootNode;
  localToFlatWorld[rootFace] = identityTransform();

  const queue: number[] = [rootFace];
  const visited = new Set<number>([rootFace]);

  while (queue.length) {
    const fi = queue.shift()!;
    const parentNode = faces[fi]!;
    const parentFlat = localToFlatWorld[fi];

    for (const adj of adjacency[fi]) {
      const ci = adj.neighbor;
      if (visited.has(ci)) continue;
      visited.add(ci);

      const childNode = makeNode(ci);
      const [va, vb] = adj.edge;

      const cA = childNode.net2D.get(va)!;
      const cB = childNode.net2D.get(vb)!;
      const pA = parentNode.net2D.get(va)!;
      const pB = parentNode.net2D.get(vb)!;

      // 1) 平铺相对变换:子 2D 共享边 -> 父 2D 共享边
      const rest = alignRigid2D(cA, cB, pA, pB);

      // 2) 立体相对变换:parent.foldedToNet ∘ child.foldedToNet⁻¹
      const folded = composeTransform(
        parentNode.foldedToNet,
        invertRigid(childNode.foldedToNet),
      );

      // 3) 两者旋转之差 = 折叠这一动作的单轴旋转,反解精确轴角(符号自动正确)
      const deltaR = mulMat3(folded.R, transposeMat3(rest.R));
      const { axis, angle: foldRad } = matrixToAxisAngle(deltaR);

      const hinge: Hinge = {
        id: `hinge-${fi}-${ci}`,
        parentFace: fi,
        childFace: ci,
        pivot: pA,
        axis,
        foldDeg: deg(foldRad),
        foldRad,
        rest,
        edgeVerts: adj.edge,
      };
      hinges.push(hinge);
      hingeByChild.set(ci, hinge);

      childNode.parent = fi;
      childNode.hingeId = hinge.id;
      faces[ci] = childNode;

      localToFlatWorld[ci] = composeTransform(parentFlat, rest);

      if (!childrenOf.has(fi)) childrenOf.set(fi, []);
      childrenOf.get(fi)!.push(ci);
      queue.push(ci);
    }
  }

  if (visited.size !== poly.faces.length) {
    throw new Error('展开失败:多面体的面不连通');
  }

  return {
    poly,
    faces: faces as NetFace[],
    hinges,
    hingeByChild,
    childrenOf,
    rootFace,
    adjacency,
    localToFlatWorld,
  };
}

/** 校验:所有平铺点 z≈0;折痕树边的共享端点在统一平铺世界逐点重合 */
export function validateNet(net: Net): string[] {
  const errors: string[] = [];
  net.faces.forEach((f, fi) => {
    const flat = net.localToFlatWorld[fi];
    for (const local of f.net2D.values()) {
      const p = applyTransform(flat, local);
      if (Math.abs(p[2]) > 1e-5) errors.push(`面 ${fi} 平铺后不在 z=0 平面`);
    }
  });
  for (const hinge of net.hinges) {
    const parent = net.faces[hinge.parentFace];
    const child = net.faces[hinge.childFace];
    const pf = net.localToFlatWorld[hinge.parentFace];
    const cf = net.localToFlatWorld[hinge.childFace];
    for (const vi of hinge.edgeVerts) {
      const a = applyTransform(pf, parent.net2D.get(vi)!);
      const b = applyTransform(cf, child.net2D.get(vi)!);
      if (
        Math.abs(a[0] - b[0]) > 1e-5 ||
        Math.abs(a[1] - b[1]) > 1e-5 ||
        Math.abs(a[2] - b[2]) > 1e-5
      ) {
        errors.push(`折痕 ${hinge.id} 的共享顶点 ${vi} 平铺后不重合`);
      }
    }
  }
  return errors;
}

export function treeDepths(net: Net): Map<number, number> {
  const depths = new Map<number, number>([[net.rootFace, 0]]);
  const walk = (fi: number) => {
    for (const c of net.childrenOf.get(fi) ?? []) {
      depths.set(c, depths.get(fi)! + 1);
      walk(c);
    }
  };
  walk(net.rootFace);
  return depths;
}

export { identityTransform };
