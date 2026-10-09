/**
 * scene.js — three.js 3D 魔方场景
 *
 * 职责：
 *  - 27 个 cubelet 的构建与贴纸着色
 *  - 与 Cube 逻辑模型同步（状态 → 贴纸颜色）
 *  - 层旋转动画（带 easing）
 *  - 视角轨道（球坐标，供交互层驱动）
 */

import * as THREE from '../../lib/three.module.js';
import { Cube, FACE_OFFSET } from '../core/cube.js';

// WCA 标准配色（面字母 → 颜色）
export const FACE_COLORS = {
  U: 0xffffff,   // 白
  D: 0xffd500,   // 黄
  F: 0x009b48,   // 绿
  B: 0x0046ad,   // 蓝
  R: 0xb71234,   // 红
  L: 0xff5800,   // 橙
};

const CUBELET_SIZE = 1;
const GAP = 0.06;
const STEP = CUBELET_SIZE + GAP;
const STICKER_SIZE = 0.86;

/** 面字母 → 法向量（世界坐标：x→R, y→U, z→F） */
const FACE_NORMALS = {
  U: [0, 1, 0], D: [0, -1, 0],
  F: [0, 0, 1], B: [0, 0, -1],
  R: [1, 0, 0], L: [-1, 0, 0],
};

