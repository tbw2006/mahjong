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
      if (this._gangWorth(hand, pick, 4, state.laizi, 7)) {
        return { type: ACTIONS.AN_GANG, seat: this.seat, tile: pick };
      }
    }
    if (options.buGang.length) {
      const pick = this._pick(options.buGang);
      if (this._gangWorth(hand, pick, 1, state.laizi, 4)) {
        return { type: ACTIONS.BU_GANG, seat: this.seat, tile: pick };
      }
    }
    const discard = this.chooseDiscard(state);
    return discard;
  }

  /**
   * 有人舍牌 / 补杠时决策。
   */
  decideClaim(state, seat, options) {
    if (!options || !options.length) return { type: ACTIONS.PASS, seat };
    const hu = options.find((o) => o.claim === 'hu');
    if (hu) return { type: ACTIONS.HU, seat, tile: state.claim.tile };

    const pong = options.find((o) => o.claim === 'pong');
    const gang = options.find((o) => o.claim === 'gang');
    const chis = options.filter((o) => o.claim === 'chi');
    const hand = state.players[seat].concealed;
    const tile = state.claim.tile;

    if (gang && this._removalWorth(hand, state.laizi, [tile, tile, tile]) >= -4) {
      return { type: ACTIONS.GANG, seat, tile };
    }
    if (pong) {
      const worth = this._removalWorth(hand, state.laizi, [tile, tile]);
      if (isHonor(tile) || worth >= -5) return { type: ACTIONS.PONG, seat, tile };
    }
    if (chis.length) {
      let best = null;
      let bestWorth = -Infinity;
      for (const chi of chis) {
        const removed = [chi.a, chi.b].filter((t) => hand.includes(t));
        const worth = this._removalWorth(hand, state.laizi, removed);
        if (worth > bestWorth) { bestWorth = worth; best = chi; }
      }
      if (best && bestWorth >= -6 && this.rng() < 0.55) {
        return { type: ACTIONS.CHI, seat, tile, a: best.a, b: best.b };
      }
    }
    return { type: ACTIONS.PASS, seat };
  }

  _pick(list) {
    if (this.level === 'hard') return list[0];
    return list[Math.floor(this.rng() * list.length)];
  }

  /** 杠是否划算：杠后手牌损失不大才杠 */
  _gangWorth(hand, tile, removeCount, laizi, threshold) {
    const removed = new Array(removeCount).fill(tile);
    return this._removalWorth(hand, laizi, removed) >= -threshold;
  }

  _removalWorth(hand, laizi, removed) {
    const before = handUtility(hand, laizi);
    const arr = hand.slice();
    for (const t of removed) {
      const i = arr.indexOf(t);
      if (i >= 0) arr.splice(i, 1);
    }
    return handUtility(arr, laizi) - before;
  }

  /**
   * 出牌：以“向听数”最小为第一原则（尽快听牌），再按牌效率择优。
   */
  chooseDiscard(state) {
    const hand = state.players[this.seat].concealed;
    const melds = state.players[this.seat].melds;
    const laizi = state.laizi;
    const candidates = [...new Set(hand)];
    if (!candidates.length) return { type: ACTIONS.DISCARD, seat: this.seat, tile: hand[0] };

    let best = candidates[0];
    let bestShanten = Infinity;
    let bestUtility = Infinity;

    // 先用廉价的价值函数筛掉明显不该丢的牌，只对最差候选计算精确向听数
    let ranked = candidates
      .filter((t) => !laizi.includes(t))
      .map((tile) => {
        const arr = hand.slice();
        arr.splice(arr.indexOf(tile), 1);
        return { tile, utility: handUtility(arr, laizi) + tiebreak(tile, hand, laizi) };
      })
      .sort((a, b) => a.utility - b.utility);

    // 缺一门玩法（如四川）：优先丢牌数最少的那一门
    if (state.rules && state.rules.requiredQueYiMen) {
      const suitCount = [0, 0, 0];
      for (const t of hand) {
        if (!laizi.includes(t) && suitOf(t) < 3) suitCount[suitOf(t)]++;
      }
      ranked = ranked
        .map((item) => ({ ...item, suitRank: suitCount[suitOf(item.tile)] * 100 }))
        .sort((a, b) => a.suitRank + a.utility - (b.suitRank + b.utility));
    }
    ranked = ranked.slice(0, 8);
    const pool = ranked.length ? ranked : candidates.filter((t) => !laizi.includes(t)).slice(0, 1).map((t) => ({ tile: t, utility: 0 }));
    for (const item of pool) {
      const arr = hand.slice();
      arr.splice(arr.indexOf(item.tile), 1);
      const shanten = calcShanten(arr, melds, laizi);
      if (shanten < bestShanten || (shanten === bestShanten && item.utility < bestUtility)) {
        bestShanten = shanten;
        bestUtility = item.utility;
        best = item.tile;
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
