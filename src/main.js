/**
 * 入口：单机 / 联机双模式。
 *
 * 单机：GameController → 本地 MahjongEngine
 * 联机：NetworkGameController → 服务器权威 MahjongEngine（公网）
 *
 * 两种模式共用：TableRenderer（画面）、GameUI（设置/结算/操作）、SOUNDS。
 * 联网时客户端不裁决任何规则，只发送 ACTION、接收 sync/event/prompt。
 */

import { MahjongEngine } from './core/engine.js';
import { BotPlayer } from './core/bots.js';
import { TableRenderer } from './render/renderer.js';
import { GameUI } from './ui/ui.js';
import { SOUNDS, isSoundEnabled } from './ui/audio.js';
import { describeRules } from './core/rules.js';
import { tileName } from './core/tiles.js';
import { ACTIONS } from './core/protocol.js';
import { NetworkClient } from './net/network.js';

const HUMAN_SEAT = 0;
const SEAT_LABELS = ['你', '下家', '对家', '上家'];
// 机器人出牌速度档位（顶栏可选，默认慢速）
const SPEED_DELAYS = {
  slow: { min: 3000, max: 10000 },
  normal: { min: 1500, max: 3000 },
  fast: { min: 600, max: 1200 },
};
const IS_TOUCH = new URLSearchParams(location.search).has('touch') ||
  (navigator.maxTouchPoints > 0) ||
  (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  'ontouchstart' in window;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function currentSpeed() {
  try { return localStorage.getItem('mahjong-speed') || 'slow'; } catch { return 'slow'; }
}
function randDelay(f = 1) {
  const d = SPEED_DELAYS[currentSpeed()] || SPEED_DELAYS.slow;
  return d.min + Math.random() * (d.max - d.min) * f;
}

function playEventSounds(evt) {
  switch (evt.type) {
    case 'discard': SOUNDS.click(); break;
    case 'draw': case 'replacement-draw': SOUNDS.draw(); break;
    case 'meld': SOUNDS.meld(); break;
    case 'an-gang': case 'bu-gang': SOUNDS.gang(); break;
    case 'win': SOUNDS.win(); break;
    case 'error': SOUNDS.error(); break;
    default: break;
  }
}

function seatLabel(viewSeat, seat) {
  return SEAT_LABELS[(seat - viewSeat + 4) % 4];
}

/** 事件 → 音效 + 中央特效提示（本地/联机共用） */
function processGameEvent(evt, viewSeat, ui) {
  playEventSounds(evt);
  const label = seatLabel(viewSeat, evt.seat);
  switch (evt.type) {
    case 'discard':
      ui.showActionFlash(`${label} 打出 ${tileName(evt.tile)}`, 'discard', '打');
      break;
    case 'meld': {
      const m = evt.meld || {};
      const kind = m.type === 'pong' ? '碰' : m.type === 'chi' ? '吃' : '杠';
      ui.showActionFlash(`${label} ${kind} ${tileName((m.tiles || [])[0])}`, 'meld', kind);
      break;
    }
    case 'an-gang':
      ui.showActionFlash(`${label} 暗杠 ${tileName(evt.tile)}`, 'gang', '杠');
      break;
    case 'bu-gang':
      ui.showActionFlash(`${label} 补杠 ${tileName(evt.tile)}`, 'gang', '杠');
      break;
    case 'win':
      ui.showActionFlash(`${label} 胡牌！`, 'win', '胡');
      break;
    case 'claim-open':
      if (evt.kind === 'robGang') ui.toast('有人补杠，可抢杠胡！', 1800);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 触控手牌输入：手机端“点选 + 确认”，电脑端直接点出                    */
/* ------------------------------------------------------------------ */

class HandInput {
  constructor(ui, submit, renderer) {
    this.ui = ui;
    this.submit = submit;
    this.renderer = renderer;
    this.selected = null;
    this._handler = null;
    this.touch = IS_TOUCH;
  }

  attach() {
    const hand = document.querySelector('#hand');
    if (!hand) return;
    if (this._handler) hand.removeEventListener('click', this._handler);
    this._handler = (e) => {
      const tileEl = e.target.closest('.tile-big');
      if (!tileEl) return;
      const tile = Number(tileEl.dataset.tile);
      if (!this.touch) {
        this.submit(tile);
        return;
      }
      if (this.selected === tile) {
        this.clearSelection();
        this.submit(tile);
      } else {
        this.selected = tile;
        this.markSelected();
        this.ui.updateTouchConfirm(true);
      }
    };
    hand.addEventListener('click', this._handler);
    this.markSelected();
  }

  markSelected() {
    document.querySelectorAll('#hand .tile-big.selected').forEach((el) => el.classList.remove('selected'));
    if (this.selected !== null) {
      document.querySelectorAll(`#hand .tile-big[data-tile="${this.selected}"]`).forEach((el) => el.classList.add('selected'));
    }
  }

  clearSelection() {
    this.selected = null;
    document.querySelectorAll('#hand .tile-big.selected').forEach((el) => el.classList.remove('selected'));
    this.ui.updateTouchConfirm(false);
  }

  /** 渲染后调用：若选中的牌已不在手牌则清除 */
  refresh(handTiles) {
    if (this.selected !== null && !handTiles.includes(this.selected)) this.clearSelection();
  }
}

/* ------------------------------------------------------------------ */
/* 本地单机控制器                                                       */
/* ------------------------------------------------------------------ */

class LocalGameController {
  constructor(ui, renderer, onExit = null) {
    this.ui = ui;
    this.renderer = renderer;
    this.onExit = onExit;
    this.engine = null;
    this.bots = [0, 1, 2, 3].map((seat) => new BotPlayer(seat, { rng: Math.random }));
    this.busy = false;
    this.handInput = new HandInput(ui, (tile) => this.submit({ type: ACTIONS.DISCARD, seat: HUMAN_SEAT, tile }), renderer);
  }

  stop() {
    this.engine = null;
    this.ui.setActions(null);
    this.handInput.clearSelection();
  }

  startNewGame(rules) {
    this.engine = new MahjongEngine(rules, { seed: Math.floor(Math.random() * 0x7fffffff), humanSeat: HUMAN_SEAT });
    const res = this.engine.startHand();
    if (!res.ok) { this.ui.toast(res.error, 3000); return; }
    this.ui.setRuleChip(`${rules.name || '自定义'} · ${describeRules(rules)}`);
    this._applyEvents(res.events);
    this._tick();
  }

  nextHand() {
    if (!this.engine) return;
    const dealer = this.engine.suggestNextDealer();
    const res = this.engine.startHand({ dealerSeat: dealer });
    if (!res.ok) { this.ui.toast(res.error, 3000); return; }
    this._applyEvents(res.events);
    this._tick();
  }

  submit(action) {
    if (!this.engine || this.busy) return;
    this.ui.setActions(null);
    this.handInput.clearSelection();
    const res = this.engine.take(action);
    this._applyEvents(res.events);
    if (!res.ok) this.ui.toast(res.error, 2400);
    this._tick();
  }

  async _tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.engine) {
        const state = this.engine.state;
        if (state.status === 'finished') {
          this._render();
          await sleep(650);
          const opts = {
            altText: '⌂ 主菜单',
            onAlt: () => { this.stop(); if (this.onExit) this.onExit(); },
          };
          if (state.drawGame) this.ui.showDrawGame(state, HUMAN_SEAT, opts);
          else this.ui.showResult(state, HUMAN_SEAT, opts);
          break;
        }
        const pending = this.engine.pending;
        if (pending.phase === 'turn') {
          const seat = pending.seat;
          if (seat === HUMAN_SEAT) {
            const options = this.engine.getTurnOptions(seat);
            this._render();
            this.ui.setActions({ kind: 'turn', seat, options, touchMode: this.handInput.touch, onTouchConfirm: () => {
              if (this.handInput.selected !== null) {
                const tile = this.handInput.selected;
                this.handInput.clearSelection();
                this.submit({ type: ACTIONS.DISCARD, seat: HUMAN_SEAT, tile });
              }
            } }, (act) => this.submit(act));
            break;
          }
          // 机器人行动前停顿，方便看清上一家的出牌与副露
          await sleep(randDelay());
          const options = this.engine.getTurnOptions(seat);
          const act = this.bots[seat].decideTurn(state, options);
          const res = this.engine.take(act);
          this._applyEvents(res.events);
          if (!res.ok) { this.ui.toast(`机器人动作异常：${res.error}`, 2500); break; }
        } else if (pending.phase === 'claim') {
          let humanPrompted = false;
          for (const seat of pending.seats) {
            const options = this.engine.getClaimOptions(seat, pending.tile, pending.from, pending.kind);
            if (seat === HUMAN_SEAT && options.length) {
              this._render();
              this.ui.setActions({ kind: 'claim', seat, options, claim: { tile: pending.tile, from: pending.from, kind: pending.kind } }, (act) => this.submit(act));
              humanPrompted = true;
              break;
            }
            const act = seat === HUMAN_SEAT ? { type: ACTIONS.PASS, seat } : this.bots[seat].decideClaim(state, seat, options);
            const res = this.engine.take(act);
            this._applyEvents(res.events);
            if (!res.ok) { this.ui.toast(`响应异常：${res.error}`, 2500); break; }
            await sleep(randDelay(0.6));
          }
          if (humanPrompted) break;
          if (this.engine.pending.phase === 'claim') continue;
        } else if (pending.phase === 'idle') {
          break;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  _applyEvents(events) {
    if (!this.engine) return;
    let last = null;
    for (const evt of events) {
      last = evt;
      processGameEvent(evt, HUMAN_SEAT, this.ui);
    }
    this._render(last);
  }

  _render(lastEvent = null) {
    if (!this.engine) return;
    this.renderer.render(this.engine.state, { humanSeat: HUMAN_SEAT, lastEvent });
    this.handInput.refresh(this.engine.state.players[HUMAN_SEAT].concealed);
    this.handInput.attach();
  }
}

/* ------------------------------------------------------------------ */
/* 联机控制器（公网）                                                   */
/* ------------------------------------------------------------------ */

class NetworkGameController {
  constructor(ui, renderer, onBackToModes) {
    this.ui = ui;
    this.renderer = renderer;
    this.onBackToModes = onBackToModes;
    this.roomId = null;
    this.sessionId = null;
    this.seat = null;
    this.playerName = '';
    this.state = null;
    this.resultShownForHand = -1;
    this.exitToModes = false;
    this.net = new NetworkClient({
      onOpen: () => this._onOpen(),
      onMessage: (msg) => this._onMessage(msg),
      onClose: () => this._onClose(),
      onStatus: (s) => this._onStatus(s),
    });
    this.handInput = new HandInput(ui, (tile) => this.sendAction({ type: ACTIONS.DISCARD, seat: this.seat, tile }), renderer);
  }

  enterLobby() {
    this.net.connect();
    this.ui.showOnlineLobby({
      onCreate: (name, rules) => {
        if (!this.net.isOnline) {
          this.ui.toast('服务器还没连上，正在自动重连…请稍后再点', 2600);
          this.net.connect();
          return;
        }
        this.playerName = name;
        this.net.send({ type: 'create-room', name, rules });
      },
      onJoin: (code, name) => {
        if (!this.net.isOnline) {
          this.ui.toast('服务器还没连上，正在自动重连…请稍后再点', 2600);
          this.net.connect();
          return;
        }
        this.playerName = name;
        this._restoreSession();
        this.net.send({ type: 'join-room', roomId: code, name, sessionId: this.sessionId });
      },
      onBack: () => {
        this.net.disconnect();
        this.onBackToModes();
      },
    });
    this._updateLobbyStatus(this.net.status);
  }

  _updateLobbyStatus(status) {
    if (!document.querySelector('#net-status')) return;
    if (status === 'online') this.ui.updateLobbyStatus('服务器已连接，可以建房 / 加入', 'online');
    else if (status === 'reconnecting') this.ui.updateLobbyStatus('连接断开，自动重连中…', 'reconnecting');
    else this.ui.updateLobbyStatus('正在连接服务器…', 'connecting');
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem('mahjong-online-session');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.roomId) { this.roomId = data.roomId; this.sessionId = data.sessionId; }
      }
    } catch { /* ignore */ }
  }

  _saveSession() {
    try {
      localStorage.setItem('mahjong-online-session', JSON.stringify({ roomId: this.roomId, sessionId: this.sessionId, name: this.playerName }));
    } catch { /* ignore */ }
  }

  _clearSession() {
    try { localStorage.removeItem('mahjong-online-session'); } catch { /* ignore */ }
    this.roomId = null;
    this.sessionId = null;
    this.seat = null;
  }

  _onOpen() {
    if (this.roomId && this.sessionId) {
      this.net.send({ type: 'join-room', roomId: this.roomId, sessionId: this.sessionId, name: this.playerName });
    }
  }

  _onClose() {
    this.ui.toast('连接断开，正在自动重连…', 2600);
    this._renderChip();
  }

  _onStatus(status) {
    this._renderChip(status);
    this._updateLobbyStatus(status);
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'joined': {
        this.roomId = msg.roomId;
        this.sessionId = msg.sessionId;
        this.seat = msg.seat;
        this._saveSession();
        this.ui.setRuleChip(`房间 ${msg.roomId} · 联机`);
        if (msg.phase === 'playing') {
          // 断线重连：不打断牌桌，等待 sync 快照
          this.ui.closeLobbyModal();
        } else {
          this.ui.showRoomPanel({
            roomId: msg.roomId,
            hostSeat: msg.hostSeat,
            phase: msg.phase,
            rules: msg.rules,
            players: msg.players,
            mySeat: this.seat,
          }, {
            onStart: () => this.net.send({ type: 'start' }),
            onLeave: () => this.leaveRoom(),
            onCopy: (code) => this._copyRoomCode(code),
          });
        }
        break;
      }
      case 'room-update': {
        if (this.roomId) {
          this.ui.updateRoomPanel({
            roomId: this.roomId,
            hostSeat: msg.hostSeat,
            phase: msg.phase,
            rules: msg.rules,
            players: msg.players,
            mySeat: this.seat,
          });
          if (msg.phase === 'playing') this.ui.closeLobbyModal();
        }
        break;
      }
      case 'sync': {
        this.state = msg.state;
        if (msg.yourSeat !== undefined) this.seat = msg.yourSeat;
        let last = null;
        for (const evt of msg.events || []) {
          last = evt;
          processGameEvent(evt, this.seat ?? 0, this.ui);
          if (evt.type === 'hand-start') this.resultShownForHand = -1;
        }
        this._render(last);
        this._maybeShowResult();
        break;
      }
      case 'prompt': {
        const prompt = {
          kind: msg.kind,
          seat: msg.seat,
          options: msg.options || [],
          claim: msg.claim,
          touchMode: this.handInput.touch,
          onTouchConfirm: () => {
            if (this.handInput.selected !== null) {
              const tile = this.handInput.selected;
              this.handInput.clearSelection();
              this.sendAction({ type: ACTIONS.DISCARD, seat: this.seat, tile });
            }
          },
        };
        this.ui.setActions(prompt, (act) => this.sendAction(act));
        break;
      }
      case 'error':
        this.ui.toast(msg.message || '服务器错误', 2600);
        break;
      case 'left':
        this._clearSession();
        this.ui.closeLobbyModal();
        this.ui.setRuleChip('未开局');
        if (this.exitToModes) {
          this.exitToModes = false;
          this.net.disconnect();
          this.onBackToModes();
        } else {
          this.enterLobby();
        }
        break;
      default:
        break;
    }
  }

  sendAction(action) {
    this.ui.setActions(null);
    this.handInput.clearSelection();
    this.net.send({ type: 'action', action });
  }

  leaveRoom() {
    this.exitToModes = true;
    if (this.roomId) {
      this.net.send({ type: 'leave-room' });
    } else {
      this.net.disconnect();
      this.onBackToModes();
    }
  }

  _copyRoomCode(code) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code);
        this.ui.toast('房间码已复制', 1500);
      } else {
        this.ui.toast(`房间码：${code}`, 2500);
      }
    } catch {
      this.ui.toast(`房间码：${code}`, 2500);
    }
  }

  _renderChip(status = this.net.status) {
    if (!this.roomId) return;
    const text = status === 'online' ? `房间 ${this.roomId} · 在线` : `房间 ${this.roomId} · 重连中…`;
    this.ui.setRuleChip(text);
  }

  _render(lastEvent = null) {
    if (!this.state) return;
    this.renderer.render(this.state, { humanSeat: this.seat ?? 0, lastEvent });
    const hand = this.state.players[this.seat ?? 0]?.concealed || [];
    this.handInput.refresh(hand);
    this.handInput.attach();
  }

  _maybeShowResult() {
    if (!this.state || this.state.status !== 'finished') return;
    if (this.resultShownForHand === this.state.handIndex) return;
    this.resultShownForHand = this.state.handIndex;
    const seat = this.seat ?? 0;
    setTimeout(() => {
      if (this.state && this.state.status === 'finished' && this.resultShownForHand === this.state.handIndex) {
        const opts = {
          nextText: '关闭（下一局自动开始）',
          altText: '离开房间',
          onNext: () => { /* 服务器会自动开下一局 */ },
          onAlt: () => this.leaveRoom(),
        };
        if (this.state.drawGame) this.ui.showDrawGame(this.state, seat, opts);
        else this.ui.showResult(this.state, seat, opts);
      }
    }, 600);
  }
}

