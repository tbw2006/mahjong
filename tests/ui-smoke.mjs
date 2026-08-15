/**
 * UI / 渲染冒烟测试：用轻量 DOM 桩加载渲染层与 UI，
 * 在无浏览器环境里验证“设置弹窗 → 渲染牌桌 → 结算面板”不抛异常。
 * 运行：node tests/ui-smoke.mjs
 */

class FakeClassList {
  add() {} remove() {} toggle() {} contains() { return false; }
}
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.innerHTML = '';
    this.textContent = '';
    this.checked = false;
    this.value = '';
    this.disabled = false;
    this.title = '';
    this._handlers = {};
    this._q = new Map();
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  addEventListener(t, fn) { this._handlers[t] = fn; }
  removeEventListener() {}
  querySelector(sel) {
    if (!this._q.has(sel)) this._q.set(sel, new FakeEl());
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  closest() { return this; }
  get firstChild() { return this.children[0] || null; }
}

const els = new Map();
globalThis.window = {
  AudioContext: class {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; this.sampleRate = 48000; }
    resume() {}
    createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {} }; }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createBufferSource() { return { buffer: null, connect: () => ({ connect() {} }), start() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }) }; }
  },
  addEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = {
  querySelector(sel) {
    if (/^##/.test(String(sel))) throw new SyntaxError(`invalid selector: ${sel}`);
    if (!els.has(sel)) els.set(sel, new FakeEl());
    return els.get(sel);
  },
  querySelectorAll() { return []; },
  createElement(tag) { return new FakeEl(tag); },
  body: new FakeEl('body'),
};

const { GameUI } = await import('../src/ui/ui.js');
const { TableRenderer, tileSVG, tileFace, tileBackFace } = await import('../src/render/renderer.js');
const { MahjongEngine } = await import('../src/core/engine.js');
const { getPreset, normalizeRules } = await import('../src/core/rules.js');

const ui = new GameUI();
ui.bind({ onStartRule() {}, onNextHand() {}, onNewSettings() {} });
ui.showSettings();
ui._renderOptions();
ui.showHelp();
ui._removeModal();

const rules = normalizeRules(getPreset('guangdong')).rules;
const engine = new MahjongEngine(rules, { seed: 7, humanSeat: 0 });
engine.startHand();
const renderer = new TableRenderer(document);
renderer.render(engine.state, { humanSeat: 0, lastEvent: null });

// 模拟出几张牌后再次渲染
engine.take({ type: 'discard', seat: 0, tile: engine.state.players[0].concealed[0] });
renderer.render(engine.state, { humanSeat: 0, lastEvent: { type: 'discard', seat: 0, tile: 0 } });

// 结算面板（伪造 winInfo 走渲染路径）
engine.state.winInfo = {
  winnerSeat: 0, tile: 1, source: 'selfDraw',
  analysis: { kind: 'standard', fan: [{ key: 'zimo', name: '自摸', desc: '', value: 1 }], total: 1, scoreUnit: 2, multiplier: 2 },
  payments: [{ from: 1, to: 0, amount: 2 }],
  revealedHand: engine.state.players[0].concealed.slice(),
  melds: [],
};
ui.showResult(engine.state, 0);
ui._removeModal();

for (let t = 0; t < 34; t++) {
  const path = tileSVG(t, { size: 96, laizi: false });
  if (!path || !path.startsWith('assets/tiles/')) throw new Error(`牌面 ${t} 素材路径无效: ${path}`);
}
if (!tileFace(0).includes('assets/tiles/Man1.svg')) throw new Error('牌面 URL 映射错误');
if (!tileBackFace().includes('assets/tiles/Back.svg')) throw new Error('牌背 URL 映射错误');

console.log('UI 冒烟测试通过：设置/帮助/渲染/结算/34 张牌面素材映射均无异常');
