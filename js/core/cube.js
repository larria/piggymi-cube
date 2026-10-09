/**
 * cube.js — 三阶魔方核心状态模型
 *
 * 表示法：54 张贴纸，按面展开为一维数组。
 * 索引约定（facelet 编号，与 Kociemba 标准一致）：
 *   U:  0-8    R:  9-17   F: 18-26   D: 27-35   L: 36-44   B: 45-53
 *
 * 每个面内部编号（从左上角、行优先）：
 *    0 1 2
 *    3 4 5
 *    6 7 8
 *
 * 颜色用面字母 U/R/F/D/L/B 表示（即"贴纸当前显示的颜色中心属于哪个面"），
 * 初始状态每个面的 9 张贴纸都等于该面的中心色。
 */

// 面在 54 数组中的起始偏移
export const FACE_OFFSET = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

const { U, R, F, D, L, B } = FACE_OFFSET;

/**
 * 每个基本转动的贴纸循环映射。
 * cycle 列出若干"环"，每环内贴纸沿箭头方向循环移动一格：
 * 即 cycle 环 [a,b,c,d] 表示 旧[a]→新[b]、旧[b]→新[c]、旧[c]→新[d]、旧[d]→新[a]。
 * （顺时针转动，观察者正对该面。由 3D 坐标旋转推导并经群论测试验证。）
 */
const MOVE_CYCLES = {
  U: [
    [U+0, U+2, U+8, U+6],  [U+1, U+5, U+7, U+3],           // U 面自旋
    [F+0, L+0, B+0, R+0],  [F+1, L+1, B+1, R+1],  [F+2, L+2, B+2, R+2],  // 顶层环
  ],
  D: [
    [D+0, D+2, D+8, D+6],  [D+1, D+5, D+7, D+3],           // D 面自旋
    [F+6, R+6, B+6, L+6],  [F+7, R+7, B+7, L+7],  [F+8, R+8, B+8, L+8],  // 底层环
  ],
  R: [
    [U+2, B+6, D+2, F+2],  [U+5, B+3, D+5, F+5],  [U+8, B+0, D+8, F+8],  // 右层环
    [R+0, R+2, R+8, R+6],  [R+1, R+5, R+7, R+3],           // R 面自旋
  ],
  L: [
    [U+0, F+0, D+0, B+8],  [U+3, F+3, D+3, B+5],  [U+6, F+6, D+6, B+2],  // 左层环
    [L+0, L+2, L+8, L+6],  [L+1, L+5, L+7, L+3],           // L 面自旋
  ],
  F: [
    [U+6, R+0, D+2, L+8],  [U+7, R+3, D+1, L+5],  [U+8, R+6, D+0, L+2],  // 前层环
    [F+0, F+2, F+8, F+6],  [F+1, F+5, F+7, F+3],           // F 面自旋
  ],
  B: [
    [U+0, L+6, D+8, R+2],  [U+1, L+3, D+7, R+5],  [U+2, L+0, D+6, R+8],  // 后层环
    [B+0, B+2, B+8, B+6],  [B+1, B+5, B+7, B+3],           // B 面自旋
  ],
};

const BASIC = 'UDLRFB';

/**
 * 中层转动（Kociemba 扩展记号）：M 同 L 方向、E 同 D 方向、S 同 F 方向。
 * 中心贴纸也会随之移动（用于教学展示；求解器中 M2 = R2 L2 x2 等价关系的中心差异被忽略，
 * 因为中心相对位置不变，isSolved 仍以每面中心为准）。
 */
const SLICE_CYCLES = {
  M: [
    [U+1, F+1, D+1, B+7],  [U+4, F+4, D+4, B+4],  [U+7, F+7, D+7, B+1],
  ],
  E: [
    [F+3, R+3, B+3, L+3],  [F+4, R+4, B+4, L+4],  [F+5, R+5, B+5, L+5],
  ],
  S: [
    [U+3, R+1, D+5, L+7],  [U+4, R+4, D+4, L+4],  [U+5, R+7, D+3, L+1],
  ],
};

