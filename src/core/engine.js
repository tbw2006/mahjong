/**
 * MahjongEngine —— 权威麻将状态机（联网预留的核心）。
 *
 * 设计原则：
 *   1. 引擎不依赖 DOM / 浏览器 API，可在 Node 服务器中直接运行；
 *   2. 外部只能通过 take(action) 修改状态，所有规则校验都在引擎内完成；
 *   3. take() 返回可 JSON 序列化的 EVENTS，未来联网时这些事件就是服务器广播；
 *   4. 状态可通过 exportState() / importState() 完整序列化（断线重连、录像回放）。
 *
 * 动作（ACTION）与事件（EVENT）的字段定义见 src/core/protocol.js 与
 * docs/NETWORK_PROTOCOL.md。
 */

import { ACTIONS, EVENTS, event } from './protocol.js';
import {
  buildTileSet, countTiles, removeOne, laiziFromIndicator, isSequence, suitOf,
} from './tiles.js';
import { analyzeWin, canWinShape } from './scoring.js';
import { SCORING_SETS } from './rules.js';

/* ------------------------------------------------------------------ */
/* 随机数（可播种 → 服务器可用同种子复现整局）                         */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* 引擎                                                                 */
/* ------------------------------------------------------------------ */

export class MahjongEngine {
  /**
   * @param {object} rules 规则集（来自 rules.js 的 normalizeRules）
   * @param {object} [opts] {seed, rng, humanSeat}
   */
  constructor(rules, opts = {}) {
    this.rules = rules;
    this.seed = opts.seed ?? (Date.now() % 2147483647);
    this.rng = opts.rng || mulberry32(this.seed);
    this.humanSeat = opts.humanSeat ?? 0;
    this.state = this._blankState();
    this.log = [];
  }

  _blankState() {
    const players = [];
    const relNames = ['你', '下家', '对家', '上家'];
    for (let seat = 0; seat < 4; seat++) {
      players.push({
        seat,
        name: relNames[(seat - this.humanSeat + 4) % 4],
        isHuman: seat === this.humanSeat,
        concealed: [],
        melds: [],
        score: 0,
        hasDrawn: false,
        discardCount: 0,
      });
    }
    return {
      ruleId: this.rules.id || 'custom',
      rules: this.rules,
      status: 'idle', // idle | playing | finished
      handIndex: -1,
      dealerSeat: 0,
      prevailingWind: 0, // 0东 1南 2西 3北
      wall: [],
      indicator: null,
      laizi: this.rules.laiziCount > 0 ? [] : [],
      discardPool: [], // {tile, seat, removed}
      players,
      currentSeat: 0,
      drawnTile: null,
      lastDiscard: null,
      claim: null, // {kind, tile, from, responses:{seat->action}, seats:[]}
      mustDiscard: false,
      lastDrawWasReplacement: false,
      turnCount: 0,
      winInfo: null, // {winnerSeat, tile, source, analysis, payments}
      drawGame: false,
      finishedAt: null,
    };
  }

  /* ---------------- 事件 ---------------- */

  _push(type, payload = {}, visibleTo = null) {
    const evt = event(type, payload, visibleTo);
    this.log.push(evt);
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    return evt;
  }

  /* ---------------- 开局 ---------------- */

