import * as THREE from 'three';
import type { Project } from '../core/project';
import type { SceneSample } from '../core/sample';
import type { Net } from '../core/net';
import type { Vec3 } from '../core/math3d';

export interface FaceMesh {
  faceIdx: number;
  /** 枢轴组:位置/旋转表达相对父面的铰链变换 */
  pivot: THREE.Group;
  /** 实际面片(带材质),挂在 pivot 下 */
  mesh: THREE.Mesh;
  /** 折痕高亮线 */
  hingeLine: THREE.Line;
}

const toV3 = (p: Vec3): THREE.Vector3 =>
  new THREE.Vector3(p[0], p[1], p[2]);

export class FoldScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private faceMap = new Map<number, FaceMesh>();
  private rootGroup = new THREE.Group();
  private project: Project;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private raf = 0;
  private onFaceClick?: (faceIdx: number) => void;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  constructor(container: HTMLElement, project: Project) {
    this.project = project;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0xf5f6f8, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      1000,
    );
    this.camera.position.set(4, -6, 5);
    this.camera.lookAt(0, 0, 0);

    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, -6, 8);
    this.scene.add(amb, dir);
    this.scene.add(this.rootGroup);

    this.buildFaces(project.net);
    this.attachOrbit(container);
    this.attachPick(container);

    const resize = new ResizeObserver(() => this.resize(container));
    resize.observe(container);
  }

  setFaceClickHandler(fn: (faceIdx: number) => void): void {
    this.onFaceClick = fn;
  }

  private buildFaces(net: Net): void {
    // 先建每个面的 pivot(空组),再按生成树挂到父 pivot 下
    const pivots = new Map<number, THREE.Group>();
    net.faces.forEach((node) => {
      const g = new THREE.Group();
      g.name = `pivot-face-${node.faceIdx}`;
      pivots.set(node.faceIdx, g);
      this.rootGroup.add(g); // 临时都挂根,后面重新父子化
    });

    net.faces.forEach((node, fi) => {
      const track = this.project.tracks.find((t) => t.faceIdx === fi)!;
      const loop = net.poly.faces[fi];
      const verts = loop.map((vi) => toV3(node.net2D.get(vi)!));

      const shape = new THREE.Shape(
        verts.map((p) => new THREE.Vector2(p.x, p.y)),
      );
      const geom = new THREE.ShapeGeometry(shape);
      // ShapeGeometry 在 xy 平面,把 z 抬到 0 并迁移真实 z(平铺时为 0)
      const pos = geom.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const srcV = verts[Math.min(k, verts.length - 1)];
        pos.setZ(k, srcV.z);
      }
      geom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: track.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        roughness: 0.55,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData.faceIdx = fi;

      // 边线
      const edges = new THREE.EdgesGeometry(geom);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x2c3e50 }),
      );
      mesh.add(line);

      const pivot = pivots.get(fi)!;
      pivot.add(mesh);

      let hingeLine: THREE.Line;
      if (node.parent !== null) {
        const hinge = net.hingeByChild.get(fi)!;
        const [va, vb] = hinge.edgeVerts;
        const pa = node.net2D.get(va)!;
        const pb = node.net2D.get(vb)!;
        const g2 = new THREE.BufferGeometry().setFromPoints([toV3(pa), toV3(pb)]);
        hingeLine = new THREE.Line(
          g2,
          new THREE.LineBasicMaterial({ color: 0x111111, linewidth: 2 }),
        );
        pivot.add(hingeLine);
      } else {
        hingeLine = new THREE.Line();
      }

      this.faceMap.set(fi, { faceIdx: fi, pivot, mesh, hingeLine });
    });

    // 父子化:子 pivot 挂到父 pivot
    net.faces.forEach((node) => {
      if (node.parent === null) return;
      const childG = pivots.get(node.faceIdx)!;
      const parentG = pivots.get(node.parent)!;
      if (childG.parent) childG.parent.remove(childG);
      parentG.add(childG);
    });

    this.centerCamera(net);
  }

  private centerCamera(net: Net): void {
    const box = new THREE.Box3();
    net.faces.forEach((node) => {
      for (const p of node.net2D.values()) box.expandByPoint(toV3(p));
    });
    const center = box.getCenter(new THREE.Vector3());
    this.orbitTarget.copy(center);
    this.camera.lookAt(center);
  }

  /** 用样像结果更新所有 pivot 的局部变换(与 core/sample 完全一致) */
  update(sample: SceneSample): void {
    const net = this.project.net;
    sample.faces.forEach((sf) => {
      const entry = this.faceMap.get(sf.faceIdx)!;
      const node = net.faces[sf.faceIdx];
      if (node.parent === null) {
        entry.pivot.position.set(0, 0, 0);
        entry.pivot.quaternion.identity();
        return;
      }
      const hinge = net.hingeByChild.get(sf.faceIdx)!;
      // 平铺对齐 rest:子 pivot 先搬到父面共享边
      entry.pivot.position.set(
        hinge.rest.t[0],
        hinge.rest.t[1],
        hinge.rest.t[2],
      );
      const restQ = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...col(hinge.rest.R, 0)),
          new THREE.Vector3(...col(hinge.rest.R, 1)),
          new THREE.Vector3(...col(hinge.rest.R, 2)),
        ),
      );
      // 再叠加绕铰链轴的当前旋转
      const target = hinge.foldDeg;
      const s = Math.abs(target) < 1e-9 ? 0 : sf.angleDeg / target;
      const hingeQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(hinge.axis[0], hinge.axis[1], hinge.axis[2]),
        hinge.foldRad * s,
      );
      // pivot 的世界旋转 = rest 旋转 * 铰链旋转;平移用 rest.t(铰链点已在父系)
      entry.pivot.quaternion.copy(restQ).multiply(hingeQ);
    });
  }

  setHighlight(faceIdx: number | null): void {
    this.faceMap.forEach((f, i) => {
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(i === faceIdx ? 0x444422 : 0x000000);
      mat.opacity = faceIdx === null || i === faceIdx ? 0.92 : 0.75;
    });
  }

  private attachOrbit(container: HTMLElement): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let spherical = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.orbitTarget),
    );
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      spherical.theta -= dx * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - dy * 0.01));
      this.applyCamera(spherical);
    });
    dom.addEventListener('pointerup', () => (dragging = false));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        let spherical2 = new THREE.Spherical().setFromVector3(
          this.camera.position.clone().sub(this.orbitTarget),
        );
        spherical2.radius = Math.max(
          1,
          Math.min(60, spherical2.radius * (1 + e.deltaY * 0.001)),
        );
        this.applyCamera(spherical2);
        spherical = spherical2;
      },
      { passive: false },
    );
  }

  private applyCamera(spherical: THREE.Spherical): void {
    const pos = new THREE.Vector3().setFromSpherical(spherical).add(this.orbitTarget);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.orbitTarget);
  }

  private attachPick(container: HTMLElement): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('click', (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes = [...this.faceMap.values()].map((f) => f.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length && this.onFaceClick) {
        this.onFaceClick(hits[0].object.userData.faceIdx as number);
      }
    });
    void container;
  }

  /** 返回当前画面上面被点击的面(供折痕拖拽复用),无命中返回 null */
  pickFace(nx: number, ny: number): number | null {
    this.pointer.set(nx, ny);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.faceMap.values()].map((f) => f.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? (hits[0].object.userData.faceIdx as number) : null;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  private resize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  startLoop(): void {
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function col(m: number[], c: number): [number, number, number] {
  return [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];
}
