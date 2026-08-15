/**
 * 游戏 UI：设置 / 结算 / 帮助 / 操作提示 / 提示条。
 * UI 只产生 ACTION 对象交给控制器，不直接修改引擎状态。
 */

import { PRESETS, getPreset, cloneRules, normalizeRules, describeRules } from '../core/rules.js';
import { tileName } from '../core/tiles.js';
import { ACTIONS } from '../core/protocol.js';
import { tileFace } from '../render/renderer.js';
import { setSoundEnabled, isSoundEnabled } from './audio.js';

const WINDS = ['东', '南', '西', '北'];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class GameUI {
  constructor() {
    this.editRules = cloneRules(getPreset('custom'));
    this.selectedPreset = 'custom';
    this.onStartRule = null;
    this.onNextHand = null;
    this.onNewSettings = null;
    this.actionCallback = null;
    this.$ = (id) => document.querySelector(String(id).startsWith('#') ? id : `#${id}`);
  }

  bind({ onStartRule, onNextHand, onNewSettings, onSettings = null, onHome = null }) {
    this.onStartRule = onStartRule;
    this.onNextHand = onNextHand;
    this.onNewSettings = onNewSettings;
    this.settingsHandler = onSettings;
    this.homeHandler = onHome;
    const btnSettings = this.$('#btn-settings');
    const btnHelp = this.$('#btn-help');
    const btnSound = this.$('#btn-sound');
    const btnHome = this.$('#btn-home');
    if (btnHome) btnHome.addEventListener('click', () => {
      if (this.homeHandler) this.homeHandler();
      else if (window.confirm('确定返回主菜单吗？')) { this._removeModal(); window.location.reload(); }
    });
    btnSettings.addEventListener('click', () => {
      if (this.settingsHandler) this.settingsHandler();
      else this.showSettings();
    });
    btnHelp.addEventListener('click', () => this.showHelp());
    btnSound.addEventListener('click', () => {
      const v = setSoundEnabled(!isSoundEnabled());
      btnSound.textContent = v ? '🔊' : '🔇';
    });
  }

  setRuleChip(text) {
    this.$('#rule-chip').textContent = text;
  }

  /* ---------------- 提示条 ---------------- */

  toast(msg, ms = 1800) {
    const el = this.$('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /**
   * 出牌 / 吃碰杠 / 胡牌 的中央特效提示。
   * @param {string} text 例如：下家 打出 三万
   * @param {string} kind discard | meld | gang | win
   * @param {string} glyph 圆形徽标里的字：牌/碰/吃/杠/胡
   */
  showActionFlash(text, kind = 'discard', glyph = '牌') {
    const el = this.$('#action-flash');
    if (!el) return;
    const kindEl = el.querySelector('.flash-kind');
    const textEl = el.querySelector('.flash-text');
    if (kindEl) kindEl.textContent = glyph;
    if (textEl) textEl.textContent = text;
    el.className = `kind-${kind}`;
    el.classList.remove('show');
    void el.offsetWidth; // 重置动画
    el.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- 设置弹窗 ---------------- */

  showSettings() {
    this._removeModal();
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>选择玩法</h2>
      <div class="sub">预设经典玩法，或自定义牌张 / 癞子 / 番数门槛。所有规则均为纯数据配置，可序列化用于联网对战。</div>
      <div class="preset-grid" id="preset-grid"></div>
      <div class="opt-grid" id="opt-grid"></div>
      <div class="modal-actions">
        <span id="rule-summary" style="align-self:center;font-size:12px;color:rgba(243,226,189,.65);"></span>
        <button class="btn ghost" id="btn-home-from-settings">⌂ 主菜单</button>
        <button class="btn ghost" id="btn-cancel">取消</button>
        <button class="btn primary" id="btn-start">开局</button>
      </div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);

    const grid = modal.querySelector('#preset-grid');
    for (const preset of PRESETS) {
      const card = document.createElement('div');
      card.className = 'preset-card' + (preset.id === this.selectedPreset ? ' selected' : '');
      card.dataset.id = preset.id;
      card.innerHTML = `
        <div class="p-name">${preset.name}</div>
        <div class="p-desc">${preset.desc}</div>
        ${preset.id === this.selectedPreset ? '<div class="p-check">✓</div>' : ''}`;
      card.addEventListener('click', () => {
        this.selectedPreset = preset.id;
        this.editRules = cloneRules(preset);
        this._renderOptions();
        this._renderPresetCards();
      });
      grid.appendChild(card);
    }

    this._renderOptions();
    modal.querySelector('#btn-home-from-settings').addEventListener('click', () => {
      if (this.homeHandler) this.homeHandler();
      else if (window.confirm('确定返回主菜单吗？')) { this._removeModal(); window.location.reload(); }
    });
    modal.querySelector('#btn-cancel').addEventListener('click', () => this._removeModal());
    modal.querySelector('#btn-start').addEventListener('click', () => {
      const res = normalizeRules(this.editRules);
      if (!res.ok) {
        this.toast(res.error, 2600);
        return;
      }
      const rules = res.rules;
      this._removeModal();
      if (this.onStartRule) this.onStartRule(rules);
    });
  }

  _renderPresetCards() {
    const cards = document.querySelectorAll('#preset-grid .preset-card');
    for (const card of cards) {
      const selected = card.dataset.id === this.selectedPreset;
      card.classList.toggle('selected', selected);
      let check = card.querySelector('.p-check');
      if (selected && !check) {
        check = document.createElement('div');
        check.className = 'p-check';
        check.textContent = '✓';
        card.appendChild(check);
      } else if (!selected && check) {
        check.remove();
      }
    }
  }

  /**
   * 渲染规则编辑面板（单机设置与联机建房共用）。
   * @param {object} [rules] 要编辑的规则对象
   * @param {string} [hostSel] 面板容器选择器
   * @param {string} [summarySel] 规则摘要元素选择器
   * @param {Function} [onEdit] 任何规则被修改后的回调
   */
  _renderOptions(rules = this.editRules, hostSel = '#opt-grid', summarySel = '#rule-summary', onEdit = null) {
    const host = document.querySelector(hostSel);
    if (!host) return;
    const r = rules;
    host.innerHTML = '';
    const changed = () => {
      this._refreshSummary(r, summarySel);
      if (onEdit) onEdit(r);
    };

    const addSwitch = (label, key, extra = '') => {
      const row = document.createElement('div');
      row.className = 'opt-row';
      row.innerHTML = `
        <div><label>${label}</label><div class="hint">${extra}</div></div>
        <span class="switch"><input type="checkbox" id="opt-${key}" ${r[key] ? 'checked' : ''}><span class="slider"></span></span>`;
      row.querySelector('input').addEventListener('change', (e) => { r[key] = e.target.checked; changed(); });
      host.appendChild(row);
    };

    addSwitch('万子（一萬 ~ 九萬）', 'suitsWan', '花色牌');
    addSwitch('筒子（一筒 ~ 九筒）', 'suitsTong', '花色牌');
    addSwitch('条子（一条 ~ 九条）', 'suitsTiao', '花色牌');
    addSwitch('字牌（中 · 發 · 白）', 'dragons', '箭牌 / 三元牌');
    addSwitch('风牌（東 · 南 · 西 · 北）', 'winds', '四风牌');
    addSwitch('允许吃牌', 'allowChi', '下家吃上家');
    addSwitch('允许碰牌', 'allowPong', '');
    addSwitch('允许杠牌（明/暗/补杠）', 'allowGang', '');
    addSwitch('庄家结算翻倍', 'dealerDouble', '庄家赢或输均翻倍');
    addSwitch('缺一门（川麻规则）', 'requiredQueYiMen', '胡牌时万筒条须缺一门');

    // 初始化三个花色开关：由于规则用数组保存，单独处理
    const suitMap = { suitsWan: 0, suitsTong: 1, suitsTiao: 2 };
    for (const [key, idx] of Object.entries(suitMap)) {
      const input = host.querySelector(`#opt-${key}`);
      if (!input) continue;
      input.checked = !!r.suits[idx];
      input.addEventListener('change', (e) => { r.suits[idx] = e.target.checked; changed(); });
    }

    // 癞子数量
    const laiziRow = document.createElement('div');
    laiziRow.className = 'opt-row';
    laiziRow.innerHTML = `
      <div><label>癞子数量</label><div class="hint">翻指示牌，其后连续张为万能牌（0~8）</div></div>
      <span style="display:flex;align-items:center;gap:8px;">
        <input type="range" min="0" max="8" step="1" value="${r.laiziCount}" id="opt-laizi">
        <b id="opt-laizi-val" style="min-width:20px;color:#ffd98a;">${r.laiziCount}</b>
      </span>`;
    laiziRow.querySelector('input').addEventListener('input', (e) => {
      r.laiziCount = Number(e.target.value);
      laiziRow.querySelector('#opt-laizi-val').textContent = r.laiziCount;
      changed();
    });
    host.appendChild(laiziRow);

    // 起胡番
    const minFanRow = document.createElement('div');
    minFanRow.className = 'opt-row';
    minFanRow.innerHTML = `
      <div><label>起胡番数</label><div class="hint">0 = 鸡胡可胡；国标为番点门槛</div></div>
      <span style="display:flex;align-items:center;gap:8px;">
        <input type="range" min="0" max="8" step="1" value="${r.minFan}" id="opt-minfan">
        <b id="opt-minfan-val" style="min-width:20px;color:#ffd98a;">${r.minFan}</b>
      </span>`;
    minFanRow.querySelector('input').addEventListener('input', (e) => {
      r.minFan = Number(e.target.value);
      minFanRow.querySelector('#opt-minfan-val').textContent = r.minFan;
      changed();
    });
    host.appendChild(minFanRow);

    // 底分
    const baseRow = document.createElement('div');
    baseRow.className = 'opt-row';
    baseRow.innerHTML = `
      <div><label>底分</label><div class="hint">每份点数，实际支付 = 底分 × 2^番</div></div>
      <select class="select-box" id="opt-base">
        ${[1, 2, 5, 10].map((v) => `<option value="${v}" ${r.baseScore === v ? 'selected' : ''}>${v} 分</option>`).join('')}
      </select>`;
    baseRow.querySelector('select').addEventListener('change', (e) => {
      r.baseScore = Number(e.target.value);
      changed();
    });
    host.appendChild(baseRow);

    // 计分方式
    const scoreRow = document.createElement('div');
    scoreRow.className = 'opt-row';
    scoreRow.innerHTML = `
      <div><label>计分方式</label><div class="hint">翻倍：底分 × 2^番；番点：国标式累加</div></div>
      <select class="select-box" id="opt-scoring">
        <option value="fan-double" ${r.scoringSet === 'fan-double' ? 'selected' : ''}>番倍（2^番）</option>
        <option value="fan-points" ${r.scoringSet === 'fan-points' ? 'selected' : ''}>番点（国标）</option>
      </select>`;
    scoreRow.querySelector('select').addEventListener('change', (e) => {
      r.scoringSet = e.target.value;
      if (e.target.value === 'fan-points') r.fanTable = 'guobiao';
      else r.fanTable = 'custom';
      changed();
    });
    host.appendChild(scoreRow);

    this._refreshSummary(r, summarySel);
  }

  _refreshSummary(rules = this.editRules, summarySel = '#rule-summary') {
    const el = document.querySelector(summarySel);
    if (!el) return;
    const res = normalizeRules(rules);
    if (!res.ok) {
      el.textContent = `⚠ ${res.error}`;
      el.style.color = '#ff9a7c';
      return;
    }
    el.textContent = describeRules(res.rules);
    el.style.color = '';
  }

  /* ---------------- 结算弹窗 ---------------- */

  showResult(state, humanSeat, opts = {}) {
    const nextText = opts.nextText || '下一局（继续累计分）';
    const altText = opts.altText || '换玩法';
    this._removeModal();
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal';
    const win = state.winInfo;
    const winner = state.players[win.winnerSeat];
    const winName = win.winnerSeat === humanSeat ? '你' : winner.name;
    const isSelf = win.source === 'selfDraw';
    const sourceText = win.source === 'selfDraw' ? '自摸' : win.source === 'robGang' ? '抢杠胡' : '点炮胡';

    const tilesHtml = (tiles) => tiles.map((t) => `<div class="tile" style="background-image:${tileFace(t, 96)};" title="${tileName(t)}"></div>`).join('');
    const meldHtml = win.melds.map((m) => `
      <div class="meld-row">
        <span style="font-size:11px;opacity:.7;">${m.sub === 'an' ? '暗杠' : m.type === 'gang' ? '杠' : m.type === 'pong' ? '碰' : '吃'}</span>
        ${m.tiles.map((t) => `<div class="tile" style="background-image:${tileFace(t, 96)};" title="${tileName(t)}"></div>`).join('')}
      </div>`).join('');

    const isPoints = state.rules && state.rules.scoringSet === 'fan-points';
    const fanRows = win.analysis.fan.map((f) => `
      <tr><td>${f.name}</td><td style="color:rgba(243,226,189,.7);font-size:11.5px;">${f.desc}</td><td style="text-align:right;color:#ffd98a;">+${f.value}</td></tr>`).join('');
    const payRows = win.payments.map((p) => `
      <div class="pay">${state.players[p.from].name} → ${state.players[p.to].name}：<b>${p.amount}</b> 分</div>`).join('');
    const scoresHtml = state.players.map((p) => `${p.name} ${p.score >= 0 ? '+' : ''}${p.score}`).join('　');

    modal.innerHTML = `
      <h2>${winName} · ${sourceText}${win.source === 'selfDraw' ? '' : `（${state.players[win.discarderSeat].name} 放炮）`}</h2>
      <div class="sub">${state.players[win.winnerSeat].name} 胡「${tileName(win.tile)}」 · ${win.analysis.kind === 'seven-pairs' ? '七对' : win.analysis.kind === 'thirteen-orphans' ? '十三幺' : '标准胡型'}</div>
      <div class="result-body">
        <div class="result-left">
          <div style="font-size:12px;opacity:.65;">胡牌手牌</div>
          ${meldHtml}
          <div class="win-tiles">${tilesHtml(win.revealedHand)}</div>
          <div class="fan-total">
            总番${isPoints ? '点' : ''} ${win.analysis.total} ·
            ${win.analysis.scoreUnit} 分/份
            <small>（${isPoints ? '国标番点累加' : `底分 × ${win.analysis.multiplier} 倍`}）</small>
          </div>
        </div>
        <div class="result-right">
          <div style="font-size:12px;opacity:.65;">番型明细</div>
          <table class="fan-table">
            <tr><th>番型</th><th>说明</th><th>${isPoints ? '点' : '番'}</th></tr>
            ${fanRows || '<tr><td colspan="3">鸡胡（0 番）</td></tr>'}
          </table>
          <div style="font-size:12px;opacity:.65;margin-top:10px;">支付</div>
          <div class="pay-list">${payRows}</div>
          <div style="margin-top:8px;font-size:12px;opacity:.7;">当前总分：${scoresHtml}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" id="btn-new-rules">${altText}</button>
        <button class="btn primary" id="btn-next">${nextText}</button>
      </div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);

    modal.querySelector('#btn-next').addEventListener('click', () => {
      this._removeModal();
      if (opts.onNext) opts.onNext();
      else if (this.onNextHand) this.onNextHand();
    });
    modal.querySelector('#btn-new-rules').addEventListener('click', () => {
      this._removeModal();
      if (opts.onAlt) opts.onAlt();
      else if (this.onNewSettings) this.onNewSettings();
    });
  }

  showDrawGame(state, humanSeat, opts = {}) {
    const nextText = opts.nextText || '下一局';
    const altText = opts.altText || '换玩法';
    this._removeModal();
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal';
    const scoresHtml = state.players.map((p) => `${p.name} ${p.score >= 0 ? '+' : ''}${p.score}`).join('　');
    modal.innerHTML = `
      <h2>荒庄 · 流局</h2>
      <div class="sub">牌墙已摸完，无人胡牌。${state.players[state.dealerSeat].name} 本局做庄。</div>
      <div class="result-body"><div class="pay-list">当前总分：${scoresHtml}</div></div>
      <div class="modal-actions">
        <button class="btn ghost" id="btn-new-rules">${altText}</button>
        <button class="btn primary" id="btn-next">${nextText}</button>
      </div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    modal.querySelector('#btn-next').addEventListener('click', () => {
      this._removeModal();
      if (opts.onNext) opts.onNext();
      else if (this.onNextHand) this.onNextHand();
    });
    modal.querySelector('#btn-new-rules').addEventListener('click', () => {
      this._removeModal();
      if (opts.onAlt) opts.onAlt();
      else if (this.onNewSettings) this.onNewSettings();
    });
  }

  /* ---------------- 帮助 ---------------- */

  showHelp() {
    this._removeModal();
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>玩法说明</h2>
      <div class="help-list">
        <div><b>操作：</b>轮到你时，点击手牌即可出牌；出现「胡 / 碰 / 杠 / 吃」按钮时可在时限内响应，点「过」放弃。</div>
        <div><b>玩法：</b>支持广东麻将（鸡胡）、国标麻将（8 番点起胡）、四川麻将（简版·缺一门）、香港麻将（3 番起胡）、癞子麻将，以及完全自定义。</div>
        <div><b>自定义：</b>可开关万 / 筒 / 条 / 字牌（中发白）/ 风牌（东南西北），设置癞子 0~8 张、起胡番、吃碰杠、底分与计分方式。</div>
        <div><b>癞子：</b>开牌后翻一张指示牌，其下一张起连续 N 张为万能牌（如翻 8 万，9 万 / 1 筒 / 2 筒 / 3 筒为癞子），可代替任意牌。</div>
        <div><b>计分：</b>番倍玩法按「底分 × 2^总番」计分，点炮由放炮者支付，自摸三家各付；国标按番点累加。庄家翻倍可在自定义中开启。</div>
        <div><b>联网预留：</b>本作的核心是纯状态机引擎，UI 只发送标准 ACTION、接收标准 EVENT。未来接入 WebSocket 服务器时无需改动引擎与渲染层（详见 docs/NETWORK_PROTOCOL.md）。</div>
      </div>
      <div class="modal-actions"><button class="btn" id="btn-help-close">知道了</button></div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    modal.querySelector('#btn-help-close').addEventListener('click', () => this._removeModal());
  }

  /* ---------------- 操作提示 ---------------- */

  /**
   * @param {object|null} prompt {kind:'turn'|'claim', seat, options, claim:{tile,from,kind}}
   * @param {Function} onSubmit (action) => void
   */
  setActions(prompt, onSubmit) {
    const host = this.$('#actions');
    host.innerHTML = '';
    this.actionCallback = null;
    this.touchConfirmBtn = null;
    if (!prompt || !onSubmit) return;
    this.actionCallback = onSubmit;
    const { options } = prompt;

    if (prompt.kind === 'turn') {
      if (options.canHu) {
        this._actionBtn(host, '胡', 'action-btn', () => onSubmit({ type: ACTIONS.HU, seat: prompt.seat }));
      }
      for (const tile of options.anGang) {
        this._actionBtn(host, `暗杠 ${tileName(tile)}`, 'action-btn small', () => onSubmit({ type: ACTIONS.AN_GANG, seat: prompt.seat, tile }));
      }
      for (const tile of options.buGang) {
        this._actionBtn(host, `补杠 ${tileName(tile)}`, 'action-btn small', () => onSubmit({ type: ACTIONS.BU_GANG, seat: prompt.seat, tile }));
      }
      if (prompt.touchMode) {
        this.touchConfirmBtn = this._actionBtn(host, '出牌', 'action-btn small', prompt.onTouchConfirm || null, true);
        this._actionBtn(host, '点选手牌后确认', 'action-btn pass-btn small disabled-hint', null, true);
      } else {
        this._actionBtn(host, '点击手牌出牌', 'action-btn pass-btn small disabled-hint', null, true);
      }
    } else if (prompt.kind === 'claim') {
      const tile = prompt.claim.tile;
      const huOpt = options.find((o) => o.claim === 'hu');
      if (huOpt) {
        const label = prompt.claim.kind === 'robGang' ? `抢杠胡 ${tileName(tile)}` : `胡 ${tileName(tile)}`;
        this._actionBtn(host, label, 'action-btn', () => onSubmit({ type: ACTIONS.HU, seat: prompt.seat, tile }));
      }
      if (options.some((o) => o.claim === 'gang')) {
        this._actionBtn(host, `杠 ${tileName(tile)}`, 'action-btn', () => onSubmit({ type: ACTIONS.GANG, seat: prompt.seat, tile }));
      }
      if (options.some((o) => o.claim === 'pong')) {
        this._actionBtn(host, `碰 ${tileName(tile)}`, 'action-btn', () => onSubmit({ type: ACTIONS.PONG, seat: prompt.seat, tile }));
      }
      for (const chi of options.filter((o) => o.claim === 'chi')) {
        const combo = [chi.tile, chi.a, chi.b].sort((x, y) => x - y).map(tileName).join('');
        this._actionBtn(host, `吃 ${combo}`, 'action-btn small', () => onSubmit({ type: ACTIONS.CHI, seat: prompt.seat, tile, a: chi.a, b: chi.b }));
      }
      this._actionBtn(host, '过', 'action-btn pass-btn', () => onSubmit({ type: ACTIONS.PASS, seat: prompt.seat }));
    }
  }

  _actionBtn(host, text, cls, onClick, disabled = false) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    if (disabled) b.disabled = true;
    if (onClick) b.addEventListener('click', onClick);
    host.appendChild(b);
    return b;
  }

  /** 手机触控：选中手牌后启用“出牌”确认按钮 */
  updateTouchConfirm(enabled) {
    if (this.touchConfirmBtn) this.touchConfirmBtn.disabled = !enabled;
  }

  /* ---------------- 工具 ---------------- */

  _mask() {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    return mask;
  }

  _removeModal() {
    document.querySelectorAll('.modal-mask').forEach((m) => m.remove());
  }

  /* ---------------- 模式选择与联网大厅 ---------------- */

  showModeSelect({ onLocal, onOnline }) {
    this._removeModal();
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal mode-modal';
    modal.innerHTML = `
      <h2>选择模式</h2>
      <div class="sub">同一套规则与画面：单机与联机随时切换。</div>
      <div class="mode-cards">
        <button class="mode-card" id="mode-local">
          <div class="mode-icon">🀄</div>
          <div class="mode-name">单机对战</div>
          <div class="mode-desc">广东 / 国标 / 四川 / 香港 / 癞子<br/>自定义牌张与规则，人机对局</div>
        </button>
        <button class="mode-card" id="mode-online">
          <div class="mode-icon">🌐</div>
          <div class="mode-name">联机对战</div>
          <div class="mode-desc">房间码建房 / 加入<br/>电脑手机同服对战 · 断线自动托管</div>
        </button>
      </div>
      <div class="modal-actions"><button class="btn ghost" id="btn-mode-help">玩法说明</button></div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    modal.querySelector('#mode-local').addEventListener('click', () => { this._removeModal(); onLocal(); });
    modal.querySelector('#mode-online').addEventListener('click', () => { this._removeModal(); onOnline(); });
    modal.querySelector('#btn-mode-help').addEventListener('click', () => this.showHelp());
  }

  /**
   * 联机大厅：建房 / 加入。
   * @param {object} handlers {onCreate(name,rules), onJoin(code,name), onBack}
   */
  showOnlineLobby(handlers = {}) {
    this._removeModal();
    this.lobbyHandlers = handlers;
    const name = this.playerName || `玩家${Math.floor(100 + Math.random() * 900)}`;
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal lobby-modal';
    modal.innerHTML = `
      <h2>联机对战</h2>
      <div class="sub">创建房间并分享 6 位房间码；好友输入房间码即可加入。支持 1~4 人，空位由电脑托管。</div>
      <div class="net-status" id="net-status"><span class="net-dot"></span>正在连接服务器…</div>
      <div class="opt-row">
        <div><label>你的昵称</label></div>
        <input class="text-input" id="lobby-name" maxlength="12" value="${escapeHtml(name)}" />
      </div>
      <div class="lobby-cols">
        <div class="lobby-col">
          <div class="lobby-title">创建房间</div>
          <div class="opt-row">
            <div><label>玩法预设</label></div>
            <select class="select-box" id="lobby-preset">
              ${PRESETS.map((p) => `<option value="${p.id}" ${p.id === 'guangdong' ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn ghost wide" id="btn-toggle-rules" type="button">⚙ 展开规则调整</button>
          <div id="online-opt-wrap" style="display:none;">
            <div class="opt-grid" id="online-opt-grid"></div>
            <span id="online-rule-summary" style="font-size:12px;color:rgba(243,226,189,.65);"></span>
          </div>
          <button class="btn primary wide" id="btn-create-room">创建房间</button>
        </div>
        <div class="lobby-col">
          <div class="lobby-title">加入房间</div>
          <div class="opt-row">
            <div><label>房间码</label></div>
            <input class="text-input code-input" id="lobby-code" maxlength="6" placeholder="ABC123" />
          </div>
          <button class="btn wide" id="btn-join-room">加入房间</button>
        </div>
      </div>
      <div class="modal-actions"><button class="btn ghost" id="btn-lobby-back">返回模式选择</button></div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);

    // 联机自定义规则面板（与单机设置共用同一套编辑器）
    if (!this.onlineEditRules) this.onlineEditRules = cloneRules(getPreset('guangdong'));
    const presetSelect = modal.querySelector('#lobby-preset');
    const ruleWrap = modal.querySelector('#online-opt-wrap');
    const renderOnlineRules = () => {
      this._renderOptions(
        this.onlineEditRules,
        '#online-opt-grid',
        '#online-rule-summary',
        (r) => {
          // 任何调整都会脱离预设，标记为自定义玩法
          r.id = 'custom';
          r.name = '自定义玩法';
          presetSelect.value = 'custom';
        },
      );
    };
    presetSelect.addEventListener('change', () => {
      this.onlineEditRules = cloneRules(getPreset(presetSelect.value));
      if (presetSelect.value === 'custom') {
        ruleWrap.style.display = '';
        modal.querySelector('#btn-toggle-rules').textContent = '⚙ 收起规则调整';
      }
      renderOnlineRules();
    });
    modal.querySelector('#btn-toggle-rules').addEventListener('click', () => {
      const open = ruleWrap.style.display === 'none';
      ruleWrap.style.display = open ? '' : 'none';
      modal.querySelector('#btn-toggle-rules').textContent = open ? '⚙ 收起规则调整' : '⚙ 展开规则调整';
      if (open) renderOnlineRules();
    });
    renderOnlineRules();

    modal.querySelector('#btn-create-room').addEventListener('click', () => {
      const nameInput = modal.querySelector('#lobby-name');
      this.playerName = (nameInput.value || '').trim() || '玩家';
      const res = normalizeRules(this.onlineEditRules);
      if (!res.ok) {
        this.toast(res.error, 2600);
        return;
      }
      const rules = cloneRules(res.rules);
      if (handlers.onCreate) handlers.onCreate(this.playerName, rules);
    });
    modal.querySelector('#btn-join-room').addEventListener('click', () => {
      const nameInput = modal.querySelector('#lobby-name');
      const code = modal.querySelector('#lobby-code').value.trim().toUpperCase();
      this.playerName = (nameInput.value || '').trim() || '玩家';
      if (code.length !== 6) { this.toast('请输入 6 位房间码', 2200); return; }
      if (handlers.onJoin) handlers.onJoin(code, this.playerName);
    });
    modal.querySelector('#btn-lobby-back').addEventListener('click', () => {
      this._removeModal();
      if (handlers.onBack) handlers.onBack();
    });
  }

  /** 更新联机大厅顶部的连接状态提示 */
  updateLobbyStatus(text, state = 'connecting') {
    const el = document.querySelector('#net-status');
    if (!el) return;
    el.className = `net-status ${state}`;
    el.innerHTML = `<span class="net-dot"></span>${escapeHtml(text)}`;
  }

  /**
   * 房间面板（等待开局）。
   * @param {object} data {roomId, hostSeat, players, rules, mySeat}
   * @param {object} handlers {onStart, onLeave, onCopy}
   */
  showRoomPanel(data, handlers = {}) {
    this._removeModal();
    this.roomHandlers = handlers;
    const mask = this._mask();
    const modal = document.createElement('div');
    modal.className = 'modal room-modal';
    modal.id = 'room-panel';
    modal.innerHTML = `
      <h2>房间 <span class="room-code">${escapeHtml(data.roomId)}</span></h2>
      <div class="sub">${data.rules ? data.rules.name : '自定义'} · ${data.rules ? describeRules(data.rules) : ''}</div>
      <div class="room-players" id="room-players"></div>
      <div class="modal-actions">
        <button class="btn ghost" id="btn-home-from-room">⌂ 主菜单</button>
        <button class="btn ghost" id="btn-leave-room">离开</button>
        <button class="btn ghost" id="btn-copy-room">复制房间码</button>
        <button class="btn primary" id="btn-start-room">开始对局</button>
      </div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    this.updateRoomPanel(data);

    modal.querySelector('#btn-home-from-room').addEventListener('click', () => {
      if (this.homeHandler) this.homeHandler();
      else if (window.confirm('确定返回主菜单吗？')) { this._removeModal(); window.location.reload(); }
    });
    modal.querySelector('#btn-leave-room').addEventListener('click', () => handlers.onLeave && handlers.onLeave());
    modal.querySelector('#btn-copy-room').addEventListener('click', () => handlers.onCopy && handlers.onCopy(data.roomId));
    modal.querySelector('#btn-start-room').addEventListener('click', () => handlers.onStart && handlers.onStart());
  }

  updateRoomPanel(data) {
    const host = document.querySelector('#room-players');
    if (!host) return;
    const mySeat = data.mySeat ?? null;
    const isHost = mySeat !== null && mySeat === data.hostSeat;
    host.innerHTML = data.players.map((p) => {
      if (!p) return '<div class="room-player empty">空位（电脑补位）</div>';
      const tags = [];
      if (p.seat === data.hostSeat) tags.push('房主');
      if (p.seat === mySeat) tags.push('我');
      if (p.isBot) tags.push('电脑');
      else if (!p.connected) tags.push('离线');
      return `<div class="room-player">
        <span class="seat-tag">${WINDS[p.seat]}</span>
        <span class="p-name">${escapeHtml(p.name)}</span>
        ${tags.map((t) => `<span class="mini-tag">${t}</span>`).join('')}
      </div>`;
    }).join('');

    const startBtn = document.querySelector('#btn-start-room');
    if (startBtn) {
      startBtn.style.display = isHost ? '' : 'none';
    }
  }

  closeLobbyModal() {
    this._removeModal();
  }
}