  /**
   * 开始新的一局（保留累计分）。
   * @param {object} [opts] {dealerSeat}
   */
  startHand({ dealerSeat = null } = {}) {
    const s = this.state;
    if (s.status === 'playing') return { ok: false, error: '对局进行中，无法重新发牌', events: [] };

    const dealer = dealerSeat ?? (s.handIndex < 0 ? 0 : (s.dealerSeat + 1) % 4);
    s.handIndex += 1;
    s.dealerSeat = dealer;
    s.prevailingWind = Math.floor(Math.max(0, s.handIndex) / 4) % 4;
    s.wall = shuffled(
      buildTileSet({
        suits: this.rules.suits,
        dragons: this.rules.dragons,
        winds: this.rules.winds,
        copies: this.rules.copies,
      }),
      this.rng,
    );
    s.indicator = null;
    s.laizi = [];
    s.discardPool = [];
    s.claim = null;
    s.drawnTile = null;
    s.lastDiscard = null;
    s.mustDiscard = false;
    s.lastDrawWasReplacement = false;
    s.turnCount = 0;
    s.winInfo = null;
    s.drawGame = false;
    s.finishedAt = null;

    for (const p of s.players) {
      p.concealed = [];
      p.melds = [];
      p.hasDrawn = false;
      p.discardCount = 0;
    }

    // 发牌：庄家起 13 张，其余各家 13 张（庄家随后先摸）
    for (let round = 0; round < 13; round++) {
      for (let k = 0; k < 4; k++) {
        const seat = (dealer + k) % 4;
        s.players[seat].concealed.push(s.wall.shift());
      }
    }

    // 翻癞子指示牌
    if (this.rules.laiziCount > 0 && s.wall.length > 0) {
      s.indicator = s.wall.pop();
      s.laizi = laiziFromIndicator(s.indicator, this.rules.laiziCount);
    }

    s.status = 'playing';
    s.currentSeat = dealer;
    const events = [
      this._push(EVENTS.HAND_START, { handIndex: s.handIndex, dealerSeat: dealer, prevailingWind: s.prevailingWind }),
      this._push(EVENTS.DEAL, { hands: s.players.map((p) => p.concealed.length) }),
    ];
    if (s.indicator !== null) {
      events.push(this._push(EVENTS.INDICATOR, { indicator: s.indicator, laizi: s.laizi.slice() }));
    }
    const turnEvents = this._startTurn();
    events.push(...turnEvents);
    return { ok: true, events };
  }

  _startTurn() {
    const s = this.state;
    if (s.wall.length === 0) {
      s.status = 'finished';
      s.drawGame = true;
      s.finishedAt = new Date().toISOString();
      return [
        this._push(EVENTS.DRAW_GAME, { seat: s.currentSeat }),
        this._push(EVENTS.HAND_OVER, { drawGame: true }),
      ];
    }
    const seat = s.currentSeat;
    const tile = s.wall.shift();
    const player = s.players[seat];
    player.concealed.push(tile);
    player.hasDrawn = true;
    s.drawnTile = tile;
    s.mustDiscard = true;
    s.lastDrawWasReplacement = false;
    s.turnCount += 1;
    return [
      this._push(EVENTS.TURN, { seat, turnCount: s.turnCount }),
      this._push(EVENTS.DRAW, { seat, tile, remaining: s.wall.length }, [seat]),
    ];
  }

  _replacementDraw(seat) {
    const s = this.state;
    if (s.wall.length === 0) {
      s.drawnTile = null;
      s.mustDiscard = true;
      s.lastDrawWasReplacement = true;
      return [this._push(EVENTS.REPLACEMENT_DRAW, { seat, tile: null, remaining: 0 }, [seat])];
    }
    const tile = s.wall.pop();
    s.players[seat].concealed.push(tile);
    s.drawnTile = tile;
    s.mustDiscard = true;
    s.lastDrawWasReplacement = true;
    return [this._push(EVENTS.REPLACEMENT_DRAW, { seat, tile, remaining: s.wall.length }, [seat])];
  }

  /* ---------------- 序列化 ---------------- */

  exportState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  importState(state) {
    if (!state || !Array.isArray(state.players) || state.players.length !== 4) {
      throw new Error('无效的对局状态');
    }
    this.state = JSON.parse(JSON.stringify(state));
    if (this.state.rules) this.rules = this.state.rules;
    return this;
  }

  /* ---------------- 查询 ---------------- */

  get pending() {
    const s = this.state;
    if (s.status === 'finished') return { phase: 'finished' };
    if (s.status !== 'playing') return { phase: 'idle' };
    if (s.claim) {
      const seats = [];
      const from = s.claim.from;
      for (let d = 1; d <= 3; d++) {
        const seat = (from + d) % 4;
        if (!s.claim.responses[seat]) seats.push(seat);
      }
      return { phase: 'claim', kind: s.claim.kind, tile: s.claim.tile, from, seats };
    }
    return { phase: 'turn', seat: s.currentSeat };
  }