/** 解析单步指令 → { face, amount: 1|2|3 }，非法返回 null */
export function parseMove(tok) {
  const m = /^([UDLRFBMES])(|'|2|2')$/.exec(tok);
  if (!m) return null;
  const face = m[1];
  const suffix = m[2].replace("'", '');
  return { face, amount: suffix === '2' ? 2 : (m[2] === "'" ? 3 : 1) };
}

/** amount → 指令后缀 */
export function suffixOf(amount) {
  return amount === 2 ? '2' : amount === 3 ? "'" : '';
}

export class Cube {
  constructor() { this.reset(); }

  /** 还原到初始状态 */
  reset() {
    this.stickers = new Array(54);
    for (const f of FACES) {
      for (let i = 0; i < 9; i++) this.stickers[FACE_OFFSET[f] + i] = f;
    }
    return this;
  }

  /** 深拷贝 */
  clone() {
    const c = new Cube();
    c.stickers = this.stickers.slice();
    return c;
  }

  /** 应用一个转动环组（内部工具） */
  _applyCycles(cycles, amount) {
    for (let k = 0; k < amount; k++) {
      for (const ring of cycles) {
        const tmp = this.stickers[ring[ring.length - 1]];
        for (let i = ring.length - 1; i > 0; i--) {
          this.stickers[ring[i]] = this.stickers[ring[i - 1]];
        }
        this.stickers[ring[0]] = tmp;
      }
    }
  }

  /** 执行单步转动，如 'R', "U'", 'F2'（支持 UDLRFB 及 M/E/S 中层） */
  move(tok) {
    const mv = parseMove(tok);
    if (!mv) throw new Error(`非法指令: ${tok}`);
    const cycles = MOVE_CYCLES[mv.face] || SLICE_CYCLES[mv.face];
    this._applyCycles(cycles, mv.amount);
    return this;
  }

  /**
   * 高性能单步执行（搜索用）：跳过 parseMove 的正则解析，
   * face 必须是合法面字母，amount ∈ {1,2,3}。
   */
  moveFA(face, amount) {
    const cycles = MOVE_CYCLES[face] || SLICE_CYCLES[face];
    if (amount === 1) {
      for (const ring of cycles) {
        const tmp = this.stickers[ring[ring.length - 1]];
        for (let i = ring.length - 1; i > 0; i--) {
          this.stickers[ring[i]] = this.stickers[ring[i - 1]];
        }
        this.stickers[ring[0]] = tmp;
      }
    } else {
      this._applyCycles(cycles, amount);
    }
    return this;
  }

  /** 执行公式字符串（空格分隔），忽略多余空白 */
  applyAlg(alg) {
    for (const tok of alg.trim().split(/\s+/)) {
      if (tok) this.move(tok);
    }
    return this;
  }

  /** 单步的逆指令，如 R → R'，F2 → F2 */
  static inverseMove(tok) {
    const mv = parseMove(tok);
    if (!mv) throw new Error(`非法指令: ${tok}`);
    if (mv.amount === 2) return tok;
    return mv.face + (mv.amount === 1 ? "'" : '');
  }

  /** 整条公式的逆 */
  static inverseAlg(alg) {
    return alg.trim().split(/\s+/).filter(Boolean).reverse().map(Cube.inverseMove).join(' ');
  }

  // ---------- 查询 ----------

  /** 面中心颜色（面本身不会变，用于校验） */
  centerOf(face) { return this.stickers[FACE_OFFSET[face] + 4]; }

  /** 某个面是否纯色 */
  isFaceSolved(face) {
    const c = this.stickers[FACE_OFFSET[face] + 4];
    for (let i = 0; i < 9; i++) {
      if (this.stickers[FACE_OFFSET[face] + i] !== c) return false;
    }
    return true;
  }

  /** 是否完全还原 */
  isSolved() {
    return FACES.every(f => this.isFaceSolved(f));
  }