/* ------------------------------------------------------------------ */
/* 应用装配                                                             */
/* ------------------------------------------------------------------ */

class App {
  constructor() {
    this.ui = new GameUI();
    this.renderer = new TableRenderer();
    this.local = new LocalGameController(this.ui, this.renderer, () => this.showModeSelect());
    this.network = new NetworkGameController(this.ui, this.renderer, () => this.showModeSelect());
    this.mode = null;

    this.ui.bind({
      onStartRule: (rules) => { this.mode = 'local'; this.local.startNewGame(rules); },
      onNextHand: () => this.local.nextHand(),
      onNewSettings: () => this.showModeSelect(),
      onHome: () => this.homeToModes(),
      onSettings: () => {
        if (this.mode === 'online' && this.network.roomId) {
          this.ui.showRoomPanel({
            roomId: this.network.roomId,
            hostSeat: 0,
            phase: this.statePhase(),
            rules: this.network.state?.rules || null,
            players: this.network.state ? this.network.state.players.map((p) => p && ({ seat: p.seat, name: p.name, isBot: false, connected: true })) : [],
            mySeat: this.network.seat ?? 0,
          }, {
            onStart: () => this.network.net.send({ type: 'start' }),
            onLeave: () => this.network.leaveRoom(),
            onCopy: (code) => this.network._copyRoomCode(code),
          });
        } else {
          this.ui.showSettings();
        }
      },
    });

    const soundBtn = document.querySelector('#btn-sound');
    if (soundBtn) soundBtn.textContent = isSoundEnabled() ? '🔊' : '🔇';
    this.showModeSelect();
  }

  statePhase() {
    return this.network.state ? 'playing' : 'lobby';
  }

  showModeSelect() {
    this.ui.showModeSelect({
      onLocal: () => { this.mode = 'local'; this.ui.showSettings(); },
      onOnline: () => { this.mode = 'online'; this.network.enterLobby(); },
    });
  }

  /** 任意界面返回主菜单：停止本地对局 / 离开联机房间 */
  homeToModes() {
    const localPlaying = this.local.engine && this.local.engine.state.status === 'playing';
    const netPlaying = this.network.state && this.network.state.status === 'playing';
    if ((localPlaying || netPlaying) && !window.confirm('对局进行中，确定退出并返回主菜单吗？')) return;
    this.ui._removeModal();
    this.ui.setActions(null);
    this.local.stop();
    this.network.leaveRoom();
    this.mode = null;
    this.showModeSelect();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new App();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 离线缓存失败不影响游戏 */ });
  }
});