  /** 当前行动玩家的可选动作（用于 UI 按钮与机器人决策） */
  getTurnOptions(seat) {
    const s = this.state;
    const empty = { canHu: false, anGang: [], buGang: [], discard: [] };
    if (s.status !== 'playing' || s.claim || s.currentSeat !== seat) return empty;
    const player = s.players[seat];
    const opts = {
      canHu: false,
      anGang: [],
      buGang: [],
      discard: [...new Set(player.concealed)].sort((a, b) => a - b),
    };
    const analysis = s.drawnTile !== null ? this._analyzeSelfDraw(seat) : null;
    if (analysis && analysis.meetsMinimum) {
      opts.canHu = true;
      opts.huAnalysis = analysis;
    }
    const counts = countTiles(player.concealed);
    for (let tile = 0; tile < 34; tile++) {
      if (counts[tile] >= 4 && this.rules.allowGang && this._gangTileAllowed(tile)) {
        opts.anGang.push(tile);
      }
    }
    if (this.rules.allowGang) {
      for (const m of player.melds) {
        if (m.type === 'pong' && player.concealed.includes(m.tiles[0]) && this._gangTileAllowed(m.tiles[0])) {
          opts.buGang.push(m.tiles[0]);
        }
      }
    }
    return opts;
  }

  /** 某玩家对某张外露牌的可行响应 */
  getClaimOptions(seat, tile, from, kind = 'discard') {
    const s = this.state;
    const opts = [];
    if (s.status !== 'playing') return opts;
    const player = s.players[seat];
    const counts = countTiles(player.concealed);

    const pushHu = () => {
      const concealed = player.concealed.concat([tile]);
      const analysis = analyzeWin({
        concealed,
        melds: player.melds,
        laizi: s.laizi,
        winningTile: tile,
        ctx: this._ctxFor(seat, false, false, this._isDiHu(seat, from), kind === 'robGang', this._isQuanQiuRen(seat, concealed), from),
        rules: this.rules,
      });
      if (analysis.winning && analysis.meetsMinimum) {
        opts.push({ claim: 'hu', analysis });
      }
    };
    pushHu();

    if (kind === 'robGang') return opts;

    if (this.rules.allowPong && counts[tile] >= 2) opts.push({ claim: 'pong' });
    if (this.rules.allowGang && counts[tile] >= 3 && this._gangTileAllowed(tile)) opts.push({ claim: 'gang' });
    if (this.rules.allowChi && seat === (from + 1) % 4 && suitOf(tile) < 3) {
      const r = rankAt(tile);
      const starts = [r - 2, r - 1, r].filter((x) => x >= 1 && x + 2 <= 9);
      for (const st of starts) {
        const triple = [st, st + 1, st + 2];
        const need = triple.filter((x) => x !== r).map((x) => sameSuitTile(tile, x));
        const missing = need.filter((t) => !player.concealed.includes(t));
        if (missing.length > 0) {
          // 可用癞子补齐
          const wildAvailable = s.laizi.filter((lz) => counts[lz] > 0);
          if (wildAvailable.length < missing.length) continue;
        }
        const a = need[0];
        const b = need[1];
        opts.push({ claim: 'chi', tile, a, b });
      }
    }
    return opts;
  }

  _gangTileAllowed(tile) {
    return this.rules.allowLaiziGang || !this.state.laizi.includes(tile);
  }

  _analyzeSelfDraw(seat) {
    const s = this.state;
    const player = s.players[seat];
    return analyzeWin({
      concealed: player.concealed,
      melds: player.melds,
      laizi: s.laizi,
      winningTile: s.drawnTile,
      ctx: {
        isSelfDraw: true,
        isTianHu: s.turnCount === 1 && seat === s.dealerSeat,
        isDiHu: false,
        isLastWallTile: s.wall.length === 0,
        isGangReplacement: s.lastDrawWasReplacement,
        isRobGang: false,
        isMenQing: player.melds.every((m) => m.sub === 'an'),
        isQuanQiuRen: false,
        prevailingWind: s.prevailingWind,
        seatWind: (seat - s.dealerSeat + 4) % 4,
      },
      rules: this.rules,
    });
  }

  _ctxFor(seat, isSelfDraw, isTianHu, isDiHu, isRobGang, isQuanQiuRen, discarderSeat) {
    const s = this.state;
    return {
      isSelfDraw,
      isTianHu,
      isDiHu,
      isLastWallTile: s.wall.length === 0,
      isGangReplacement: s.lastDrawWasReplacement,
      isRobGang,
      isMenQing: s.players[seat].melds.every((m) => m.sub === 'an'),
      isQuanQiuRen,
      prevailingWind: s.prevailingWind,
      seatWind: (seat - s.dealerSeat + 4) % 4,
      discarderSeat,
    };
  }

