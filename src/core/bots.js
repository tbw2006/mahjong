/**
 * 机器人 AI（中等强度，启发式 + 轻量随机）。
 *
 * 决策只依赖 state 快照与引擎给出的合法动作，返回标准 ACTION 对象，
 * 因此机器人不需要任何 UI，未来联网时同样可用于服务器托管席位。
 */

import { ACTIONS } from './protocol.js';
import { countTiles, suitOf, rankOf, isHonor } from './tiles.js';
import { canWinShape } from './scoring.js';

export class BotPlayer {
  constructor(seat, { level = 'normal', rng = Math.random } = {}) {
    this.seat = seat;
    this.level = level;
    this.rng = rng;
  }

  /**
   * 轮到自己时决策：胡 / 暗杠 / 补杠 / 出牌。
   */
  decideTurn(state, options) {
    if (!options) return null;
    if (options.canHu) return { type: ACTIONS.HU, seat: this.seat };
    const hand = state.players[this.seat].concealed;

    if (options.anGang.length) {
      const pick = this._pick(options.anGang);
      if (this._gangWorth(state, pick, 4, false)) {
        return { type: ACTIONS.AN_GANG, seat: this.seat, tile: pick };
      }
    }
    if (options.buGang.length) {
      const pick = this._pick(options.buGang);
      if (this._gangWorth(state, pick, 1, true)) {
        return { type: ACTIONS.BU_GANG, seat: this.seat, tile: pick };
      }
    }
    const discard = this.chooseDiscard(state);
    return discard;
  }

  /**
   * 有人舍牌 / 补杠时决策。
   * 核心思路：碰/杠/吃之后向听数不升（≤）才响应；吃牌选向听数改善最大的组合。
   */
  decideClaim(state, seat, options) {
    if (!options || !options.length) return { type: ACTIONS.PASS, seat };
    const hu = options.find((o) => o.claim === 'hu');
    if (hu) return { type: ACTIONS.HU, seat, tile: state.claim.tile };

    const hand = state.players[seat].concealed;
    const melds = state.players[seat].melds;
    const laizi = state.laizi;
    const tile = state.claim.tile;
    const before = calcShanten(hand, melds, laizi);

    const simAfter = (removeReal, addMeld) => {
      const arr = hand.slice();
      for (let i = 0; i < removeReal; i++) {
        const idx = arr.indexOf(tile);
        if (idx >= 0) arr.splice(idx, 1);
        else {
          // 缺牌用癞子顶上
          const wildIdx = arr.findIndex((t) => laizi.includes(t));
          if (wildIdx < 0) return 99;
          arr.splice(wildIdx, 1);
        }
      }
      return calcShanten(arr, melds.concat([addMeld]), laizi);
    };

    const gang = options.find((o) => o.claim === 'gang');
    if (gang) {
      const after = simAfter(3, { type: 'gang', sub: 'exposed', tiles: [tile, tile, tile, tile], from: state.claim.from });
      if (after <= before) return { type: ACTIONS.GANG, seat, tile };
    }
    const pong = options.find((o) => o.claim === 'pong');
    if (pong) {
      const after = simAfter(2, { type: 'pong', sub: 'exposed', tiles: [tile, tile, tile], from: state.claim.from });
      if (after <= before) return { type: ACTIONS.PONG, seat, tile };
    }

    const chis = options.filter((o) => o.claim === 'chi');
    if (chis.length) {
      let best = null;
      let bestAfter = 99;
      for (const chi of chis) {
        const arr = hand.slice();
        let ok = true;
        for (const t of [chi.a, chi.b]) {
          const idx = arr.indexOf(t);
          if (idx >= 0) arr.splice(idx, 1);
          else {
            const wildIdx = arr.findIndex((x) => laizi.includes(x));
            if (wildIdx < 0) { ok = false; break; }
            arr.splice(wildIdx, 1);
          }
        }
        if (!ok) continue;
        const afterChi = calcShanten(arr, melds.concat([{ type: 'chi', sub: 'exposed', tiles: [tile, chi.a, chi.b].sort((a, b) => a - b), from: state.claim.from }]), laizi);
        if (afterChi < bestAfter) { bestAfter = afterChi; best = chi; }
      }
      if (best && bestAfter < before) {
        return { type: ACTIONS.CHI, seat, tile, a: best.a, b: best.b };
      }
    }
    return { type: ACTIONS.PASS, seat };
  }

  _pick(list) {
    if (this.level === 'hard') return list[0];
    return list[Math.floor(this.rng() * list.length)];
  }