export class RubikScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    // 柔和的暗色渐变背景由 CSS 提供，场景透明

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    // 轨道参数（球坐标）
    this.orbit = { theta: Math.PI * 0.28, phi: Math.PI * 0.36, radius: 11 };
    this._updateCamera();

    this._buildLights();
    this._buildCubeGroup();

    // 动画状态
    this.animating = false;
    this._animQueue = [];

    // resize
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, -4, -5);
    this.scene.add(fill);
  }

  _buildCubeGroup() {
    this.cubeGroup = new THREE.Group();
    this.scene.add(this.cubeGroup);

    // 共享几何：黑色本体 + 每面一个圆角贴纸平面
    const bodyGeo = new THREE.BoxGeometry(CUBELET_SIZE, CUBELET_SIZE, CUBELET_SIZE);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x16181d });
    const stickerGeo = this._roundedPlaneGeo(STICKER_SIZE, STICKER_SIZE, 0.1);

    // 每面颜色的材质缓存
    this.stickerMats = {};
    for (const [f, color] of Object.entries(FACE_COLORS)) {
      this.stickerMats[f] = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    }

    this.cubelets = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const group = new THREE.Group();
          group.position.set(x * STEP, y * STEP, z * STEP);
          group.userData.grid = { x, y, z };

          const body = new THREE.Mesh(bodyGeo, bodyMat);
          group.add(body);

          // 六面贴纸（只贴外露面；内部面也贴，被遮挡无妨，简化同步逻辑）
          for (const [f, n] of Object.entries(FACE_NORMALS)) {
            const sticker = new THREE.Mesh(stickerGeo, this.stickerMats[f]);
            const [nx, ny, nz] = n;
            sticker.position.set(nx * (CUBELET_SIZE / 2 + 0.011), ny * (CUBELET_SIZE / 2 + 0.011), nz * (CUBELET_SIZE / 2 + 0.011));
            if (f === 'U' || f === 'D') {
              sticker.rotation.x = f === 'U' ? -Math.PI / 2 : Math.PI / 2;
            } else if (f === 'R' || f === 'L') {
              sticker.rotation.y = f === 'R' ? Math.PI / 2 : -Math.PI / 2;
            } else if (f === 'B') {
              sticker.rotation.y = Math.PI;
            }
            sticker.userData.face = f;
            group.add(sticker);
          }

          this.cubelets.push(group);
          this.cubeGroup.add(group);
        }
      }
    }
  }

  /** 圆角矩形平面几何 */
  _roundedPlaneGeo(w, h, r) {
    const shape = new THREE.Shape();
    const hw = w / 2, hh = h / 2, rr = r;
    shape.moveTo(-hw + rr, -hh);
    shape.lineTo(hw - rr, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + rr);
    shape.lineTo(hw, hh - rr);
    shape.quadraticCurveTo(hw, hh, hw - rr, hh);
    shape.lineTo(-hw + rr, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - rr);
    shape.lineTo(-hw, -hh + rr);
    shape.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
    return new THREE.ShapeGeometry(shape, 4);
  }

  // ---------------------------------------------------------------
  // 模型 → 视图同步
  // ---------------------------------------------------------------

  /**
   * 将逻辑状态同步到 3D 贴纸。
   * 做法：重置 cubelet 位置到网格 + 按每个贴纸位置的颜色设置贴纸材质。
   */
  syncFromCube(cube) {
    // 位置复位（消除动画误差累积）
    for (const cl of this.cubelets) {
      const { x, y, z } = cl.userData.grid;
      cl.position.set(x * STEP, y * STEP, z * STEP);
      cl.rotation.set(0, 0, 0);
      cl.userData.tempRotation = null;
    }
    // 贴纸着色：对每个 cubelet 的每个贴纸，查逻辑模型对应位置的颜色
    for (const cl of this.cubelets) {
      const { x, y, z } = cl.userData.grid;
      for (const sticker of cl.children) {
        if (!sticker.userData.face) continue;
        const f = sticker.userData.face;
        const pos = this._faceletOf(f, x, y, z);   // [face, idx]
        if (!pos) { sticker.visible = false; continue; }
        sticker.visible = true;
        const color = cube.stickers[FACE_OFFSET[pos[0]] + pos[1]];
        sticker.material = this.stickerMats[color];
      }
    }
  }

  /**
   * cubelet 网格坐标 + 面字母 → facelet (face, idx)。
   * 只处理外露贴纸（|coord| = 1 的方向）；内面返回 null。
   */
  _faceletOf(face, x, y, z) {
    // 面内行列（与 cube.js 的 facelet 编号一致）
    // U: 从上看 row0 靠 B(z=-1) col0 靠 L(x=-1) → row = z+1, col = x+1
    // D: row0 靠 F(z=+1), col0 靠 L → row = 1-z, col = x+1
    // F: row0 靠 U(y=+1), col0 靠 L → row = 1-y, col = x+1
    // B: row0 靠 U, col0 靠 R(x=+1) → row = 1-y, col = 1-x
    // R: row0 靠 U, col0 靠 F(z=+1) → row = 1-y, col = 1-z
    // L: row0 靠 U, col0 靠 B(z=-1) → row = 1-y, col = z+1
    switch (face) {
      case 'U': if (y !== 1) return null; return ['U', (z + 1) * 3 + (x + 1)];
      case 'D': if (y !== -1) return null; return ['D', (1 - z) * 3 + (x + 1)];
      case 'F': if (z !== 1) return null; return ['F', (1 - y) * 3 + (x + 1)];
      case 'B': if (z !== -1) return null; return ['B', (1 - y) * 3 + (1 - x)];
      case 'R': if (x !== 1) return null; return ['R', (1 - y) * 3 + (1 - z)];
      case 'L': if (x !== -1) return null; return ['L', (1 - y) * 3 + (z + 1)];
    }
    return null;
  }

  // ---------------------------------------------------------------
  // 层旋转动画
  // ---------------------------------------------------------------

  /** 转动的轴与方向（three.js 坐标）；M/E/S 为中层（M 同 L、E 同 D、S 同 F 方向） */
  static MOVE_AXIS = {
    U: { axis: [0, 1, 0], dir: -1 },   // U 顺时针（从上看）= 绕 +y 负角
    D: { axis: [0, 1, 0], dir: 1 },
    R: { axis: [1, 0, 0], dir: -1 },
    L: { axis: [1, 0, 0], dir: 1 },
    F: { axis: [0, 0, 1], dir: -1 },
    B: { axis: [0, 0, 1], dir: 1 },
    M: { axis: [1, 0, 0], dir: 1 },    // M 同 L 方向（绕 x 正角）
    E: { axis: [0, 1, 0], dir: 1 },    // E 同 D 方向
    S: { axis: [0, 0, 1], dir: -1 },   // S 同 F 方向
  };

  /** 选择某层的 cubelets（世界坐标过滤；M/E/S 取中层 0） */
  _layerOf(face) {
    const comp = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z', M: 'x', E: 'y', S: 'z' }[face];
    const val = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1, M: 0, E: 0, S: 0 }[face];
    this.cubeGroup.updateMatrixWorld();
    return this.cubelets.filter(cl => {
      const wp = new THREE.Vector3();
      cl.getWorldPosition(wp);
      return Math.round(wp[comp] / STEP) === val;
    });
  }

  /**
   * 执行一步转动动画（Promise，动画完成后 resolve）。
   * @param move 'R' / "U'" / 'F2' / 'M' / "E'" / 'S2' …
   * @param durationMs 每个四分之一转的时长
   */
  animateMove(move, durationMs = 160) {
    return new Promise(resolve => {
      const face = move[0];
      const suf = move.slice(1);
      const quarter = suf === '2' ? 2 : 1;
      const sign = suf === "'" ? -1 : 1;
      const { axis, dir } = RubikScene.MOVE_AXIS[face];
      const totalAngle = dir * sign * quarter * Math.PI / 2;
      const duration = durationMs * quarter;

      const layer = this._layerOf(face);
      const pivot = new THREE.Group();
      this.cubeGroup.add(pivot);
      for (const cl of layer) pivot.attach(cl);

      const startTime = performance.now();
      let finished = false;
      const animate = () => {
        if (finished) return;
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
        const angle = totalAngle * ease;
        pivot.setRotationFromAxisAngle(new THREE.Vector3(...axis), angle);
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          finished = true;
          // 归位：把 cubelets 从 pivot 移回 cubeGroup，位置取整
          pivot.updateMatrixWorld();
          for (const cl of layer) this.cubeGroup.attach(cl);
          this.cubeGroup.remove(pivot);
          // 位置/旋转吸附到网格，消除浮点误差
          for (const cl of layer) {
            cl.position.x = Math.round(cl.position.x / STEP) * STEP;
            cl.position.y = Math.round(cl.position.y / STEP) * STEP;
            cl.position.z = Math.round(cl.position.z / STEP) * STEP;
            cl.rotation.set(
              Math.round(cl.rotation.x / (Math.PI / 2)) * Math.PI / 2,
              Math.round(cl.rotation.y / (Math.PI / 2)) * Math.PI / 2,
              Math.round(cl.rotation.z / (Math.PI / 2)) * Math.PI / 2
            );
          }
          resolve();
        }
      };
      requestAnimationFrame(animate);
      // rAF 后台节流兜底：若页面隐藏导致 rAF 停摆，用 setTimeout 强制完成动画
      setTimeout(() => {
        if (!finished) {
          pivot.setRotationFromAxisAngle(new THREE.Vector3(...axis), totalAngle);
          animate();   // finished 置位 + 归位 + resolve
        }
      }, duration + 300);
    });
  }

  /** 是否有动画进行中 */
  get busy() { return this.animating; }

  // ---------------------------------------------------------------
  // 相机 / 轨道
  // ---------------------------------------------------------------

  _updateCamera() {
    const { theta, phi, radius } = this.orbit;
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  /** 交互层调用：按屏幕位移旋转视角 */
  orbitDelta(dx, dy) {
    this.orbit.theta -= dx * 0.008;
    this.orbit.phi = Math.max(0.12, Math.min(Math.PI - 0.12, this.orbit.phi - dy * 0.008));
    this._updateCamera();
  }

  zoomDelta(d) {
    this.orbit.radius = Math.max(6.5, Math.min(18, this.orbit.radius + d));
    this._updateCamera();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
