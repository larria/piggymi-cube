/**
 * interaction.js — 交互层
 *
 *  - 拖拽空白处 / 右键拖拽 → 旋转视角（轨道）
 *  - 拖拽魔方表面 → 转动对应层（raycast 命中贴纸 + 拖拽方向判定期转动的面与方向）
 *  - 触摸支持（单指 = 鼠标左键逻辑；双指捏合 = 缩放）
 *  - 滚轮缩放
 *
 * 交互协议：手势结束后回调 onMove(moveString)，由 main.js 决定是否执行。
 */

import * as THREE from '../../lib/three.module.js';

/** 面 → 可转动方向配置。结构：命中面 f，切向轴 t（世界坐标），绕轴 a 转 dir */
const DRAG_MAP = {
  // 命中 U 面：拖拽 ±x → 转 F/B 层（z 轴），拖拽 ±z → 转 R/L 层（x 轴）
  U: {
    x: { faces: ['F', 'B'], axis: 'z' },   // 沿 x 拖 → 绕 z 轴
    z: { faces: ['R', 'L'], axis: 'x' },   // 沿 z 拖 → 绕 x 轴
  },
  D: {
    x: { faces: ['F', 'B'], axis: 'z' },
    z: { faces: ['R', 'L'], axis: 'x' },
  },
  F: {
    x: { faces: ['U', 'D'], axis: 'y' },
    y: { faces: ['R', 'L'], axis: 'x' },
  },
  B: {
    x: { faces: ['U', 'D'], axis: 'y' },
    y: { faces: ['R', 'L'], axis: 'x' },
  },
  R: {
    z: { faces: ['U', 'D'], axis: 'y' },
    y: { faces: ['F', 'B'], axis: 'z' },
  },
  L: {
    z: { faces: ['U', 'D'], axis: 'y' },
    y: { faces: ['F', 'B'], axis: 'z' },
  },
};

export class Interaction {
  /**
   * @param scene  RubikScene 实例
   * @param opts   { onMove(move), onOrbit(dx,dy), onZoom(d), canInteract() }
   */
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.drag = null;        // { mode: 'orbit'|'cube', ... }
    this.pinch = null;       // 双指状态

    const el = scene.canvas;
    // Pointer Events 统一鼠标/触摸
    el.addEventListener('pointerdown', e => this._down(e));
    el.addEventListener('pointermove', e => this._move(e));
    el.addEventListener('pointerup', e => this._up(e));
    el.addEventListener('pointercancel', e => this._up(e));
    el.addEventListener('wheel', e => this._wheel(e), { passive: false });
    // 触摸双指
    el.addEventListener('touchstart', e => this._touchStart(e), { passive: false });
    el.addEventListener('touchmove', e => this._touchMove(e), { passive: false });
    el.addEventListener('touchend', e => this._touchEnd(e), { passive: false });
    // 上下文菜单禁用（右键用于轨道）
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  get canInteract() {
    return this.opts.canInteract ? this.opts.canInteract() : true;
  }