  /** 杠是否划算：杠后向听数不能变差 */
  _gangWorth(state, tile, removeCount, isBuGang) {
    const hand = state.players[this.seat].concealed;
    const melds = state.players[this.seat].melds;
    const laizi = state.laizi;
    const before = calcShanten(hand, melds, laizi);
    const arr = hand.slice();
    for (let i = 0; i < removeCount; i++) {
      const idx = arr.indexOf(tile);
      if (idx < 0) return false;
      arr.splice(idx, 1);
    }
    let nextMelds;
    if (isBuGang) {
      nextMelds = melds.map((m) => (m.type === 'pong' && m.tiles[0] === tile
        ? { ...m, type: 'gang', sub: 'bu', tiles: [...m.tiles, tile] }
        : m));
    } else {
      nextMelds = melds.concat([{ type: 'gang', sub: 'an', tiles: [tile, tile, tile, tile], from: null }]);
    }
    return calcShanten(arr, nextMelds, laizi) <= before;
  }

  /**
   * 出牌：向听数最小优先；对手已听牌时，优先打安全牌（对手打过的牌）。
   */
  chooseDiscard(state) {
    const hand = state.players[this.seat].concealed;
    const melds = state.players[this.seat].melds;
    const laizi = state.laizi;
    const candidates = [...new Set(hand)].filter((t) => !laizi.includes(t));
    if (!candidates.length) return { type: ACTIONS.DISCARD, seat: this.seat, tile: hand[0] };

    // 判断是否有对手已经听牌（向听数 ≤ 0）
    const dangerSeats = [];
    for (let s = 0; s < 4; s++) {
      if (s === this.seat) continue;
      const p = state.players[s];
      if (!p) continue;
      if (calcShanten(p.concealed, p.melds, laizi) <= 0) dangerSeats.push(s);
    }
    const safeForAllDanger = (tile) => dangerSeats.length === 0 || dangerSeats.every((s) =>
      state.discardPool.some((d) => d.seat === s && d.tile === tile && !d.removed));

    let best = candidates[0];
    let bestScore = Infinity;
    for (const tile of candidates) {
      const arr = hand.slice();
      arr.splice(arr.indexOf(tile), 1);
      let score = calcShanten(arr, melds, laizi);
      if (dangerSeats.length && !safeForAllDanger(tile)) score += 6; // 危险张尽量不打
      // 相同向听数时：优先丢孤张/字牌/幺九
      score += tiebreak(tile, hand, laizi) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = tile;
      }
    }
    return { type: ACTIONS.DISCARD, seat: this.seat, tile: best };
  }
}

/* ------------------------------------------------------------------ */
/* 向听数（Shanten）：距离听牌还差几张有效换牌                            */
/* 公式：shanten = 8 - 2×固定副露 - (2×完整组 + 半组 + 对子)             */
/* ------------------------------------------------------------------ */

const _shantenMemo = new Map();

/**
 * @param {number[]} hand 当前手牌（不含副露）
 * @param {Array} melds 副露
 * @param {number[]} laizi 癞子
 * @returns {number} -1 已胡；0 听牌；>0 向听数
 */