  /* ---------------- 动作入口 ---------------- */

  take(action) {
    if (!action || typeof action.type !== 'string') {
      return { ok: false, error: '无效动作', events: [] };
    }
    try {
      switch (action.type) {
        case ACTIONS.RESET: return this._reset();
        case ACTIONS.START_HAND: return this.startHand({ dealerSeat: action.dealerSeat ?? null });
        case ACTIONS.DISCARD: return this._doDiscard(action);
        case ACTIONS.HU: return this._doHu(action);
        case ACTIONS.PONG: return this._doPong(action);
        case ACTIONS.CHI: return this._doChi(action);
        case ACTIONS.GANG: return this._doGang(action);
        case ACTIONS.AN_GANG: return this._doAnGang(action);
        case ACTIONS.BU_GANG: return this._doBuGang(action);
        case ACTIONS.PASS: return this._doPass(action);
        default: return { ok: false, error: `未知动作: ${action.type}`, events: [] };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err), events: [] };
    }
  }

  _reset() {
    this.state = this._blankState();
    this.log = [];
    return { ok: true, events: [this._push(EVENTS.GAME_OVER, { reset: true })] };
  }

  /* ---------------- 出牌 ---------------- */

  _doDiscard(action) {
    const s = this.state;
    const { seat, tile } = action;
    if (s.status !== 'playing' || s.claim) return this._err('当前不能出牌');
    if (seat !== s.currentSeat) return this._err('还没轮到该玩家');
    const player = s.players[seat];
    if (!player.concealed.includes(tile)) return this._err('手牌中没有这张牌');
    if (removeOne(player.concealed, tile) === null) return this._err('出牌失败');

    player.discardCount += 1;
    s.drawnTile = null;
    s.mustDiscard = false;
    s.lastDiscard = { tile, seat };
    const poolEntry = { tile, seat, removed: false };
    s.discardPool.push(poolEntry);

    const events = [this._push(EVENTS.DISCARD, { seat, tile })];
    const claimEvents = this._openClaim('discard', seat, tile, poolEntry);
    events.push(...claimEvents);
    return { ok: true, events };
  }

  _openClaim(kind, from, tile, poolEntry) {
    const s = this.state;
    const seats = [];
    for (let d = 1; d <= 3; d++) {
      const seat = (from + d) % 4;
      if (this.getClaimOptions(seat, tile, from, kind).length > 0) seats.push(seat);
    }
    if (!seats.length) {
      const events = [this._push(EVENTS.CLAIM_CLOSE, { kind, tile, from, none: true })];
      events.push(...this._advanceNext(from));
      return events;
    }
    s.claim = {
      kind,
      tile,
      from,
      poolEntry: poolEntry || null,
      responses: {},
      seats,
    };
    // 注意：seats 不进入广播事件（联网时避免泄露谁有牌可响应）
    return [this._push(EVENTS.CLAIM_OPEN, { kind, tile, from })];
  }

  _advanceNext(from) {
    const s = this.state;
    s.claim = null;
    s.lastDiscard = null;
    s.currentSeat = (from + 1) % 4;
    return this._startTurn();
  }

  /* ---------------- 响应阶段 ---------------- */

  _doPass(action) {
    const s = this.state;
    if (!s.claim) return this._err('当前没有可响应的牌');
    const { seat } = action;
    if (!this._canRespond(seat)) return this._err('该玩家无需响应或已响应');
    s.claim.responses[seat] = { type: ACTIONS.PASS };
    const events = [this._push(EVENTS.CLAIM_RESPONSE, { seat, action: 'pass' })];
    const resolved = this._maybeResolveClaim();
    events.push(...resolved);
    return { ok: true, events };
  }

  _canRespond(seat) {
    const s = this.state;
    if (!s.claim) return false;
    if (seat === s.claim.from) return false;
    return !s.claim.responses[seat];
  }

  _recordClaim(seat, action) {
    this.state.claim.responses[seat] = action;
    return this._push(EVENTS.CLAIM_RESPONSE, {
      seat,
      action: action.type === ACTIONS.HU ? 'hu' : action.claim || action.type,
    });
  }

  _maybeResolveClaim() {
    const s = this.state;
    if (!s.claim) return [];
    let unanswered = 0;
    for (let d = 1; d <= 3; d++) {
      const seat = (s.claim.from + d) % 4;
      if (!s.claim.responses[seat]) unanswered++;
    }
    if (unanswered > 0) return [];

    const responses = Object.entries(s.claim.responses).map(([seat, act]) => ({ seat: Number(seat), act }));
    const byDistance = (a, b) => {
      const da = (a.seat - s.claim.from + 4) % 4;
      const db = (b.seat - s.claim.from + 4) % 4;
      return da - db;
    };
    const huers = responses.filter((r) => r.act.type === ACTIONS.HU).sort(byDistance);
    if (huers.length) {
      const winner = huers[0];
      const events = [this._push(EVENTS.CLAIM_CLOSE, { kind: s.claim.kind, tile: s.claim.tile, from: s.claim.from, claimed: 'hu', seat: winner.seat })];
      events.push(...this._finishWin(winner.seat, s.claim.tile, s.claim.kind === 'robGang' ? 'robGang' : 'discard', s.claim.from, s.claim.kind === 'robGang'));
      return events;
    }

    const gangs = responses.filter((r) => r.act.type === ACTIONS.GANG).sort(byDistance);
    const pongs = responses.filter((r) => r.act.type === ACTIONS.PONG).sort(byDistance);
    const chis = responses.filter((r) => r.act.type === ACTIONS.CHI).sort(byDistance);
    let chosen = null;
    if (gangs.length) chosen = gangs[0];
    else if (pongs.length) chosen = pongs[0];
    else if (chis.length) chosen = chis[0];

    if (!chosen) {
      const events = [this._push(EVENTS.CLAIM_CLOSE, { kind: s.claim.kind, tile: s.claim.tile, from: s.claim.from, claimed: null })];
      if (s.claim.kind === 'robGang') {
        // 无人抢杠：杠家继续，补一张牌后出牌
        s.claim = null;
        s.currentSeat = from;
        events.push(...this._replacementDraw(from));
      } else {
        events.push(...this._advanceNext(s.claim.from));
      }
      return events;
    }
    const events = [this._push(EVENTS.CLAIM_CLOSE, {
      kind: s.claim.kind,
      tile: s.claim.tile,
      from: s.claim.from,
      claimed: chosen.act.type === ACTIONS.GANG ? 'gang' : chosen.act.type === ACTIONS.PONG ? 'pong' : 'chi',
      seat: chosen.seat,
    })];
    events.push(...this._applyClaim(chosen.seat, chosen.act));
    return events;
  }

  _applyClaim(seat, act) {
    const s = this.state;
    const player = s.players[seat];
    const tile = s.claim.tile;

    // 标记牌河中的被响应牌
    const entry = s.claim.poolEntry || [...s.discardPool].reverse().find((e) => !e.removed && e.tile === tile && e.seat === s.claim.from);
    if (entry) {
      entry.removed = true;
      entry.removedBy = act.type === ACTIONS.GANG ? 'gang' : act.type === ACTIONS.PONG ? 'pong' : 'chi';
    }

    let meld = null;
    if (act.type === ACTIONS.PONG) {
      removeOne(player.concealed, tile);
      removeOne(player.concealed, tile);
      meld = { type: 'pong', sub: 'exposed', tiles: [tile, tile, tile], from: s.claim.from };
    } else if (act.type === ACTIONS.GANG) {
      removeOne(player.concealed, tile);
      removeOne(player.concealed, tile);
      removeOne(player.concealed, tile);
      meld = { type: 'gang', sub: 'exposed', tiles: [tile, tile, tile, tile], from: s.claim.from };
    } else if (act.type === ACTIONS.CHI) {
      const combo = [tile, act.a, act.b].sort((a, b) => a - b);
      if (!isSequence(combo[0], combo[1], combo[2])) return this._err('不是合法顺子');
      // 逻辑顺子确定后，把缺失的牌用癞子实体代替
      const faceByRank = new Map();
      faceByRank.set(rankAt(tile), tile);
      for (const t of [act.a, act.b]) {
        if (removeOne(player.concealed, t) !== null) {
          faceByRank.set(rankAt(t), t);
        } else {
          let usedWild = null;
          for (const lz of s.laizi) {
            if (removeOne(player.concealed, lz) !== null) { usedWild = lz; break; }
          }
          if (usedWild === null) return this._err('手牌中没有吃牌所需的牌');
          faceByRank.set(rankAt(t), usedWild);
        }
      }
      const ordered = [...faceByRank.entries()].sort((a, b) => a[0] - b[0]).map(([, face]) => face);
      meld = { type: 'chi', sub: 'exposed', tiles: ordered, from: s.claim.from };
    } else {
      return this._err('非法响应动作');
    }

    player.melds.push(meld);
    s.claim = null;
    s.drawnTile = null;
    s.mustDiscard = true;
    s.currentSeat = seat;
    const events = [this._push(EVENTS.MELD, { seat, meld })];

    if (meld.type === 'gang') {
      const replacement = this._replacementDraw(seat);
      events.push(...replacement);
      // 杠上开花机会由 getTurnOptions 判定，UI 会提示胡牌
    }
    return events;
  }

  /* ---------------- 碰杠吃动作 ---------------- */

  _doPong(action) {
    const s = this.state;
    if (!s.claim || s.claim.kind !== 'discard') return this._err('当前不能碰');
    if (!this._canRespond(action.seat)) return this._err('该玩家不能响应');
    if (action.tile !== s.claim.tile) return this._err('碰的牌与响应牌不一致');
    const player = s.players[action.seat];
    if (!this.rules.allowPong) return this._err('本玩法不允许碰');
    const count = player.concealed.filter((t) => t === action.tile).length;
    if (count < 2) return this._err('手牌不足两张，不能碰');
    this._recordClaim(action.seat, { type: ACTIONS.PONG });
    const events = this._maybeResolveClaim();
    return { ok: true, events };
  }

  _doGang(action) {
    const s = this.state;
    if (!s.claim || s.claim.kind !== 'discard') return this._err('当前不能明杠');
    if (!this._canRespond(action.seat)) return this._err('该玩家不能响应');
    if (action.tile !== s.claim.tile) return this._err('杠的牌与响应牌不一致');
    const player = s.players[action.seat];
    if (!this.rules.allowGang || !this._gangTileAllowed(action.tile)) return this._err('本玩法不允许杠这张牌');
    if (player.concealed.filter((t) => t === action.tile).length < 3) return this._err('手牌不足三张，不能明杠');
    this._recordClaim(action.seat, { type: ACTIONS.GANG });
    const events = this._maybeResolveClaim();
    return { ok: true, events };
  }

  _doChi(action) {
    const s = this.state;
    if (!s.claim || s.claim.kind !== 'discard') return this._err('当前不能吃');
    if (!this._canRespond(action.seat)) return this._err('该玩家不能响应');
    if (!this.rules.allowChi) return this._err('本玩法不允许吃');
    if (action.seat !== (s.claim.from + 1) % 4) return this._err('只有下家可以吃');
    if (action.tile !== s.claim.tile) return this._err('吃的牌与响应牌不一致');
    const combo = [action.tile, action.a, action.b].sort((x, y) => x - y);
    if (!isSequence(combo[0], combo[1], combo[2])) return this._err('不是合法顺子');
    if (new Set(combo).size !== 3) return this._err('顺子三张不能相同');
    const player = s.players[action.seat];
    const held = player.concealed;
    const missing = [action.a, action.b].filter((t) => !held.includes(t));
    if (missing.length > 0) {
      const wildAvailable = s.laizi.reduce((sum, lz) => sum + held.filter((x) => x === lz).length, 0);
      if (wildAvailable < missing.length) return this._err('手牌中没有吃牌所需的牌');
    }
    this._recordClaim(action.seat, { type: ACTIONS.CHI, a: action.a, b: action.b, claim: 'chi' });
    const events = this._maybeResolveClaim();
    return { ok: true, events };
  }

  /* ---------------- 暗杠 / 补杠 ---------------- */

  _doAnGang(action) {
    const s = this.state;
    if (s.status !== 'playing' || s.claim || action.seat !== s.currentSeat) return this._err('当前不能暗杠');
    const player = s.players[action.seat];
    if (!this.rules.allowGang || !this._gangTileAllowed(action.tile)) return this._err('本玩法不允许暗杠这张牌');
    const count = player.concealed.filter((t) => t === action.tile).length;
    if (count < 4) return this._err('手牌不足四张，不能暗杠');

    for (let k = 0; k < 4; k++) removeOne(player.concealed, action.tile);
    const meld = { type: 'gang', sub: 'an', tiles: [action.tile, action.tile, action.tile, action.tile], from: null };
    player.melds.push(meld);
    s.drawnTile = null;
    const events = [this._push(EVENTS.AN_GANG, { seat: action.seat, tile: action.tile })];
    events.push(...this._replacementDraw(action.seat));
    return { ok: true, events };
  }

  _doBuGang(action) {
    const s = this.state;
    if (s.status !== 'playing' || s.claim || action.seat !== s.currentSeat) return this._err('当前不能补杠');
    const player = s.players[action.seat];
    if (!this.rules.allowGang || !this._gangTileAllowed(action.tile)) return this._err('本玩法不允许补杠这张牌');
    const meld = player.melds.find((m) => m.type === 'pong' && m.tiles[0] === action.tile);
    if (!meld) return this._err('没有对应的碰可以补杠');
    if (!player.concealed.includes(action.tile)) return this._err('手牌中没有第四张牌');

    removeOne(player.concealed, action.tile);
    meld.type = 'gang';
    meld.sub = 'bu';
    meld.tiles.push(action.tile);
    s.drawnTile = null;

    const events = [this._push(EVENTS.BU_GANG, { seat: action.seat, tile: action.tile })];
    // 抢杠：其他三家可胡这张补杠牌
    s.claim = { kind: 'robGang', tile: action.tile, from: action.seat, poolEntry: null, responses: {}, seats: [] };
    for (let d = 1; d <= 3; d++) {
      const seat = (action.seat + d) % 4;
      const opts = this.getClaimOptions(seat, action.tile, action.seat, 'robGang');
      if (opts.length) s.claim.seats.push(seat);
    }
    if (!s.claim.seats.length) {
      s.claim = null;
      events.push(...this._replacementDraw(action.seat));
      return { ok: true, events };
    }
    events.push(this._push(EVENTS.CLAIM_OPEN, { kind: 'robGang', tile: action.tile, from: action.seat }));
    return { ok: true, events };
  }

  /* ---------------- 胡牌 ---------------- */

  _doHu(action) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('当前不能胡牌');
    const { seat } = action;

    if (s.claim) {
      // 响应阶段：点炮胡 / 抢杠胡
      if (!this._canRespond(seat)) return this._err('该玩家不能响应');
      const tile = s.claim.tile;
      const kind = s.claim.kind;
      const concealed = s.players[seat].concealed.concat([tile]);
      const isRob = kind === 'robGang';
      const ctx = this._ctxFor(seat, false, false, this._isDiHu(seat, s.claim.from), isRob, this._isQuanQiuRen(seat, concealed), s.claim.from);
      const analysis = analyzeWin({ concealed, melds: s.players[seat].melds, laizi: s.laizi, winningTile: tile, ctx, rules: this.rules });
      if (!analysis.winning) return this._err('手牌未成胡牌形状');
      if (!analysis.meetsMinimum) return this._err(`番数不足（需 ${this.rules.minFan} 番起胡，当前 ${analysis.total} 番）`);
      this._recordClaim(seat, { type: ACTIONS.HU });
      const events = this._maybeResolveClaim();
      return { ok: true, events };
    }

    // 自摸胡
    if (seat !== s.currentSeat) return this._err('还没轮到该玩家');
    if (s.drawnTile === null) return this._err('当前无法自摸');
    const analysis = this._analyzeSelfDraw(seat);
    if (!analysis.winning) return this._err('手牌未成胡牌形状');
    if (!analysis.meetsMinimum) return this._err(`番数不足（需 ${this.rules.minFan} 番起胡，当前 ${analysis.total} 番）`);
    const events = this._finishWin(seat, s.drawnTile, 'selfDraw', null, false);
    return { ok: true, events };
  }

  _isDiHu(winnerSeat, discarderSeat) {
    const s = this.state;
    const winner = s.players[winnerSeat];
    const discarder = s.players[discarderSeat];
    return (
      winnerSeat !== s.dealerSeat &&
      !winner.hasDrawn &&
      discarderSeat === s.dealerSeat &&
      discarder.discardCount === 1
    );
  }

  _isQuanQiuRen(seat, concealed) {
    const s = this.state;
    const melds = s.players[seat].melds;
    return melds.length === 4 && melds.every((m) => m.sub !== 'an') && concealed.length === 2;
  }

  _finishWin(winnerSeat, tile, source, discarderSeat, isRobGang = false) {
    const s = this.state;
    const player = s.players[winnerSeat];
    const isSelfDraw = source === 'selfDraw';
    // 点炮/抢杠胡：那张牌不在赢家手牌里，需虚拟加入后判定
    const concealed = player.concealed.slice();
    if (!isSelfDraw) concealed.push(tile);
    const isTianHu = isSelfDraw && s.turnCount === 1 && winnerSeat === s.dealerSeat;
    const isDiHu = !isSelfDraw && this._isDiHu(winnerSeat, discarderSeat);
    const ctx = this._ctxFor(winnerSeat, isSelfDraw, isTianHu, isDiHu, isRobGang, this._isQuanQiuRen(winnerSeat, concealed), discarderSeat);

    const analysis = analyzeWin({
      concealed,
      melds: player.melds,
      laizi: s.laizi,
      winningTile: tile,
      ctx,
      rules: this.rules,
    });
    if (!analysis.winning) return this._err('胡牌判定失败');
    if (!analysis.meetsMinimum) return this._err(`番数不足（需 ${this.rules.minFan} 番起胡，当前 ${analysis.total} 番）`);

    const payments = this._computePayments(winnerSeat, analysis.scoreUnit, isSelfDraw, discarderSeat);
    for (const pay of payments) {
      s.players[pay.from].score -= pay.amount;
      s.players[pay.to].score += pay.amount;
    }

    s.winInfo = {
      winnerSeat,
      tile,
      source,
      discarderSeat,
      analysis: {
        kind: analysis.kind,
        fan: analysis.fan,
        total: analysis.total,
        scoreUnit: analysis.scoreUnit,
        multiplier: analysis.multiplier,
      },
      payments,
      revealedHand: concealed.slice(),
      melds: JSON.parse(JSON.stringify(player.melds)),
    };
    s.status = 'finished';
    s.finishedAt = new Date().toISOString();
    s.drawnTile = null;
    s.claim = null;

    const events = [
      this._push(EVENTS.WIN, {
        seat: winnerSeat,
        tile,
        source,
        kind: analysis.kind,
        fan: analysis.fan,
        total: analysis.total,
        scoreUnit: analysis.scoreUnit,
        multiplier: analysis.multiplier,
        payments,
        hand: concealed.slice(),
        melds: JSON.parse(JSON.stringify(player.melds)),
      }),
      this._push(EVENTS.SCORE, {
        scores: s.players.map((p) => ({ seat: p.seat, score: p.score })),
        payments,
      }),
      this._push(EVENTS.HAND_OVER, { winnerSeat, drawGame: false }),
    ];
    return events;
  }

  _computePayments(winnerSeat, unit, isSelfDraw, discarderSeat) {
    const s = this.state;
    const payments = [];
    let amount = unit;
    if (this.rules.dealerDouble && winnerSeat === s.dealerSeat) amount *= 2;

    if (isSelfDraw) {
      for (let seat = 0; seat < 4; seat++) {
        if (seat === winnerSeat) continue;
        let pay = amount;
        if (this.rules.dealerDouble && seat === s.dealerSeat) pay *= 2;
        payments.push({ from: seat, to: winnerSeat, amount: pay });
      }
    } else {
      if (discarderSeat === null || discarderSeat === winnerSeat) return [];
      let pay = amount;
      if (this.rules.dealerDouble && discarderSeat === s.dealerSeat) pay *= 2;
      payments.push({ from: discarderSeat, to: winnerSeat, amount: pay });
    }
    return payments;
  }

  /** 一局结束后建议的下一局庄家 */
  suggestNextDealer() {
    const s = this.state;
    if (s.drawGame) return this.rules.dealerStaysOnDraw ? s.dealerSeat : (s.dealerSeat + 1) % 4;
    if (s.winInfo && s.winInfo.winnerSeat === s.dealerSeat) {
      return this.rules.dealerStaysOnWin ? s.dealerSeat : (s.dealerSeat + 1) % 4;
    }
    return (s.dealerSeat + 1) % 4;
  }

  _err(message) {
    return { ok: false, error: message, events: [this._push(EVENTS.ERROR, { message })] };
  }
}

function rankAt(tile) {
  return (tile % 9) + 1;
}

function sameSuitTile(tile, rank) {
  return Math.floor(tile / 9) * 9 + rank - 1;
}
