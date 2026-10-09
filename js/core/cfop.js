/**
 * cfop.js — CFOP 分层求解器（教学版，工程可靠实现）
 *
 * 架构（为避免 BFS 状态爆炸，各阶段采用不同策略）：
 *   Cross —— 逐棱求解，每棱 BFS（受限深度，块引导剪枝）
 *   F2L   —— 逐槽求解：标准 41 case 公式表（按 U 层 3×3 槽位签名索引）+ 通用兜底搜索
 *   OLL   —— 2-look OLL（顶面十字 4 态 + 角朝向 7 态），标准公式
 *   PLL   —— 2-look PLL（角排列 3 态 + 棱排列 4 态），标准公式
 *
 * 颜色约定：D=白, U=黄, F=绿, B=蓝, R=红, L=橙（cube.js 面字母即颜色）。
 */

import { Cube, FACE_OFFSET as FO, suffixOf } from './cube.js';

const { U, R, F, D, L, B } = FO;

// ---------------------------------------------------------------
// 块位置表
// ---------------------------------------------------------------

const EDGES = {
  UF: [U+7, F+1], UR: [U+5, R+1], UB: [U+1, B+1], UL: [U+3, L+1],
  DF: [D+1, F+7], DR: [D+5, R+7], DB: [D+7, B+7], DL: [D+3, L+7],
  FR: [F+5, R+3], FL: [F+3, L+5], BR: [B+3, R+5], BL: [B+5, L+3],
};

// 注意：每个块名的 idxs 顺序与名字字母序一致（如 DFR → [D位, F位, R位]），
// 这样 slotSolved 可直接用 cube.stickers[idx] === name[k] 比较。
const CORNERS = {
  UFR: [U+8, F+2, R+0], URB: [U+2, R+2, B+0], UBL: [U+0, B+2, L+0], ULF: [U+6, L+2, F+0],
  DFR: [D+2, F+8, R+6], DRB: [D+8, R+8, B+6], DBL: [D+6, B+8, L+6], DLF: [D+0, L+8, F+6],
};

const ALL_MOVES = [];
for (const f of 'UDLRFB') for (const a of [1, 2, 3]) ALL_MOVES.push(f + suffixOf(a));

// ---------------------------------------------------------------
// 通用受限 BFS（带同面剪枝；上限可控；高性能 apply-undo 模式）
// ---------------------------------------------------------------

/** 单步指令 → [face, amount]；预解析避免循环内正则 */
function parseTok(tok) {
  const f = tok[0];
  const s = tok.slice(1);
  return [f, s === '2' ? 2 : s === "'" ? 3 : 1];
}

/** 逆 amount：1↔3, 2↔2 */
const INV_AMT = [0, 3, 2, 1];