export function calcShanten(hand, melds = [], laizi = []) {
  if (canWinShape(hand, melds, laizi, {
    allowSevenPairs: true, allowThirteenOrphans: true, requiredQueYiMen: false,
  })) return -1;

  const M = melds.length;
  const cap = 4 - M;
  if (cap < 0) return 99;

  const counts = new Array(34).fill(0);
  let W = 0;
  for (const t of hand) {
    if (laizi.includes(t)) W++;
    else counts[t]++;
  }

  const memo = new Map();
  const BUDGET = 4000;
  const rec = (i, w, m, d, e) => {
    if (m + d > cap || e > 1) return -99;
    while (i < 34 && counts[i] === 0) i++;
    const key = i + ',' + w + ',' + m + ',' + d + ',' + e + ',' + counts.slice(i).join('');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let best = 2 * m + d + e;
    if (memo.size > BUDGET) { // 预算耗尽：返回当前近似值，保证实时性
      memo.set(key, best);
      return best;
    }

    // 纯癞子结构
    if (w >= 2 && e === 0) best = Math.max(best, rec(i, w - 2, m, d, 1));
    if (w >= 2) best = Math.max(best, rec(i, w - 2, m, d + 1, e));
    if (w >= 3) best = Math.max(best, rec(i, w - 3, m + 1, d, e));

    if (i >= 34) {
      memo.set(key, best);
      return best;
    }
    const c = counts[i];
    const r = rankOf(i);
    const s = suitOf(i);

    // 跳过当前牌（作废牌）
    counts[i] = 0;
    best = Math.max(best, rec(i + 1, w, m, d, e));
    counts[i] = c;

    // 完整刻子
    for (let k = Math.min(3, c); k >= 1; k--) {
      const need = 3 - k;
      if (w < need) continue;
      counts[i] -= k;
      best = Math.max(best, rec(i, w - need, m + 1, d, e));
      counts[i] += k;
    }

    // 完整顺子
    if (s < 3 && r <= 7) {
      const trySeq = (belowWild) => {
        if (w < belowWild || r + (2 - belowWild) > 9) return;
        const upper = 2 - belowWild;
        const opts = [];
        for (let k = 0; k < upper; k++) {
          const id = i + 1 + k;
          const arr = [];
          if (counts[id] > 0) arr.push({ wUsed: 0 });
          arr.push({ wUsed: 1 });
          opts.push(arr);
        }
        const combine = (picks) => {
          const used = belowWild + picks.reduce((a, p) => a + p.wUsed, 0);
          if (w < used) return;
          counts[i] -= 1;
          for (let k = 0; k < picks.length; k++) {
            if (picks[k].wUsed === 0) counts[i + 1 + k] -= 1;
          }
          best = Math.max(best, rec(i, w - used, m + 1, d, e));
          for (let k = 0; k < picks.length; k++) {
            if (picks[k].wUsed === 0) counts[i + 1 + k] += 1;
          }
          counts[i] += 1;
        };
        if (upper === 0) combine([]);
        else if (upper === 1) opts[0].forEach((a) => combine([a]));
        else opts[0].forEach((a) => opts[1].forEach((b) => combine([a, b])));
      };
      trySeq(0);
      if (r >= 2) trySeq(1);
      if (r >= 3) trySeq(2);
    }

    // 半组刻子（两同张）
    if (c >= 2) {
      counts[i] -= 2;
      best = Math.max(best, rec(i, w, m, d + 1, e));
      counts[i] += 2;
    } else if (w >= 1) {
      counts[i] -= 1;
      best = Math.max(best, rec(i, w - 1, m, d + 1, e));
      counts[i] += 1;
    }

    // 半组顺子（i 与 i+1）
    if (s < 3 && r <= 8) {
      if (counts[i + 1] > 0) {
        counts[i]--; counts[i + 1]--;
        best = Math.max(best, rec(i, w, m, d + 1, e));
        counts[i]++; counts[i + 1]++;
      }
      if (w >= 1) {
        counts[i]--;
        best = Math.max(best, rec(i, w - 1, m, d + 1, e));
        counts[i]++;
      }
    }

    // 对子
    if (e === 0) {
      if (c >= 2) {
        counts[i] -= 2;
        best = Math.max(best, rec(i, w, m, d, 1));
        counts[i] += 2;
      } else if (w >= 1) {
        counts[i] -= 1;
        best = Math.max(best, rec(i, w - 1, m, d, 1));
        counts[i] += 1;
      }
    }

    memo.set(key, best);
    return best;
  };

  const bestScore = rec(0, W, 0, 0, 0);
  const shanten = Math.max(-1, 8 - 2 * M - bestScore);
  if (_shantenMemo.size > 20000) _shantenMemo.clear();
  _shantenMemo.set(counts.join(',') + `|${W}|${M}`, shanten);
  return shanten;
}

/** 手牌“向好程度”：对子/搭子/顺子潜力 + 癞子价值 */
export function handUtility(hand, laizi = []) {
  const counts = countTiles(hand);
  let score = 0;
  let wild = 0;
  for (const lz of laizi) {
    wild += counts[lz];
    counts[lz] = 0;
  }
  score += wild * 9;

  for (let t = 0; t < 34; t++) {
    if (counts[t] === 0) continue;
    const s = suitOf(t);
    if (s === 3) {
      score += counts[t] >= 2 ? 5 : 0.6;
      continue;
    }
    const r = rankOf(t);
    const isMiddle = r >= 2 && r <= 8;
    score += isMiddle ? 1.4 : 0.6;
    if (counts[t] >= 2) score += 5;
    if (counts[t] >= 3) score += 4;
    // 与同花相邻牌的连接
    for (let d = 1; d <= 2; d++) {
      if (r + d <= 9) {
        const n = t + d;
        if (counts[n] > 0) score += d === 1 ? 3.2 : 1.6;
      }
    }
  }
  return score;
}

function tiebreak(tile, hand, laizi) {
  // 相同价值时：优先丢孤张字牌，再丢幺九，保留中张
  const counts = countTiles(hand);
  let v = 0;
  if (isHonor(tile) && counts[tile] === 1 && !laizi.includes(tile)) v -= 2;
  const r = rankOf(tile);
  if (r === 1 || r === 9) v -= 0.5;
  if (r >= 2 && r <= 8) v += 0.4;
  return v;
}