  /** 导出 54 字符串（URFDLB 顺序） */
  toString() { return this.stickers.join(''); }

  /** 从 54 字符串导入 */
  fromString(s) {
    if (!/^[URFDLB]{54}$/.test(s)) throw new Error('状态串必须为 54 个 URFDLB 字符');
    this.stickers = s.split('');
    return this;
  }

  /**
   * 获取某个贴纸位置的当前颜色。
   * @param face 面字母  @param idx 0-8 面内位置
   */
  stickerAt(face, idx) { return this.stickers[FACE_OFFSET[face] + idx]; }

  /** 相等比较 */
  equals(other) { return this.stickers.join('') === other.stickers.join(''); }
}

/**
 * 坐标帮助：把 (face, idx) 转为方便几何判断的行列。
 * faceView 定义每个面从"标准视角"看的行/列：
 *   U: 从上往下看（B 是上），R: 从右看（U 是上），F: 从前看（U 是上），
 *   D: 从下看（F 是上），L: 从左看（U 是上），B: 从后看（U 是上）。
 */
export function rowCol(face, idx) {
  return { row: Math.floor(idx / 3), col: idx % 3 };
}

/**
 * 生成随机打乱公式（20 步，避免同面连续、避免三连同轴）
 */
export function randomScramble(len = 20) {
  const opposite = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };
  const alg = [];
  let prev = '', prev2 = '';
  while (alg.length < len) {
    const f = BASIC[Math.floor(Math.random() * 6)];
    if (f === prev) continue;
    if (prev2 && f === prev2 && opposite[f] === prev) continue; // R L R 型
    const suf = ['', "'", '2'][Math.floor(Math.random() * 3)];
    alg.push(f + suf);
    prev2 = prev; prev = f;
  }
  return alg.join(' ');
}

// ---------------------------------------------------------------
// 整体旋转（用于 M/E/S 中层转动后的中心归一化）
// ---------------------------------------------------------------