function bfs(cube, isGoal, allowedMoves, maxDepth, maxNodes = 300000) {
  if (isGoal(cube)) return [];
  const opposite = { U:'D', D:'U', L:'R', R:'L', F:'B', B:'F' };
  const parsed = allowedMoves.map(parseTok);
  let frontier = [{ state: cube, path: [], prev: '', prev2: '' }]; // 不 clone 起点（只读）
  const seen = new Set([cube.toString()]);
  let nodes = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const [f, amt] of parsed) {
        if (f === node.prev) continue;
        if (node.prev && f === opposite[node.prev] && node.prev2 === f) continue;
        const c = node.state.clone();
        c.moveFA(f, amt);
        if (++nodes > maxNodes) return null;
        const key = c.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        const path = [...node.path, f + (amt === 2 ? '2' : amt === 3 ? "'" : '')];
        if (isGoal(c)) return path;
        next.push({ state: c, path, prev: f, prev2: node.prev });
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------
// 阶段 1：Cross（白色十字）
// ---------------------------------------------------------------

function crossSolved(cube) {
  for (const name of ['DF', 'DR', 'DB', 'DL']) {
    const [a, b] = EDGES[name];
    if (cube.stickers[a] !== name[0] || cube.stickers[b] !== name[1]) return false;
  }
  return true;
}

function solveCross(cube) {
  const work = cube.clone();
  const alg = [];
  const done = [];
  for (const t of ['DF', 'DR', 'DB', 'DL']) {
    const goal = (c) => {
      for (const name of done) {
        const [a, b] = EDGES[name];
        if (c.stickers[a] !== name[0] || c.stickers[b] !== name[1]) return false;
      }
      const [a, b] = EDGES[t];
      return c.stickers[a] === t[0] && c.stickers[b] === t[1];
    };
    const path = bfs(work, goal, ALL_MOVES, 7);
    if (!path) return null;
    for (const mv of path) work.move(mv);
    alg.push(...path);
    done.push(t);
  }
  return { alg, cube: work };
}

// ---------------------------------------------------------------
// 阶段 2：F2L
// ---------------------------------------------------------------

const F2L_SLOTS = [
  { corner: 'DFR', edge: 'FR', side: 'R' },
  { corner: 'DRB', edge: 'BR', side: 'B' },
  { corner: 'DBL', edge: 'BL', side: 'L' },
  { corner: 'DLF', edge: 'FL', side: 'F' },
];

function slotSolved(cube, slot) {
  const [ca, cb, cc] = CORNERS[slot.corner];
  if (cube.stickers[ca] !== slot.corner[0] || cube.stickers[cb] !== slot.corner[1] || cube.stickers[cc] !== slot.corner[2]) return false;
  const [ea, eb] = EDGES[slot.edge];
  if (cube.stickers[ea] !== slot.edge[0] || cube.stickers[eb] !== slot.edge[1]) return false;
  return true;
}

function f2lSolved(cube) {
  if (!crossSolved(cube)) return false;
  return F2L_SLOTS.every(s => slotSolved(cube, s));
}

/**
 * F2L 槽求解表（反向投影 BFS 预计算）。
 *
 * 每个槽建两张"两面小表"：{side, U} 族与 {front, U} 族。
 * 两面族的转动不碰对侧邻槽（如 DFR 用 {R,U} 时不碰 DLF），
 * 表解天然不破坏对侧已解槽；同侧邻槽（共享 side 面的槽）仍需运行时验证。
 */
const F2L_TABLES = new Map();   // "side:faces" → Map(projKey → moves[])

function invMoveOf(mv) {
  const f = mv[0], s = mv.slice(1);
  if (s === '2') return mv;
  return f + (s === "'" ? '' : "'");
}

/** 块位姿签名：找到颜色集合匹配的位置，返回 位置名:贴纸串 */
function blockKey(c, positions, colors) {
  const t = [...colors].sort().join('');
  for (const [name, idxs] of Object.entries(positions)) {
    if (idxs.map(i => c.stickers[i]).sort().join('') === t) {
      return name + ':' + idxs.map(i => c.stickers[i]).join('');
    }
  }
  return '??';
}

/** 槽的面族信息 */
function slotFaces(slot) {
  const sideFace = slot.side;
  const frontFace = { R: 'F', B: 'R', L: 'B', F: 'L' }[sideFace];
  // 各面转动触碰的十字棱
  const crossOf = { R: 'DR', B: 'DB', L: 'DL', F: 'DF' };
  return { sideFace, frontFace, crossOf };
}

function buildF2LTable(slot, faces) {
  const moves = [];
  for (const f of faces) {
    for (const a of [1, 2, 3]) moves.push(f + suffixOf(a));
  }
  const { crossOf } = slotFaces(slot);
  const trackedCross = [...new Set(faces.map(f => crossOf[f]).filter(Boolean))];

  const cornerName = slot.corner;
  const edgeName = slot.edge;
  const projKey = (c) => {
    const parts = [
      blockKey(c, CORNERS, cornerName),
      blockKey(c, EDGES, edgeName),
    ];
    for (const n of trackedCross) parts.push(blockKey(c, EDGES, n));
    return parts.join('|');
  };

  const table = new Map();
  const goal = new Cube();
  table.set(projKey(goal), []);
  let frontier = [{ s: goal, path: [] }];
  for (let d = 1; d <= 11; d++) {
    const next = [];
    for (const n of frontier) {
      for (const mv of moves) {
        const c = n.s.clone();
        c.move(mv);
        const k = projKey(c);
        if (table.has(k)) continue;
        table.set(k, [invMoveOf(mv), ...n.path.slice().reverse().map(invMoveOf)]);
        next.push({ s: c, path: [...n.path, mv] });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return table;
}

function getF2LTable(slot, faces) {
  const key = slot.side + ':' + faces.join('');
  if (!F2L_TABLES.has(key)) {
    F2L_TABLES.set(key, buildF2LTable(slot, faces));
  }
  return F2L_TABLES.get(key);
}

/** 求某槽在指定面族下的查表解 */
function lookupF2L(work, slot, faces) {
  const table = getF2LTable(slot, faces);
  const { crossOf } = slotFaces(slot);
  const trackedCross = [...new Set(faces.map(f => crossOf[f]).filter(Boolean))];
  const parts = [
    blockKey(work, CORNERS, slot.corner),
    blockKey(work, EDGES, slot.edge),
  ];
  for (const n of trackedCross) parts.push(blockKey(work, EDGES, n));
  return table.get(parts.join('|'));
}

/** 块是否在 U 层，或已正确归位（在家但朝向错 = 需要取出重插） */
function blockPosOK(c, positions, colors, slotName) {
  const t = [...colors].sort().join('');
  for (const [name, idxs] of Object.entries(positions)) {
    if (idxs.map(i => c.stickers[i]).sort().join('') === t) {
      if (name[0] === 'U') return true;
      if (name !== slotName) return false;
      return idxs.every((idx, k) => c.stickers[idx] === slotName[k]);
    }
  }
  return false;
}

/** 取块常用短序列（按几何覆盖各面取出动作） */
const TAKE_SEQS = [
  "F' U' F", "F U F'", "F' U F", "F U' F'",
  "R U R'", "R' U' R", "R U' R'", "R' U R",
  "L U L'", "L' U' L", "L U' L'", "L' U L",
  "B U B'", "B' U' B", "B U' B'", "B' U B",
  "F' U2 F", "F U2 F'", "R U2 R'", "R' U2 R",
  "L U2 L'", "L' U2 L", "B U2 B'", "B' U2 B",
  "U F' U' F", "U F U F'", "U R U R'", "U R' U' R",
  "U L U L'", "U L' U' L", "U B U B'", "U B' U' B",
  "U' F' U F", "U' F U' F'", "U' R U' R'", "U' R' U R",
  "U' L U' L'", "U' L' U L", "U' B U' B'", "U' B' U B",
  "F2", "R2", "L2", "B2",
];

/** 取块：先短序列（保护约束），再投影 BFS（保护约束），最后放宽到只保十字。
 *  extraOK：附加约束（如取棱时保持角块 in-zone），可为 null。 */
function setupF2LBlock(work, positions, colors, slotName, keep, extraOK = null) {
  const extras = (c) => !extraOK || extraOK(c);
  const goalKeep = (c) => keep(c) && extras(c) && blockPosOK(c, positions, colors, slotName);
  const goalCross = (c) => crossSolved(c) && extras(c) && blockPosOK(c, positions, colors, slotName);

  // 1) 短序列
  for (const seq of TAKE_SEQS) {
    const t = work.clone();
    for (const mv of seq.split(' ')) t.move(mv);
    if (goalKeep(t)) return seq.split(' ');
  }
  // 2) 投影 BFS（保护一切）
  const projKey = (c) => {
    const parts = [blockKey(c, positions, colors)];
    for (const n of ['DF', 'DR', 'DB', 'DL']) parts.push(blockKey(c, EDGES, n));
    return parts.join('|');
  };
  let p = projBfs(work, goalKeep, ALL_MOVES, 6, projKey, 2500000);
  if (p) return p;
  // 3) 短序列（只保十字）
  for (const seq of TAKE_SEQS) {
    const t = work.clone();
    for (const mv of seq.split(' ')) t.move(mv);
    if (goalCross(t)) return seq.split(' ');
  }
  // 4) BFS（只保十字）
  return bfs(work, goalCross, ALL_MOVES, 5, 2000000);
}

/**
 * F2L 单槽求解（v7 稳健版）：
 *  a) setup：块不在（U 层 ∪ 正确归位）时取出
 *  b) 面族选择：优先 {side,U} / {front,U} 两面表（不碰对侧邻槽），
 *     查到的解运行时验证不破坏已解槽；大表 {side,front,U} 兜底；
 *  c) 全部失败时投影 BFS（保护约束）
 */
function solveF2LSlot(work, slot, doneSlots) {
  const keepOK = (c) => {
    if (!crossSolved(c)) return false;
    for (const s of doneSlots) if (!slotSolved(c, s)) return false;
    return true;
  };
  const alg = [];
  const { sideFace, frontFace } = slotFaces(slot);

  // ---- a) setup 取块（取棱时保持角块 in-zone，反之亦然）----
  if (!blockPosOK(work, CORNERS, slot.corner, slot.corner)) {
    const p = setupF2LBlock(work, CORNERS, slot.corner, slot.corner, keepOK);
    if (!p) return null;
    for (const mv of p) work.move(mv);
    alg.push(...p);
  }
  if (!blockPosOK(work, EDGES, slot.edge, slot.edge)) {
    const keepCorner = (c) => blockPosOK(c, CORNERS, slot.corner, slot.corner);
    const p = setupF2LBlock(work, EDGES, slot.edge, slot.edge, keepOK, keepCorner);
    if (!p) return null;
    for (const mv of p) work.move(mv);
    alg.push(...p);
  }

  // ---- b) 面族表查找（先两面，后三面；每个族尝试 4 个 AUF 预转变体）----
  const families = [
    [sideFace, 'U'],
    [frontFace, 'U'],
    [sideFace, frontFace, 'U'],
  ];
  const aufs = ['', 'U', 'U2', "U'"];
  for (const faces of families) {
    for (const pre of aufs) {
      // 预转后查表
      const c = work.clone();
      if (pre) c.move(pre);
      const sol = lookupF2L(c, slot, faces);
      if (!sol) continue;
      const c2 = c.clone();
      for (const mv of sol) c2.move(mv);
      if (keepOK(c2) && slotSolved(c2, slot)) {
        // 应用：pre + sol
        if (pre) work.move(pre);
        for (const mv of sol) work.move(mv);
        alg.push(...(pre ? [pre, ...sol] : sol));
        return alg;
      }
    }
  }

  // ---- c) 投影 BFS 兜底（保护约束）----
  const slotMoves = [];
  for (const f of [sideFace, frontFace, 'U']) {
    for (const a of [1, 2, 3]) slotMoves.push(f + suffixOf(a));
  }
  const slotGoal = (c) => keepOK(c) && slotSolved(c, slot);
  const fallbackProjKey = (c) => {
    const parts = [blockKey(c, CORNERS, slot.corner), blockKey(c, EDGES, slot.edge)];
    for (const n of ['DF', 'DR', 'DB', 'DL']) parts.push(blockKey(c, EDGES, n));
    for (const s of doneSlots) {
      parts.push(blockKey(c, CORNERS, s.corner));
      parts.push(blockKey(c, EDGES, s.edge));
    }
    return parts.join('|');
  };
  let path = projBfs(work, slotGoal, slotMoves, 12, fallbackProjKey, 2500000);
  if (!path) path = projBfs(work, slotGoal, ALL_MOVES, 8, fallbackProjKey, 2000000);
  if (!path) return null;
  for (const mv of path) work.move(mv);
  alg.push(...path);
  return alg;
}

/** 投影去重 BFS：seen 用投影签名 + apply-undo 模式（无 clone）+ parent 指针路径重建 */
function projBfs(cube, isGoal, allowedMoves, maxDepth, projKey, maxNodes = 1000000) {
  if (isGoal(cube)) return [];
  const opposite = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };
  const parsed = allowedMoves.map(parseTok);
  const startKey = projKey(cube);

  // 节点：{ state, prev, prev2, parent, moveTok }
  let frontier = [{ state: cube.clone(), prev: '', prev2: '', parent: null, moveTok: null }];
  const seen = new Map([[startKey, null]]);   // key → parent node（用于查重）
  let nodes = 0;
  let goalNode = null;

  for (let d = 1; d <= maxDepth && !goalNode; d++) {
    const next = [];
    for (const n of frontier) {
      for (const [f, amt] of parsed) {
        if (f === n.prev) continue;
        if (n.prev && f === opposite[n.prev] && n.prev2 === f) continue;
        // apply
        n.state.moveFA(f, amt);
        if (++nodes > maxNodes) { n.state.moveFA(f, INV_AMT[amt]); return null; }
        const tok = f + (amt === 2 ? '2' : amt === 3 ? "'" : '');
        const child = { state: n.state, prev: f, prev2: n.prev, parent: n, moveTok: tok };
        if (isGoal(n.state)) { goalNode = child; break; }
        const k = projKey(n.state);
        if (seen.has(k)) { n.state.moveFA(f, INV_AMT[amt]); continue; }
        seen.set(k, child);
        next.push(child);
        // undo —— 注意：child 复用了 state 引用，undo 会破坏 child！
        // 因此 child 需要自己的状态副本：
        //（此实现中我们让 child 持有当前 state，本节点继续尝试其它 move 时先 undo）
        // 处理：把 state 克隆给 child，再 undo 本节点。
        child.state = n.state.clone();
        n.state.moveFA(f, INV_AMT[amt]);
      }
      if (goalNode) break;
    }
    frontier = next;
    if (!frontier.length) break;
  }
  if (!goalNode) return null;
  // 重建路径
  const path = [];
  for (let n = goalNode; n && n.moveTok; n = n.parent) path.push(n.moveTok);
  return path.reverse();
}

function solveF2L(cube) {
  const work = cube.clone();
  const alg = [];
  const done = [];
  // 已解槽直接跳过（打乱后可能有槽天然解好）
  const remaining = [];
  for (const slot of F2L_SLOTS) {
    if (slotSolved(work, slot)) done.push(slot);
    else remaining.push(slot);
  }
  for (const slot of remaining) {
    const path = solveF2LSlot(work, slot, done);
    if (!path) return null;
    alg.push(...path);
    done.push(slot);
  }
  return { alg, cube: work };
}

// ---------------------------------------------------------------
// 阶段 3：OLL（原子公式 BFS）
// ---------------------------------------------------------------

function ollSolved(cube) {
  for (let i = 0; i < 9; i++) if (cube.stickers[U + i] !== 'U') return false;
  return true;
}

/** 展开 f/r 宽转动为基本+切片转动（f = F S, r = R M'） */
function expandWide(alg) {
  return alg
    .replace(/f'/g, "F' S'").replace(/\bf\b/g, 'F S')
    .replace(/r'/g, "R' M").replace(/\br\b/g, "R M'")
    .split(/\s+/).filter(Boolean);
}

/** OLL 原子公式库（2-look：十字 3 态 + 角 7 态 + 补充） */
const OLL_ATOMS = [
  "F R U R' U' F'",                    // 十字：线
  "F U R U' R' F'",                    // 十字：L（另一朝向）
  "f R U R' U' f'",                    // 十字：L
  "F R U R' U' F' f R U R' U' f'",    // 十字：点（两连）
  "R U R' U R U2 R'",                  // Sune
  "R U2 R' U' R U' R'",                // Anti-Sune
  "R2 D R' U2 R D' R' U2 R'",          // Headlights
  "r U R' U' r' F R F'",               // Chameleon
  "F' r U R' U' r' F R",               // Bowtie
  "R U2 R2 U' R2 U' R2 U2 R",          // Pi
  "R U R' U R U' R' U R U2 R'",        // H
  "R U2 R' U' R U R' U' R U' R'",     // 双 Sune
  "R U2 R2 F R F' U2 R' F R F'",       // OLL 补充
  "F R U R' U' R U R' U' F'",          // 十字补充
  "R U R' F R U R' U' F'",             // 十字补充 2
];

/** 生成原子 × AUF 的全部变体 */
function buildAtoms(algs) {
  const atoms = [];
  for (const alg of algs) {
    const seq = expandWide(alg);
    for (const pre of ['', 'U', 'U2', "U'"]) {
      atoms.push(pre ? [pre, ...seq] : seq);
    }
  }
  return atoms;
}

/**
 * OLL 求解：在"原子公式"空间 BFS（深度 ≤3）。
 * 每个原子 = 一条标准公式 + AUF 预转。状态用完整魔方去重。
 * 2-look OLL 理论最多 2 原子（十字 + 角），3 原子做保险。
 */
function solveOLL(cube) {
  if (ollSolved(cube)) return { alg: [], cube: cube.clone() };
  const atoms = buildAtoms(OLL_ATOMS);
  const seen = new Set([cube.toString()]);
  let frontier = [{ s: cube.clone(), atoms: [] }];
  for (let d = 1; d <= 3; d++) {
    const next = [];
    for (const n of frontier) {
      for (const atom of atoms) {
        const c = n.s.clone();
        for (const mv of atom) c.move(mv);
        const k = c.toString();
        if (seen.has(k)) continue;
        seen.add(k);
        const chain = [...n.atoms, atom];
        if (ollSolved(c)) {
          return { alg: chain.flat(), cube: c };
        }
        next.push({ s: c, atoms: chain });
      }
    }
    frontier = next;
    if (seen.size > 400000) return null;
  }
  return null;
}

// ---------------------------------------------------------------
// 阶段 4：PLL（原子公式 BFS）
// ---------------------------------------------------------------

/** PLL 原子公式库（2-look：角排列 + 棱排列） */
const PLL_ATOMS = [
  "R' F R' B2 R F' R' B2 R2",                        // Aa（角三循环）
  "R B' R F2 R' B R F2 R2",                          // Ab（角三循环反向）
  "F R U' R' U' R U R' F' R U R' U' R' F R F'",     // T（角+棱邻换）
  "R U R' U' R' F R2 U' R' U' R U R' F'",           // Jb
  "R U' R U R U R U' R' U' R2",                      // Ua（棱三循环）
  "R2 U R U R' U' R' U' R' U R'",                    // Ub（棱三循环反向）
  "M2 U M2 U2 M2 U M2",                              // H（棱对换）
  "M' U M2 U M2 U M' U2 M2",                         // Z（棱交错）
  "R2 U2 R U2 R2 U2 R2 U2 R U2 R2",                  // H（无 M 版）
  "R' U' R U' R U R U' R' U R U R2 U' R' U2",       // Z（无 M 版）
  "M2 U M2 U M' U2 M2 U2 M' U2",                     // Z 变体
  "R U' L' U2 R' U R' U2 R2 L",                      // Ua 变体
  "L' U R' U2 L U' L U2 L2 R",                       // Ub 变体
];

function solvePLL(cube) {
  if (cube.isSolved()) return { alg: [], cube: cube.clone() };
  // PLL 原子需要 AUF 前+后转（U 层排列的最终对齐）
  const atoms = [];
  for (const alg of PLL_ATOMS) {
    const seq = expandWide(alg);
    for (const pre of ['', 'U', 'U2', "U'"]) {
      for (const post of ['', 'U', 'U2', "U'"]) {
        atoms.push({ seq, pre, post });
      }
    }
  }
  const seen = new Set([cube.toString()]);
  let frontier = [{ s: cube.clone(), chain: [] }];
  for (let d = 1; d <= 3; d++) {
    const next = [];
    for (const n of frontier) {
      for (const atom of atoms) {
        const c = n.s.clone();
        if (atom.pre) c.move(atom.pre);
        for (const mv of atom.seq) c.move(mv);
        if (atom.post) c.move(atom.post);
        const k = c.toString();
        if (seen.has(k)) continue;
        seen.add(k);
        const full = (atom.pre ? [atom.pre] : []).concat(atom.seq).concat(atom.post ? [atom.post] : []);
        const chain = [...n.chain, full];
        if (c.isSolved()) return { alg: chain.flat(), cube: c };
        next.push({ s: c, chain });
      }
    }
    frontier = next;
    if (seen.size > 400000) return null;
  }
  return null;
}

// ---------------------------------------------------------------
// 顶层入口
// ---------------------------------------------------------------

export const PHASE_NAMES = {
  CROSS: 'Cross · 白色十字',
  F2L: 'F2L · 前两层',
  OLL: 'OLL · 顶层朝向',
  PLL: 'PLL · 顶层排列',
  DONE: '已还原',
};

export function currentPhase(cube) {
  // 中心被 M/E/S 移位时按归一化朝向判定阶段
  const c = cube._centers();
  const standard = c.U === 'U' && c.R === 'R' && c.F === 'F' && c.D === 'D' && c.L === 'L' && c.B === 'B';
  const q = standard ? cube : cube.normalizeOrientation()?.cube;
  if (!q) return 'CROSS';
  if (q.isSolved()) return 'DONE';
  if (f2lSolved(q)) {
    return ollSolved(q) ? 'PLL' : 'OLL';
  }
  if (crossSolved(q)) return 'F2L';
  return 'CROSS';
}

/** 公式面名映射：stdFace → realFace（用于归一化空间的公式转回真实空间） */
function mapAlgFaces(alg, faceMap) {
  if (!faceMap) return alg;
  return alg.split(/\s+/).filter(Boolean).map(tok => {
    const f = tok[0], suf = tok.slice(1);
    return (faceMap[f] || f) + suf;
  }).join(' ');
}

/**
 * 朝向归一化包装：若中心被 M/E/S 移位，先归一到标准朝向求解，
 * 再把解的公式面名映射回真实空间。
 * 返回 { normalized, faceMap }；normalized 为 null 表示异常。
 */
function withNormalization(cube) {
  const n = cube.normalizeOrientation();
  if (!n) return null;
  return n;
}

/** 求完整 CFOP 解法（分阶段的公式步骤列表） */
export function solveCFOP(cube) {
  // 中心归一化（M/E/S 中层转动会产生中心位移）
  const norm = withNormalization(cube);
  if (!norm) return null;
  const { cube: std, faceMap, rotated } = norm;

  const steps = [];
  let cur = std.clone();

  if (!crossSolved(cur)) {
    const r = solveCross(cur);
    if (!r) return null;
    steps.push({ phase: 'CROSS', alg: r.alg.join(' '), label: PHASE_NAMES.CROSS,
      description: '将 4 条白色棱块归位到底面 D，形成白色十字。' });
    cur = r.cube;
  }

  if (!f2lSolved(cur)) {
    const r = solveF2L(cur);
    if (!r) return null;
    steps.push({ phase: 'F2L', alg: r.alg.join(' '), label: PHASE_NAMES.F2L,
      description: '将 4 组「角块+棱块」配对并插入前两层的四个槽位。' });
    cur = r.cube;
  }

  if (!ollSolved(cur)) {
    const r = solveOLL(cur);
    if (!r) return null;
    steps.push({ phase: 'OLL', alg: r.alg.join(' '), label: PHASE_NAMES.OLL,
      description: '让顶层（U 面，黄色）的全部贴纸朝上（2-look OLL）。' });
    cur = r.cube;
  }

  if (!cur.isSolved()) {
    const r = solvePLL(cur);
    if (!r) return null;
    steps.push({ phase: 'PLL', alg: r.alg.join(' '), label: PHASE_NAMES.PLL,
      description: '将顶层块排列到正确位置，完成还原（2-look PLL）。' });
    cur = r.cube;
  }

  // 公式面名映射回真实空间
  if (rotated) {
    for (const s of steps) s.alg = mapAlgFaces(s.alg, faceMap);
  }
  return steps;
}

/**
 * 智能下一步提示：返回当前阶段应执行的下一个公式。
 * - CROSS：返回"下一条棱"的解法（更细粒度）
 * - F2L：返回"下一个槽"的解法
 * - OLL/PLL：返回该阶段完整公式（2-look 已是教学粒度）
 */
export function nextHint(cube) {
  // 中心归一化（M/E/S 中层转动会产生中心位移）
  const norm = withNormalization(cube);
  if (!norm) return null;
  const { cube: cube0, faceMap, rotated } = norm;

  const phase = currentPhase(cube0);
  if (phase === 'DONE') {
    return { phase: 'DONE', alg: '', label: '已还原', description: '魔方已完全还原！🎉' };
  }
  const fixAlg = (alg) => rotated ? mapAlgFaces(alg, faceMap) : alg;

  if (phase === 'CROSS') {
    const work = cube0.clone();
    const done = [];
    const doneNames = [];
    // 找出已归位的棱
    for (const t of ['DF', 'DR', 'DB', 'DL']) {
      const [a, b] = EDGES[t];
      if (cube0.stickers[a] === t[0] && cube0.stickers[b] === t[1]) doneNames.push(t);
    }
    for (const t of ['DF', 'DR', 'DB', 'DL']) {
      if (doneNames.includes(t)) continue;
      const goal = (c) => {
        for (const name of doneNames) {
          const [a, b] = EDGES[name];
          if (c.stickers[a] !== name[0] || c.stickers[b] !== name[1]) return false;
        }
        const [a, b] = EDGES[t];
        return c.stickers[a] === t[0] && c.stickers[b] === t[1];
      };
      const path = bfs(work, goal, ALL_MOVES, 7);
      if (!path) return null;
      return { phase: 'CROSS', alg: fixAlg(path.join(' ')), label: `Cross：${t} 棱`,
        description: `将白色-${({DF:'绿',DR:'红',DB:'蓝',DL:'橙'})[t]} 棱块归位到 D 面。` };
    }
  }

  if (phase === 'F2L') {
    const work = cube0.clone();
    const done = F2L_SLOTS.filter(s => slotSolved(work, s));
    for (const slot of F2L_SLOTS) {
      if (slotSolved(work, slot)) continue;
      const path = solveF2LSlot(work, slot, done);
      if (!path) return null;
      return { phase: 'F2L', alg: fixAlg(path.join(' ')), label: `F2L：${slot.corner} 槽`,
        description: `将 ${slot.corner} 角块与 ${slot.edge} 棱块配对并插入槽位。` };
    }
  }

  if (phase === 'OLL') {
    const r = solveOLL(cube0);
    if (!r) return null;
    return { phase: 'OLL', alg: fixAlg(r.alg.join(' ')), label: PHASE_NAMES.OLL,
      description: '让黄色面全部朝上（2-look OLL：先棱后角）。' };
  }

  if (phase === 'PLL') {
    const r = solvePLL(cube0);
    if (!r) return null;
    return { phase: 'PLL', alg: fixAlg(r.alg.join(' ')), label: PHASE_NAMES.PLL,
      description: '将顶层块排列到位，完成还原（2-look PLL）。' };
  }

  return null;
}
