/**
 * main.js — 应用装配
 *
 *  - Cube 逻辑模型 ↔ RubikScene 3D 视图 ↔ Interaction 交互
 *  - CFOP 提示 / 自动演示（公式步进动画 + 高亮当前步）
 *  - 指令输入、计时、步数、教学文案
 */

import { Cube, randomScramble, Cube as _C } from './core/cube.js';
import { solveCFOP, nextHint, currentPhase, PHASE_NAMES } from './core/cfop.js';
import { RubikScene } from './view/scene.js';
import { Interaction } from './view/interaction.js';

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const canvas = $('canvas');
const phaseBadge = $('phase-badge');
const stepCount = $('step-count');
const timerEl = $('timer');
const hintDetail = $('hint-detail');
const phaseIcon = $('phase-icon');
const phaseText = $('phase-text');
const tutorialEl = $('tutorial');
const stageBanner = $('stage-banner');
const formulaOverlay = $('formula-text');
const formulaBox = $('formula-overlay');
const historyEl = $('history');
const cmdInput = $('cmd-input');

// ---------- 状态 ----------
const cube = new Cube();
let moveCount = 0;
let history = [];
let timerStart = null;
let timerRunning = false;
let autoPlaying = false;
let inputLocked = false;    // 动画进行中锁交互

// ---------- 视图 ----------
const scene = new RubikScene(canvas);
scene.syncFromCube(cube);
scene.render();

// 渲染循环
(function loop() {
  scene.render();
  requestAnimationFrame(loop);
})();

// ---------- 交互 ----------
const interaction = new Interaction(scene, {
  onOrbit: (dx, dy) => scene.orbitDelta(dx, dy),
  onZoom: d => scene.zoomDelta(d),
  onMove: mv => doMove(mv),
  canInteract: () => !inputLocked && !autoPlaying,
});

// ---------- 核心动作 ----------

/** 执行一步（动画 + 逻辑 + UI 同步） */
async function doMove(mv, { fast = false, count = true } = {}) {
  if (inputLocked) return;
  inputLocked = true;
  try {
    await scene.animateMove(mv, fast ? 90 : 160);
    cube.move(mv);
    scene.syncFromCube(cube);
    if (count) {
      moveCount++;
      history.push(mv);
      if (history.length > 60) history.shift();
    }
    refreshUI();
  } finally {
    inputLocked = false;
  }
}

/** 执行公式（步进动画），期间在公式浮层高亮当前步 */
async function playFormula(alg, { fast = false } = {}) {
  const moves = alg.trim().split(/\s+/).filter(Boolean);
  showFormulaOverlay(moves);
  for (let i = 0; i < moves.length; i++) {
    highlightFormulaStep(moves, i);
    await doMove(moves[i], { fast, count: true });
  }
  hideFormulaOverlay();
}

// ---------- UI ----------

function refreshUI() {
  const phase = currentPhase(cube);
  phaseBadge.textContent = PHASE_NAMES[phase];
  stepCount.textContent = `步数：${moveCount}`;
  historyEl.textContent = history.slice(-20).join(' ');
  renderTutorial(phase);
  // 还原检测
  if (cube.isSolved() && moveCount > 0 && !autoPlaying) {
    showBanner('🎉 还原完成！');
    setTimeout(hideBanner, 2200);
    stopTimer();
  }
}

const PHASE_TUTORIAL = {
  CROSS: `<b class="cur">① Cross 白色十字</b><br>将 4 条白色棱块归位到底面（D 面），与侧面中心对齐。<br><br>② F2L 前两层<br>③ OLL 顶层朝向<br>④ PLL 顶层排列`,
  F2L: `① Cross 白色十字 <span class="done">✓</span><br><b class="cur">② F2L 前两层</b><br>把「角块 + 棱块」配成一对，插入四个底层槽位。<br><br>③ OLL 顶层朝向<br>④ PLL 顶层排列`,
  OLL: `① Cross <span class="done">✓</span>　② F2L <span class="done">✓</span><br><b class="cur">③ OLL 顶层朝向</b><br>让顶层（黄面）全部朝上（2-look：先棱后角）。<br><br>④ PLL 顶层排列`,
  PLL: `① Cross <span class="done">✓</span>　② F2L <span class="done">✓</span>　③ OLL <span class="done">✓</span><br><b class="cur">④ PLL 顶层排列</b><br>把顶层块换到正确位置，完成还原。`,
  DONE: `① Cross <span class="done">✓</span>　② F2L <span class="done">✓</span>　③ OLL <span class="done">✓</span>　④ PLL <span class="done">✓</span><br><br><b>还原完成！</b>点击「打乱」开始新一轮练习。`,
};

function renderTutorial(phase) {
  tutorialEl.innerHTML = PHASE_TUTORIAL[phase] || '';
}

function showBanner(text) {
  stageBanner.textContent = text;
  stageBanner.classList.remove('hidden');
}
function hideBanner() {
  stageBanner.classList.add('hidden');
}

function showFormulaOverlay(moves) {
  formulaBox.classList.remove('hidden');
  formulaOverlay.innerHTML = moves.map((m, i) =>
    `<span data-i="${i}">${m}</span>`).join('<span class="sep"> </span>');
}
function highlightFormulaStep(moves, cur) {
  const spans = formulaOverlay.querySelectorAll('span[data-i]');
  spans.forEach((s, i) => {
    s.className = i < cur ? 'mv-done' : i === cur ? 'mv-cur' : '';
  });
}
function hideFormulaOverlay() {
  formulaBox.classList.add('hidden');
}