/** 24 个整体旋转的 facelet 置换表（perm[dst] = src），由 3D 坐标旋转生成 */
export const CUBE_ROTATIONS = [
  { name: 'e', perm: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53] },
  { name: 'x', perm: [53,52,51,50,49,48,47,46,45,11,14,17,10,13,16,9,12,15,0,1,2,3,4,5,6,7,8,18,19,20,21,22,23,24,25,26,42,39,36,43,40,37,44,41,38,35,34,33,32,31,30,29,28,27] },
  { name: 'y', perm: [2,5,8,1,4,7,0,3,6,18,19,20,21,22,23,24,25,26,36,37,38,39,40,41,42,43,44,33,30,27,34,31,28,35,32,29,45,46,47,48,49,50,51,52,53,9,10,11,12,13,14,15,16,17] },
  { name: 'z', perm: [11,14,17,10,13,16,9,12,15,29,32,35,28,31,34,27,30,33,20,23,26,19,22,25,18,21,24,38,41,44,37,40,43,36,39,42,2,5,8,1,4,7,0,3,6,51,48,45,52,49,46,53,50,47] },
  { name: 'xx', perm: [27,28,29,30,31,32,33,34,35,17,16,15,14,13,12,11,10,9,53,52,51,50,49,48,47,46,45,0,1,2,3,4,5,6,7,8,44,43,42,41,40,39,38,37,36,26,25,24,23,22,21,20,19,18] },
  { name: 'xy', perm: [51,48,45,52,49,46,53,50,47,0,1,2,3,4,5,6,7,8,42,39,36,43,40,37,44,41,38,24,21,18,25,22,19,26,23,20,35,34,33,32,31,30,29,28,27,11,14,17,10,13,16,9,12,15] },
  { name: 'xz', perm: [17,16,15,14,13,12,11,10,9,20,23,26,19,22,25,18,21,24,2,5,8,1,4,7,0,3,6,36,37,38,39,40,41,42,43,44,51,48,45,52,49,46,53,50,47,29,32,35,28,31,34,27,30,33] },
  { name: 'yy', perm: [8,7,6,5,4,3,2,1,0,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,35,34,33,32,31,30,29,28,27,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
  { name: 'yz', perm: [20,23,26,19,22,25,18,21,24,27,28,29,30,31,32,33,34,35,38,41,44,37,40,43,36,39,42,47,50,53,46,49,52,45,48,51,8,7,6,5,4,3,2,1,0,15,12,9,16,13,10,17,14,11] },
  { name: 'zx', perm: [47,50,53,46,49,52,45,48,51,35,34,33,32,31,30,29,28,27,11,14,17,10,13,16,9,12,15,20,23,26,19,22,25,18,21,24,0,1,2,3,4,5,6,7,8,42,39,36,43,40,37,44,41,38] },
  { name: 'zz', perm: [35,34,33,32,31,30,29,28,27,44,43,42,41,40,39,38,37,36,26,25,24,23,22,21,20,19,18,8,7,6,5,4,3,2,1,0,17,16,15,14,13,12,11,10,9,53,52,51,50,49,48,47,46,45] },
  { name: 'xxx', perm: [18,19,20,21,22,23,24,25,26,15,12,9,16,13,10,17,14,11,27,28,29,30,31,32,33,34,35,53,52,51,50,49,48,47,46,45,38,41,44,37,40,43,36,39,42,8,7,6,5,4,3,2,1,0] },
  { name: 'xxy', perm: [29,32,35,28,31,34,27,30,33,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36,6,3,0,7,4,1,8,5,2,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9] },
  { name: 'xxz', perm: [15,12,9,16,13,10,17,14,11,2,5,8,1,4,7,0,3,6,51,48,45,52,49,46,53,50,47,42,39,36,43,40,37,44,41,38,29,32,35,28,31,34,27,30,33,20,23,26,19,22,25,18,21,24] },
  { name: 'xyy', perm: [45,46,47,48,49,50,51,52,53,42,39,36,43,40,37,44,41,38,35,34,33,32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,11,14,17,10,13,16,9,12,15,0,1,2,3,4,5,6,7,8] },
  { name: 'xzx', perm: [33,30,27,34,31,28,35,32,29,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,2,5,8,1,4,7,0,3,6,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36] },
  { name: 'xzz', perm: [26,25,24,23,22,21,20,19,18,38,41,44,37,40,43,36,39,42,8,7,6,5,4,3,2,1,0,45,46,47,48,49,50,51,52,53,15,12,9,16,13,10,17,14,11,27,28,29,30,31,32,33,34,35] },
  { name: 'yyy', perm: [6,3,0,7,4,1,8,5,2,45,46,47,48,49,50,51,52,53,9,10,11,12,13,14,15,16,17,29,32,35,28,31,34,27,30,33,18,19,20,21,22,23,24,25,26,36,37,38,39,40,41,42,43,44] },
  { name: 'yyz', perm: [38,41,44,37,40,43,36,39,42,33,30,27,34,31,28,35,32,29,47,50,53,46,49,52,45,48,51,11,14,17,10,13,16,9,12,15,6,3,0,7,4,1,8,5,2,24,21,18,25,22,19,26,23,20] },
  { name: 'zzz', perm: [42,39,36,43,40,37,44,41,38,6,3,0,7,4,1,8,5,2,24,21,18,25,22,19,26,23,20,15,12,9,16,13,10,17,14,11,33,30,27,34,31,28,35,32,29,47,50,53,46,49,52,45,48,51] },
  { name: 'xxxz', perm: [9,10,11,12,13,14,15,16,17,51,48,45,52,49,46,53,50,47,29,32,35,28,31,34,27,30,33,44,43,42,41,40,39,38,37,36,20,23,26,19,22,25,18,21,24,2,5,8,1,4,7,0,3,6] },
  { name: 'xxzx', perm: [24,21,18,25,22,19,26,23,20,8,7,6,5,4,3,2,1,0,15,12,9,16,13,10,17,14,11,51,48,45,52,49,46,53,50,47,27,28,29,30,31,32,33,34,35,38,41,44,37,40,43,36,39,42] },
  { name: 'xyyz', perm: [36,37,38,39,40,41,42,43,44,24,21,18,25,22,19,26,23,20,33,30,27,34,31,28,35,32,29,17,16,15,14,13,12,11,10,9,47,50,53,46,49,52,45,48,51,6,3,0,7,4,1,8,5,2] },
  { name: 'xzzz', perm: [44,43,42,41,40,39,38,37,36,47,50,53,46,49,52,45,48,51,6,3,0,7,4,1,8,5,2,9,10,11,12,13,14,15,16,17,24,21,18,25,22,19,26,23,20,33,30,27,34,31,28,35,32,29] },
];

/** 应用整体旋转置换（perm[dst] = src）到贴纸数组 */
function applyPerm(stickers, perm) {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[i] = stickers[perm[i]];
  return out;
}

/** 逆转置换 */
function invertPerm(perm) {
  const inv = new Array(54);
  for (let i = 0; i < 54; i++) inv[perm[i]] = i;
  return inv;
}

Cube.prototype._centers = function () {
  return {
    U: this.stickers[FACE_OFFSET.U + 4], R: this.stickers[FACE_OFFSET.R + 4],
    F: this.stickers[FACE_OFFSET.F + 4], D: this.stickers[FACE_OFFSET.D + 4],
    L: this.stickers[FACE_OFFSET.L + 4], B: this.stickers[FACE_OFFSET.B + 4],
  };
};

/**
 * 归一化朝向：若中心块被 M/E/S 移位，找到一个整体旋转使中心回到标准位，
 * 返回 { cube: 归一化后的新 Cube, faceMap }，
 * faceMap: 标准空间面名 → 真实空间面名（公式转换用）。
 * 若中心已在标准位，返回 { cube: this, faceMap: 恒等 }。
 */
Cube.prototype.normalizeOrientation = function () {
  const centers = this._centers();
  const isStandard = centers.U === 'U' && centers.R === 'R' && centers.F === 'F' &&
    centers.D === 'D' && centers.L === 'L' && centers.B === 'B';
  if (isStandard) {
    const id = { U:'U', R:'R', F:'F', D:'D', L:'L', B:'B' };
    return { cube: this, faceMap: id, rotated: false };
  }
  // 找到使中心归位的旋转：应用 perm 后中心正确
  for (const rot of CUBE_ROTATIONS) {
    const s2 = applyPerm(this.stickers, rot.perm);
    if (s2[FACE_OFFSET.U+4] === 'U' && s2[FACE_OFFSET.R+4] === 'R' &&
        s2[FACE_OFFSET.F+4] === 'F' && s2[FACE_OFFSET.D+4] === 'D' &&
        s2[FACE_OFFSET.L+4] === 'L' && s2[FACE_OFFSET.B+4] === 'B') {
      // 归一化成功。faceMap：标准空间面 f 的转动 == 真实空间的哪个面？
      // 旋转 perm 把真实态映到标准态。标准态中 f 面的转动，
      // 对应真实态中"被旋转映到 f 的那个面"的转动：
      // 真实面 h 满足 perm 把 h 面位置映到 f 面位置 → faceMap[f] = h。
      // 面位置映射：h 面的贴纸位 OFF[h]+4 经 perm 后落在 OFF[f]+4 ⟺ perm[OFF[f]+4] = OFF[h]+4。
      const faceMap = {};
      for (const f of ['U','R','F','D','L','B']) {
        const srcCenter = rot.perm[FACE_OFFSET[f] + 4];
        const h = Object.keys(FACE_OFFSET).find(k => FACE_OFFSET[k] + 4 === srcCenter);
        faceMap[f] = h;
      }
      const c = new Cube();
      c.stickers = s2;
      return { cube: c, faceMap, rotated: true };
    }
  }
  return null;   // 不可能（24 旋转全覆盖）
};