  _ndc(e) {
    const rect = this.scene.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** raycast 命中的贴纸（返回 { face, cubelet, point, normal } 或 null） */
  pickSticker(e) {
    this.pointer.copy(this._ndc(e));
    this.raycaster.setFromCamera(this.pointer, this.scene.camera);
    // 只检测贴纸 mesh（userData.face 存在）
    const stickers = [];
    this.scene.cubeGroup.traverse(obj => { if (obj.userData.face) stickers.push(obj); });
    const hits = this.raycaster.intersectObjects(stickers, false);
    for (const h of hits) {
      if (!h.object.visible) continue;
      return {
        face: h.object.userData.face,
        cubelet: h.object.parent,
        point: h.point.clone(),
        normal: h.face.normal.clone().transformDirection(h.object.matrixWorld),
      };
    }
    return null;
  }

  _down(e) {
    if (e.button === 2 || e.button === 1) {
      // 右键/中键 → 轨道
      this.drag = { mode: 'orbit', x: e.clientX, y: e.clientY };
      return;
    }
    if (!this.canInteract) { this.drag = { mode: 'orbit', x: e.clientX, y: e.clientY }; return; }
    const hit = this.pickSticker(e);
    if (hit) {
      this.drag = {
        mode: 'cube',
        start: { x: e.clientX, y: e.clientY },
        hit,
        moved: false,
      };
    } else {
      this.drag = { mode: 'orbit', x: e.clientX, y: e.clientY };
    }
    try { this.scene.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _move(e) {
    if (!this.drag) return;
    if (this.drag.mode === 'orbit') {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.opts.onOrbit(dx, dy);
      return;
    }
    // cube 拖拽：位移足够后立即触发一次转动（不等待抬起，体验更跟手）
    if (this.drag.mode === 'cube' && !this.drag.moved) {
      const dx = e.clientX - this.drag.start.x;
      const dy = e.clientY - this.drag.start.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 26) {
        const mv = this._resolveDragMove(this.drag.hit, dx, dy);
        this.drag.moved = true;
        if (mv && this.canInteract) this.opts.onMove(mv);
      }
    }
  }

  _up(e) {
    this.drag = null;
  }

  _wheel(e) {
    e.preventDefault();
    this.opts.onZoom(e.deltaY * 0.004);
  }

  // ---- 双指触摸（缩放 + 轨道） ----
  _touchStart(e) {
    if (e.touches.length === 2) {
      this.drag = null;
      const [a, b] = e.touches;
      this.pinch = {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      };
    }
  }

  _touchMove(e) {
    if (e.touches.length === 2 && this.pinch) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this.opts.onZoom((this.pinch.d - d) * 0.02);
      this.pinch.d = d;
    }
  }

  _touchEnd(e) {
    if (e.touches.length < 2) this.pinch = null;
  }

  /**
   * 核心：拖拽方向 → 转动指令。
   * 命中面的法向 n（世界系），屏幕位移 (dx, dy)。
   * 把位移投影到命中面的两个切向轴上，取分量大的方向，
   * 得到「绕哪根轴转」；再由命中 cubelet 在该轴上的坐标选出
   * 外层（±1）或中层（0 = M/E/S），最后按运动学方向定顺/逆时针。
   */
  _resolveDragMove(hit, dx, dy) {
    const n = hit.normal;
    const absN = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const face = hit.face;

    // 屏幕位移 → 世界方向（用相机右/上向量）
    const cam = this.scene.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const world = right.clone().multiplyScalar(dx).add(up.clone().multiplyScalar(-dy));
    // world 是拖拽的世界空间方向

    // 面的两个切向轴（世界系单位向量）
    const tangents = [];
    if (absN[1] > 0.9) { tangents.push(['x', new THREE.Vector3(1,0,0)]); tangents.push(['z', new THREE.Vector3(0,0,1)]); }
    else if (absN[0] > 0.9) { tangents.push(['z', new THREE.Vector3(0,0,1)]); tangents.push(['y', new THREE.Vector3(0,1,0)]); }
    else { tangents.push(['x', new THREE.Vector3(1,0,0)]); tangents.push(['y', new THREE.Vector3(0,1,0)]); }

    // 取投影分量最大的切向 → 旋转轴（"层"沿该轴堆叠）
    let best = null, bestComp = 0;
    for (const [axisName, axisVec] of tangents) {
      const comp = world.dot(axisVec);
      if (Math.abs(comp) > Math.abs(bestComp)) { bestComp = comp; best = axisName; }
    }
    if (!best) return null;

    // 命中 cubelet 在旋转轴上的层坐标（-1/0/+1）
    const wp = new THREE.Vector3();
    hit.cubelet.getWorldPosition(wp);
    const layerVal = Math.round(wp[best] / 1.06);   // STEP≈1.06

    // 轴 + 层坐标 → 转动面名（含中层 M/E/S）
    // M 同 L 方向、E 同 D 方向、S 同 F 方向（标准记号）
    const AXIS_LAYERS = {
      // 绕 x 轴的层（拖拽沿 x → 层沿 x 堆叠？不——best 是拖拽的切向轴，
      // 旋转轴垂直于拖拽方向且在命中面内…… 见下方 ROT_AXIS 推导）
      x: { 1: 'R', 0: 'M', '-1': 'L' },
      y: { 1: 'U', 0: 'E', '-1': 'D' },
      z: { 1: 'F', 0: 'S', '-1': 'B' },
    };
    // 修正：拖拽沿切向轴 best 时，层绕「与 best 垂直的另一个切向轴」旋转。
    // 命中面的法向 n；两个切向 t1=best, t2=另一轴。
    // 被拖动的是包含命中点的「沿 t2 堆叠的层」（层坐标取 wp[t2 轴]），
    // 绕轴 = t2。例：U 面沿 x 拖 → 转动层沿 z 堆叠（F/S/B），绕 z 轴。
    // 重新计算：
    const otherAxis = tangents.find(([name]) => name !== best)[0];
    const rotAxis = otherAxis;
    const layerOnRot = Math.round(wp[rotAxis] / 1.06);
    const faceName = AXIS_LAYERS[rotAxis][String(layerOnRot)];
    if (!faceName) return null;

    // 运动学方向：转动面 f（法向 nf），顺时针（从 f 外侧看）时
    // 命中点 p 的运动速度 v = p × nf；逆时针 v = nf × p。
    // 取与拖拽方向 world 点积更大的方向。
    const FACE_N = {
      U: new THREE.Vector3(0,1,0), D: new THREE.Vector3(0,-1,0),
      F: new THREE.Vector3(0,0,1), B: new THREE.Vector3(0,0,-1),
      R: new THREE.Vector3(1,0,0), L: new THREE.Vector3(-1,0,0),
      // 中层法向取"同方向面"（M 同 L、E 同 D、S 同 F）
      M: new THREE.Vector3(-1,0,0), E: new THREE.Vector3(0,-1,0), S: new THREE.Vector3(0,0,1),
    };
    const nf = FACE_N[faceName];
    const p = hit.point.clone();
    const vCW = p.clone().cross(nf);
    const vCCW = nf.clone().cross(p);
    const sCW = vCW.dot(world);
    const sCCW = vCCW.dot(world);
    if (sCW <= 0 && sCCW <= 0) return null;
    return sCW >= sCCW ? faceName : faceName + "'";
  }
}