// ---------- 计时 ----------

function tick() {
  if (!timerRunning) return;
  const t = (Date.now() - timerStart) / 1000;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  timerEl.textContent = `${String(m).padStart(2, '0')}:${s}`;
  requestAnimationFrame(tick);
}
function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerStart = Date.now();
  tick();
}
function stopTimer() {
  timerRunning = false;
}
function resetTimer() {
  stopTimer();
  timerEl.textContent = '00:00.0';
}

// ---------- 按钮事件 ----------

$('btn-reset').addEventListener('click', () => {
  if (inputLocked || autoPlaying) return;
  cube.reset();
  moveCount = 0;
  history = [];
  resetTimer();
  scene.syncFromCube(cube);
  hideFormulaOverlay();
  phaseIcon.textContent = '🎯';
  phaseText.textContent = '已重置。点击「打乱」开始练习。';
  hintDetail.classList.remove('show');
  refreshUI();
});

$('btn-scramble').addEventListener('click', async () => {
  if (inputLocked || autoPlaying) return;
  const sc = randomScramble(20);
  phaseIcon.textContent = '🎲';
  phaseText.textContent = '打乱中…';
  // 快速播放打乱（无步数统计视觉跳变）
  for (const mv of sc.split(' ')) {
    await doMove(mv, { fast: true, count: false });
  }
  moveCount = 0;
  history = sc.split(' ');
  resetTimer();
  startTimer();
  phaseIcon.textContent = '🎲';
  phaseText.textContent = '已打乱。点击「下一步提示」获取 CFOP 解法。';
  hintDetail.classList.remove('show');
  refreshUI();
});

$('btn-undo').addEventListener('click', async () => {
  if (inputLocked || autoPlaying || !history.length) return;
  const last = history.pop();
  const inv = _C.inverseMove(last);
  await doMove(inv, { count: false });
  moveCount = Math.max(0, moveCount - 1);
  refreshUI();
});

// ---------- CFOP 提示 ----------

function showHint(hint) {
  if (!hint) {
    phaseIcon.textContent = '⚠️';
    phaseText.textContent = '提示计算失败，请重置后重试。';
    return false;
  }
  phaseIcon.textContent = { CROSS: '➕', F2L: '🧩', OLL: '🌙', PLL: '🔄', DONE: '🎉' }[hint.phase] || '🎯';
  phaseText.textContent = hint.label;
  hintDetail.innerHTML = `
    <div>${hint.description}</div>
    ${hint.alg ? `<div style="margin-top:6px">公式：<span class="formula">${hint.alg}</span></div>` : ''}
  `;
  hintDetail.classList.add('show');
  return true;
}

$('btn-hint').addEventListener('click', async () => {
  if (inputLocked || autoPlaying) return;
  const phase = currentPhase(cube);
  if (phase === 'DONE') { showHint({ phase: 'DONE', label: '已还原', description: '魔方已完全还原！🎉' }); return; }
  phaseIcon.textContent = '⏳';
  phaseText.textContent = '计算中…';
  // 求解计算可能较重，放下一帧执行避免卡 UI
  await new Promise(r => setTimeout(r, 20));
  const hint = nextHint(cube);
  if (showHint(hint) && hint && hint.alg) {
    // 只展示不执行？教学场景：演示执行
    await playFormula(hint.alg, { fast: false });
  }
  refreshUI();
});

$('btn-auto').addEventListener('click', async () => {
  if (inputLocked || autoPlaying) return;
  autoPlaying = true;
  $('btn-auto').disabled = true;
  try {
    let guard = 0;
    while (guard++ < 60) {
      const phase = currentPhase(cube);
      if (phase === 'DONE') break;
      phaseIcon.textContent = '⏳';
      phaseText.textContent = `${PHASE_NAMES[phase]} · 计算中…`;
      await new Promise(r => setTimeout(r, 20));
      const hint = nextHint(cube);
      if (!hint || !hint.alg) break;
      showBanner(PHASE_NAMES[hint.phase]);
      showHint(hint);
      await playFormula(hint.alg, { fast: true });
    }
    if (cube.isSolved()) {
      showBanner('🎉 CFOP 还原完成！');
      setTimeout(hideBanner, 2600);
    }
  } finally {
    autoPlaying = false;
    $('btn-auto').disabled = false;
    hideFormulaOverlay();
    hideBanner();
    refreshUI();
  }
});

$('btn-stop-auto').addEventListener('click', () => {
  autoPlaying = false;
  $('btn-auto').disabled = false;
  hideFormulaOverlay();
});

// ---------- 指令输入 ----------

async function runCommand() {
  const alg = cmdInput.value.trim();
  if (!alg || inputLocked || autoPlaying) return;
  // 校验
  const toks = alg.split(/\s+/);
  for (const t of toks) {
    if (!/^[UDLRFBMES]('|2|2')?$/.test(t)) {
      phaseIcon.textContent = '⚠️';
      phaseText.textContent = `非法指令：${t}（支持 U D L R F B M E S + ' / 2）`;
      return;
    }
  }
  cmdInput.value = '';
  await playFormula(alg);
}

$('btn-run').addEventListener('click', runCommand);
cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') runCommand();
  e.stopPropagation();
});

// 移动端按键
document.querySelectorAll('#mobile-pad button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!inputLocked && !autoPlaying) doMove(btn.dataset.move);
  });
});

// ---------- 启动 ----------
refreshUI();
