/**
 * 胡牌判定 + 番型计分（纯函数，无 DOM / 无随机，可直接在 Node 与服务器运行）。
 *
 * 结构约定：
 *   - 手牌 concealed 与副露 melds 分离；
 *   - 胡牌时：concealed.length === 14 - 3 * melds.length；
 *   - 副露每副算一组（杠按一组刻子处理，多出的第 4 张不计组数）。
 *
 * 癞子（万能牌）在拆解时会记录“替代为哪张牌”，番型判定据此展开。
 */

import {
  TILE_COUNT, suitOf, rankOf, isHonor, isWind, isDragon, isTerminal, isSequence,
  countTiles,
} from './tiles.js';
import { FAN_TABLES, SCORING_SETS } from './rules.js';

/* ------------------------------------------------------------------ */
/* 番型定义                                                             */
/* ------------------------------------------------------------------ */

const F = {
  zimo: { name: '自摸', desc: '自己摸到胡牌' },
  menqing: { name: '门清', desc: '没有吃碰明杠（暗杠不算破门清）' },
  duanyao: { name: '断幺九', desc: '全部为 2~8 数牌，无字无风' },
  pengpeng: { name: '碰碰胡', desc: '全部由刻子（碰/杠）组成' },
  hunyise: { name: '混一色', desc: '一种花色 + 字牌' },
  qingyise: { name: '清一色', desc: '全部为同一种花色，无字牌' },
  ziyise: { name: '字一色', desc: '全部为字牌（东南西北中发白）' },
  yitiaolong: { name: '一条龙', desc: '同一花色 123 + 456 + 789' },
  qinglong: { name: '清龙', desc: '同花色 123、456、789（国标计法）' },
  haidilao: { name: '海底捞月', desc: '最后一张牌自摸' },
  gangshanghua: { name: '杠上开花', desc: '杠后补牌胡牌' },
  qianggang: { name: '抢杠胡', desc: '胡别人补杠的牌' },
  tianhu: { name: '天胡', desc: '庄家起手第一张自摸' },
  dihu: { name: '地胡', desc: '闲家胡庄家第一张舍牌' },
  qidui: { name: '七对', desc: '七个对子' },
  haohuaqidui: { name: '豪华七对', desc: '七对中含四张相同' },
  lianqidui: { name: '连七对', desc: '同花色连续七对（国标）' },
  shisanshao: { name: '十三幺', desc: '国士无双：13 种幺九牌各一 + 任意一张' },
  dasanyuan: { name: '大三元', desc: '中发白三副刻子' },
  xiaosanyuan: { name: '小三元', desc: '中发白两副刻子 + 一对' },
  dasixi: { name: '大四喜', desc: '东南西北四副刻子' },
  xiaosixi: { name: '小四喜', desc: '风牌三副刻子 + 一对' },
  sanfengke: { name: '三风刻', desc: '三副风牌刻子' },
  quanqiuren: { name: '全求人', desc: '四副全副露，单钓胡别家舍牌' },
  sananke: { name: '三暗刻', desc: '三副暗刻（暗杠算暗刻）' },
  sianke: { name: '四暗刻', desc: '四副暗刻（国标）' },
  shuangAnKe: { name: '双暗刻', desc: '两副暗刻（国标）' },
  gang: { name: '杠', desc: '每有一杠加计' },
  minggang: { name: '明杠', desc: '明杠 / 补杠（国标）' },
  angang: { name: '暗杠', desc: '暗杠（国标）' },
  shuangminggang: { name: '双明杠', desc: '两个明杠（国标）' },
  shuanganGang: { name: '双暗杠', desc: '两个暗杠（国标）' },
  sangang: { name: '三杠', desc: '三副杠（国标）' },
  sigang: { name: '四杠', desc: '四副杠（国标）' },
  jiulianbaodeng: { name: '九莲宝灯', desc: '同花色 1112345678999 加任意一张（国标）' },
  lvyise: { name: '绿一色', desc: '仅 23468 条与发财（国标）' },
  wumenqi: { name: '五门齐', desc: '万筒条风箭五门俱全（国标）' },
  quandaiyao: { name: '全带幺', desc: '每副牌与将都含 1/9 或字牌（国标）' },
  buqiuren: { name: '不求人', desc: '门清自摸（国标）' },
  pinghe: { name: '平和', desc: '四副顺子 + 非字牌将（国标简化）' },
  siguiyi: { name: '四归一', desc: '四张相同牌（国标）' },
  shuangtongke: { name: '双同刻', desc: '两副同点数不同花色刻子（国标）' },
  jianke: { name: '箭刻', desc: '中/发/白刻子（国标）' },
  shuangjianke: { name: '双箭刻', desc: '两副箭刻（国标）' },
  quanfengke: { name: '圈风刻', desc: '圈风刻子（国标）' },
  menfengke: { name: '门风刻', desc: '门风刻子（国标）' },
  yibanGao: { name: '一般高', desc: '同花色两副相同顺子（国标）' },
  xixiangfeng: { name: '喜相逢', desc: '两花色同点数顺子（国标）' },
  lianliu: { name: '连六', desc: '同花色相连的两副顺子（国标）' },
  laoshaofu: { name: '老少副', desc: '同花色 123 + 789（国标）' },
  sansetongshun: { name: '三色三同顺', desc: '三花色同点数顺子（国标）' },
  yisesanjiegao: { name: '一色三节高', desc: '同花色三副递增一阶顺子（国标）' },
  queyimen: { name: '缺一门', desc: '万筒条缺一门（国标）' },
  wuzi: { name: '无字', desc: '没有字牌（国标）' },
  danDiao: { name: '单钓将', desc: '单钓将牌（国标）' },
  bianZhang: { name: '边张', desc: '边张和牌（国标）' },
  kanZhang: { name: '坎张', desc: '嵌张和牌（国标）' },
};

/** 每种玩法各番型的番数 / 番点 */
const VALUES = {
  [FAN_TABLES.GUANGDONG]: {
    zimo: 1, menqing: 1, pengpeng: 3, hunyise: 3, qingyise: 6, ziyise: 10,
    yitiaolong: 2, haidilao: 1, gangshanghua: 1, qianggang: 1, tianhu: 10, dihu: 5,
    qidui: 4, haohuaqidui: 2, shisanshao: 13, dasanyuan: 8, xiaosanyuan: 5,
    dasixi: 13, xiaosixi: 10, quanqiuren: 2, sananke: 2, gang: 1,
  },
  [FAN_TABLES.XIANGGANG]: {
    zimo: 1, menqing: 1, pengpeng: 3, hunyise: 3, qingyise: 7, ziyise: 10,
    yitiaolong: 2, haidilao: 1, gangshanghua: 1, qianggang: 1, tianhu: 10, dihu: 5,
    qidui: 4, haohuaqidui: 2, shisanshao: 13, dasanyuan: 8, xiaosanyuan: 5,
    dasixi: 13, xiaosixi: 10, quanqiuren: 2, sananke: 2, gang: 1,
  },
  [FAN_TABLES.SICHUAN]: {
    zimo: 1, pengpeng: 1, qingyise: 2, qidui: 2, haohuaqidui: 1, gangshanghua: 1,
    haidilao: 1, qianggang: 1, gang: 1, qinglong: 1,
  },
  [FAN_TABLES.CUSTOM]: {
    zimo: 1, menqing: 1, pengpeng: 3, hunyise: 3, qingyise: 6, ziyise: 10,
    yitiaolong: 2, haidilao: 1, gangshanghua: 1, qianggang: 1, tianhu: 10, dihu: 5,
    qidui: 4, haohuaqidui: 2, shisanshao: 13, dasanyuan: 8, xiaosanyuan: 5,
    dasixi: 13, xiaosixi: 10, quanqiuren: 2, sananke: 2, gang: 1,
  },
  [FAN_TABLES.GUOBIAO]: {
    dasixi: 88, dasanyuan: 88, lvyise: 88, jiulianbaodeng: 88, sigang: 88,
    lianqidui: 88, shisanshao: 88,
    xiaosixi: 64, xiaosanyuan: 64, ziyise: 64, sianke: 64,
    sangang: 32,
    qingyise: 24, qidui: 24, yisesanjiegao: 24,
    qinglong: 16, sananke: 16,
    sanfengke: 12,
    sansetongshun: 8,
    pengpeng: 6, hunyise: 6, wumenqi: 6, quanqiuren: 6, shuangjianke: 6, shuanganGang: 6,
    quandaiyao: 4, buqiuren: 4, shuangminggang: 4,
    jianke: 2, quanfengke: 2, menfengke: 2, menqing: 2, pinghe: 2, siguiyi: 2,
    shuangtongke: 2, shuangAnKe: 2, angang: 2, duanyao: 2,
    yibanGao: 1, xixiangfeng: 1, lianliu: 1, laoshaofu: 1, minggang: 1,
    queyimen: 1, wuzi: 1, danDiao: 1, bianZhang: 1, kanZhang: 1, zimo: 1,
  },
};

/** 番型互斥（计大不计小），保证不重复计番 */
const SUPERSEDES = {
  dasixi: ['quanfengke', 'menfengke', 'sanfengke'],
  xiaosixi: ['quanfengke', 'menfengke', 'sanfengke'],
  dasanyuan: ['jianke', 'shuangjianke'],
  xiaosanyuan: ['jianke', 'shuangjianke'],
  shuangjianke: ['jianke'],
  ziyise: ['pengpeng', 'duanyao', 'wuzi', 'queyimen'],
  qingyise: ['wuzi', 'queyimen'],
  hunyise: ['wuzi', 'queyimen'],
  lvyise: ['hunyise', 'qingyise'],
  qidui: ['pengpeng', 'pinghe'],
  lianqidui: ['qidui', 'qingyise'],
  shisanshao: ['wuzi', 'queyimen', 'danDiao'],
  pengpeng: ['pinghe'],
  jiulianbaodeng: ['qingyise', 'qinglong', 'yitiaolong', 'lianliu', 'shuangAnKe', 'sananke', 'danDiao', 'bianZhang', 'kanZhang'],
  qinglong: ['laoshaofu', 'lianliu'],
  sianke: ['sananke', 'shuangAnKe'],
  sananke: ['shuangAnKe'],
  sangang: ['shuangminggang', 'shuanganGang'],
  sigang: ['sangang', 'shuangminggang', 'shuanganGang'],
  buqiuren: ['menqing', 'zimo'],
  quandaiyao: [],
};

/* ------------------------------------------------------------------ */
/* 拆解：癞子代入的标准胡型                                           */
/* ------------------------------------------------------------------ */

/** 牌张条目：{t: 代入后的牌 id（全癞子组为 null）, w: 是否为癞子} */
function ent(t, w = false) {
  return { t, w };
}

function signature(solution) {
  const norm = (arr) => arr
    .map((e) => `${e.w ? 'L' : 'R'}${e.t ?? 'x'}`)
    .sort()
    .join(',');
  const groups = solution.groups.map(norm).sort().join('|');
  return groups + '#' + norm(solution.pair);
}

/**
 * 把未副露的手牌拆成 (3N+2)：返回所有拆解方案。
 * @param {number[]} concealed
 * @param {number[]} laiziList 癞子 id 列表
 * @param {number} maxSolutions 上限
 */
export function decompose(concealed, laiziList = [], maxSolutions = 80) {
  const counts = new Array(TILE_COUNT).fill(0);
  let wild = 0;
  for (const t of concealed) {
    if (laiziList.includes(t)) wild++;
    else counts[t]++;
  }
  if (concealed.length !== 3 * ((concealed.length - 2) / 3) + 2) return [];
  if ((concealed.length - 2) % 3 !== 0) return [];

  const solutions = [];
  const seen = new Set();
  const pushSolution = (groups, pair) => {
    if (solutions.length >= maxSolutions) return;
    const sol = { groups, pair };
    const sig = signature(sol);
    if (seen.has(sig)) return;
    seen.add(sig);
    solutions.push(sol);
  };

  const solveGroups = (cnt, W, groups) => {
    if (solutions.length >= maxSolutions) return;
    let i = 0;
    while (i < TILE_COUNT && cnt[i] === 0) i++;

    if (i === TILE_COUNT) {
      if (W > 0 && W % 3 === 0) {
        // 全癞子组
        const g = [ent(null, true), ent(null, true), ent(null, true)];
        const all = [];
        for (let k = 0; k < W / 3; k++) all.push(g);
        pushSolution(groups.concat(all), pairRef);
      } else if (W === 0) {
        pushSolution(groups, pairRef);
      }
      return;
    }

    // 刻子：i,i,i。真牌可用 1/2/3 张，其余用癞子补齐（多分支避免遗漏）
    const maxUse = Math.min(3, cnt[i]);
    for (let use = 1; use <= maxUse; use++) {
      const needTrip = 3 - use;
      if (W < needTrip) continue;
      const rest = cnt.slice();
      rest[i] -= use;
      const g = [];
      for (let k = 0; k < use; k++) g.push(ent(i, false));
      for (let k = 0; k < needTrip; k++) g.push(ent(i, true));
      solveGroups(rest, W - needTrip, groups.concat([g]));
    }

    // 顺子：i 是剩余牌中最小的真牌。包含 i 的顺子最小张只能是 i-2/i-1/i，
    // 小于 i 的位置必须用癞子补位。
    if (i < 27) {
      const r = rankOf(i);
      const trySeq = (minRank, belowWild) => {
        if (W < belowWild) return;
        if (r + (2 - belowWild) > 9) return; // i + 上方张数 不能越界
        const upper = 2 - belowWild; // i 上方需要补的真牌/癞子槽数
        const optionFor = (id) => {
          const opts = [];
          if (cnt[id] > 0) opts.push({ w: false });
          if (W > 0) opts.push({ w: true });
          return opts;
        };
        const combine = (picks) => {
          const wUsed = belowWild + picks.filter((p) => p.w).length;
          if (W < wUsed) return;
          const rest = cnt.slice();
          rest[i] -= 1;
          for (let k = 0; k < picks.length; k++) {
            if (!picks[k].w) rest[i + 1 + k] -= 1;
          }
          const base = i - (r - minRank);
          const g = [ent(base, true), ent(base + 1, true), ent(base + 2, true)];
          g[belowWild] = ent(i, false); // i 必为真牌
          for (let k = 0; k < picks.length; k++) {
            g[belowWild + 1 + k] = ent(i + 1 + k, picks[k].w);
          }
          solveGroups(rest, W - wUsed, groups.concat([g]));
        };
        if (upper === 0) combine([]);
        else if (upper === 1) {
          for (const a of optionFor(i + 1)) combine([a]);
        } else {
          for (const a of optionFor(i + 1)) {
            for (const b of optionFor(i + 2)) combine([a, b]);
          }
        }
      };
      if (r <= 7) trySeq(r, 0);
      if (r >= 2) trySeq(r - 1, 1);
      if (r >= 3) trySeq(r - 2, 2);
    }
  };

  let pairRef = null;
  const withPair = (cnt, W, pair) => {
    pairRef = pair;
    solveGroups(cnt, W, []);
  };

  // 枚举将牌
  for (let p = 0; p < TILE_COUNT; p++) {
    if (counts[p] >= 2) {
      const rest = counts.slice();
      rest[p] -= 2;
      withPair(rest, wild, [ent(p, false), ent(p, false)]);
    }
    if (counts[p] >= 1 && wild >= 1) {
      const rest = counts.slice();
      rest[p] -= 1;
      withPair(rest, wild - 1, [ent(p, false), ent(p, true)]);
    }
  }
  if (wild >= 2) {
    withPair(counts.slice(), wild - 2, [ent(null, true), ent(null, true)]);
  }

  return solutions;
}

/* ------------------------------------------------------------------ */
/* 特殊胡型                                                             */
/* ------------------------------------------------------------------ */

export function isSevenPairs(concealed, laiziList = []) {
  if (concealed.length !== 14) return false;
  const counts = countTiles(concealed);
  let W = 0;
  for (const lz of laiziList) {
    W += counts[lz];
    counts[lz] = 0;
  }
  let pairs = 0;
  let singles = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    pairs += Math.floor(counts[i] / 2);
    singles += counts[i] % 2;
  }
  if (W < singles) return false;
  pairs += singles;
  W -= singles;
  pairs += Math.floor(W / 2);
  return pairs === 7;
}

export function hasQuadruplet(concealed, laiziList = []) {
  const counts = countTiles(concealed);
  for (const lz of laiziList) counts[lz] = 0;
  return counts.some((c) => c >= 4);
}

const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
const ORPHAN_SET = new Set(ORPHANS);

export function isThirteenOrphans(concealed, laiziList = []) {
  if (concealed.length !== 14) return false;
  const counts = countTiles(concealed);
  let W = 0;
  for (const lz of laiziList) {
    W += counts[lz];
    counts[lz] = 0;
  }
  for (let i = 0; i < TILE_COUNT; i++) {
    if (counts[i] > 0 && !ORPHAN_SET.has(i)) return false;
  }
  let missing = 0;
  let extras = 0;
  for (const o of ORPHANS) {
    if (counts[o] === 0) missing++;
    else extras += counts[o] - 1;
  }
  return missing <= W && (W - missing) + extras === 1;
}

/* ------------------------------------------------------------------ */
/* 胡牌判定                                                             */
/* ------------------------------------------------------------------ */

function realSuitsUsed(concealed, melds, laiziList) {
  const suits = new Set();
  for (const t of concealed) {
    if (!laiziList.includes(t)) suits.add(suitOf(t));
  }
  for (const m of melds) {
    for (const t of m.tiles) {
      if (!laiziList.includes(t)) suits.add(suitOf(t));
    }
  }
  return suits;
}

/**
 * 是否满足基础胡牌形状（不含番数门槛）。
 */
export function canWinShape(concealed, melds, laiziList, rules) {
  const meldCount = melds.length;
  const expected = 14 - 3 * meldCount;
  if (concealed.length !== expected || concealed.length < 2) return false;

  if (meldCount === 0) {
    if (rules.allowSevenPairs !== false && isSevenPairs(concealed, laiziList)) return true;
    if (rules.allowThirteenOrphans !== false && isThirteenOrphans(concealed, laiziList)) return true;
  }

  if ((concealed.length - 2) % 3 !== 0) return false;
  const sols = decompose(concealed, laiziList);
  if (!sols.length) return false;

  if (rules.requiredQueYiMen) {
    const suits = realSuitsUsed(concealed, melds, laiziList);
    let numbered = 0;
    for (const s of suits) if (s < 3) numbered++;
    if (numbered > 2) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 番型检测                                                             */
/* ------------------------------------------------------------------ */

function meldToGroup(meld, laiziList) {
  const tiles = meld.tiles.slice();
  if (meld.type === 'pong' || meld.type === 'gang') {
    const base = tiles.find((t) => !laiziList.includes(t)) ?? tiles[0];
    return {
      entries: tiles.map((t) => ent(laiziList.includes(t) ? base : t, laiziList.includes(t))),
      meld,
    };
  }
  // chi：把癞子代入缺的那张
  const reals = tiles.filter((t) => !laiziList.includes(t));
  const suit = reals.length ? suitOf(reals[0]) : 0;
  const realRanks = reals.map(rankOf).sort((a, b) => a - b);
  let span;
  if (realRanks.length === 3) span = realRanks;
  else if (realRanks.length === 2) {
    const a = realRanks[0], b = realRanks[1];
    if (b - a === 1) span = a === 1 ? [1, 2, 3] : [a - 1, a, b];
    else if (b - a === 2) span = [a, a + 1, b];
    else span = [a, a + 1, b];
  } else if (realRanks.length === 1) {
    const r = realRanks[0];
    if (r === 1) span = [1, 2, 3];
    else if (r === 9) span = [7, 8, 9];
    else span = [r - 1, r, r + 1];
  } else span = [1, 2, 3];
  span = span.slice(0, 3);
  const used = new Set();
  const entries = tiles.map((t) => {
    if (laiziList.includes(t)) {
      const pick = span.find((r) => !used.has(r));
      used.add(pick);
      return ent(suit * 9 + pick - 1, true);
    }
    used.add(rankOf(t));
    return ent(t, false);
  });
  return { entries, meld };
}

function isTripletGroup(group) {
  if (group.length !== 3) return false;
  const t = group[0].t;
  return t !== null && group.every((e) => e.t === t);
}

function isSequenceGroup(group) {
  if (group.length !== 3) return false;
  const ts = group.map((e) => e.t).sort((a, b) => a - b);
  return isSequence(ts[0], ts[1], ts[2]);
}

function evaluateFan(kind, solution, concealed, melds, laiziList, winningTile, ctx, rules) {
  const raw = [];
  const add = (key) => {
    const v = VALUES[rules.fanTable]?.[key];
    if (v !== undefined && v !== null && v > 0) {
      raw.push({ key, name: F[key].name, desc: F[key].desc, value: v });
    }
  };

  const allTiles = concealed.concat(melds.flatMap((m) => m.tiles));
  const realTiles = allTiles.filter((t) => !laiziList.includes(t));
  const suits = new Set(realTiles.map(suitOf));
  const numberedSuits = [...suits].filter((s) => s < 3);
  const hasHonor = suits.has(3);

  // ---- 花色系 ----
  if (suits.size === 1 && numberedSuits.length === 1 && !hasHonor) add('qingyise');
  else if (suits.size === 2 && numberedSuits.length === 1 && hasHonor) add('hunyise');
  if (suits.size === 1 && hasHonor && numberedSuits.length === 0) add('ziyise');
  if (realTiles.length && realTiles.every((t) => rankOf(t) >= 2 && rankOf(t) <= 8) && !hasHonor) add('duanyao');
  if (!hasHonor && realTiles.length) add('wuzi');
  const wan = realTiles.some((t) => suitOf(t) === 0);
  const tong = realTiles.some((t) => suitOf(t) === 1);
  const tiao = realTiles.some((t) => suitOf(t) === 2);
  const wind = realTiles.some((t) => isWind(t));
  const dragon = realTiles.some((t) => isDragon(t));
  if ([wan, tong, tiao].filter(Boolean).length <= 2) add('queyimen');
  if ([wan, tong, tiao, wind, dragon].filter(Boolean).length === 5) add('wumenqi');

  // ---- 结构 ----
  const seqGroups = [];
  const tripGroups = [];
  const concealedTrips = [];
  const gangMelds = [];
  const exposedMelds = [];

  if (kind === 'standard') {
    for (const g of solution.groups) {
      if (isTripletGroup(g)) {
        tripGroups.push(g);
        if (g.every((e) => !e.w)) concealedTrips.push(g);
      } else if (isSequenceGroup(g)) {
        seqGroups.push(g);
      }
    }
  }
  for (const m of melds) {
    if (m.sub === 'an') { /* 暗杠在下方专门统计 */ }
    const mg = meldToGroup(m, laiziList);
    if (m.type === 'chi') seqGroups.push(mg.entries);
    else {
      tripGroups.push(mg.entries);
      if (m.sub === 'an') concealedTrips.push(mg.entries);
    }
    if (m.type === 'gang') {
      gangMelds.push(m);
      if (m.sub === 'an') { /* 暗杠 */ } else exposedMelds.push(m);
    } else exposedMelds.push(m);
  }

  if (kind === 'standard' && seqGroups.length === 0 && tripGroups.length > 0) add('pengpeng');
  if (kind === 'standard' && seqGroups.length === 4 && tripGroups.length === 0) {
    const pairTiles = solution.pair.map((e) => e.t);
    const pairHonor = pairTiles.some((t) => t !== null && isHonor(t));
    if (!pairHonor) add('pinghe');
  }

  const seqSig = (g) => {
    const t = g.find((e) => !e.w)?.t ?? g[0].t;
    const ranks = g.map((e) => e.t).sort((a, b) => a - b);
    return { suit: suitOf(ranks[0]), ranks: ranks.map(rankOf) };
  };
  const seqList = seqGroups.map(seqSig).filter((s) => s.ranks.every((r) => r !== null));
  const countSeq = (suit, ranks) => seqList.filter((s) => s.suit === suit && s.ranks.join('') === ranks.join('')).length;

  // 一条龙 / 清龙 / 老少副 / 连六
  for (const suit of [0, 1, 2]) {
    if (countSeq(suit, [1, 2, 3]) && countSeq(suit, [4, 5, 6]) && countSeq(suit, [7, 8, 9])) {
      add('yitiaolong');
      add('qinglong');
    }
    if (countSeq(suit, [1, 2, 3]) && countSeq(suit, [7, 8, 9])) add('laoshaofu');
    const starts = seqList.filter((s) => s.suit === suit).map((s) => s.ranks[0]).sort((a, b) => a - b);
    for (const r of starts) {
      if (starts.includes(r + 3)) add('lianliu');
    }
    for (const r of starts) {
      if (starts.includes(r + 1) && starts.includes(r + 2)) add('yisesanjiegao');
    }
  }
  // 一般高
  for (const suit of [0, 1, 2]) {
    for (let r = 1; r <= 7; r++) {
      if (countSeq(suit, [r, r + 1, r + 2]) >= 2) add('yibanGao');
    }
  }
  // 喜相逢 / 三色三同顺
  for (let r = 1; r <= 7; r++) {
    const hit = [0, 1, 2].filter((s) => countSeq(s, [r, r + 1, r + 2]) >= 1);
    if (hit.length >= 2) add('xixiangfeng');
    if (hit.length === 3) add('sansetongshun');
  }

  // ---- 刻子 / 杠 ----
  const tripTile = (g) => g[0].t;
  const windTrips = tripGroups.filter((g) => tripTile(g) !== null && isWind(tripTile(g)));
  const dragonTrips = tripGroups.filter((g) => tripTile(g) !== null && isDragon(tripTile(g)));
  if (windTrips.length === 4) add('dasixi');
  if (windTrips.length === 3) {
    const pairWind = solution.pair?.some((e) => e.t !== null && isWind(e.t));
    if (pairWind) add('xiaosixi');
    else add('sanfengke');
  }
  if (dragonTrips.length === 3) add('dasanyuan');
  if (dragonTrips.length === 2) {
    const pairDragon = solution.pair?.some((e) => e.t !== null && isDragon(e.t));
    if (pairDragon) add('xiaosanyuan');
    else add('shuangjianke');
  }
  if (dragonTrips.length === 1) add('jianke');
  const circleWindId = 27 + (ctx.prevailingWind ?? 0);
  const seatWindId = 27 + (ctx.seatWind ?? 0);
  if (tripGroups.some((g) => tripTile(g) === circleWindId)) add('quanfengke');
  if (tripGroups.some((g) => tripTile(g) === seatWindId)) add('menfengke');

  if (concealedTrips.length === 4) add('sianke');
  else if (concealedTrips.length === 3) add('sananke');
  else if (concealedTrips.length === 2) add('shuangAnKe');

  // 双同刻
  const pongRanks = tripGroups.map((g) => ({ suit: suitOf(tripTile(g)), rank: rankOf(tripTile(g)) }));
  for (let r = 1; r <= 9; r++) {
    const suitsWith = new Set(pongRanks.filter((p) => p.rank === r).map((p) => p.suit));
    if (suitsWith.size >= 2) add('shuangtongke');
  }

  const gangCount = gangMelds.length;
  const anGangCount = gangMelds.filter((m) => m.sub === 'an').length;
  const mingGangCount = gangCount - anGangCount;
  for (let k = 0; k < gangCount; k++) add('gang');
  for (let k = 0; k < anGangCount; k++) add('angang');
  for (let k = 0; k < mingGangCount; k++) add('minggang');
  if (mingGangCount >= 2) add('shuangminggang');
  if (anGangCount >= 2) add('shuanganGang');
  if (gangCount >= 3) add('sangang');
  if (gangCount >= 4) add('sigang');

  // 四归一
  const allCounts = countTiles(realTiles);
  if (allCounts.some((c) => c >= 4)) add('siguiyi');

  // 全带幺
  if (kind === 'standard') {
    const groupHasYao = (g) => g.some((e) => e.w || (e.t !== null && (isTerminal(e.t) || isHonor(e.t))));
    const pairHasYao = solution.pair.every((e) => e.w || (e.t !== null && (isTerminal(e.t) || isHonor(e.t))));
    if (seqGroups.every(groupHasYao) && tripGroups.every(groupHasYao) && pairHasYao) add('quandaiyao');
  }

  // ---- 特殊胡型 ----
  if (kind === 'seven-pairs') {
    add('qidui');
    if (hasQuadruplet(concealed, laiziList)) add('haohuaqidui');
    // 连七对：真牌全部同花色且为连续 7 个对子
    if (realTiles.length && realTiles.every((t) => suitOf(t) === suitOf(realTiles[0]))) {
      const suit = suitOf(realTiles[0]);
      const cs = countTiles(realTiles);
      for (let r = 1; r <= 3; r++) {
        const ranks = [r, r + 1, r + 2, r + 3, r + 4, r + 5, r + 6];
        if (ranks.every((x) => cs[suit * 9 + x - 1] >= 1)) add('lianqidui');
      }
    }
  }
  if (kind === 'thirteen-orphans') add('shisanshao');
  // 绿一色（任意胡型均可：仅 23468 条与发财）
  if (realTiles.length && realTiles.every((t) => {
    const r = rankOf(t);
    return (t >= 19 && t <= 25 && [2, 3, 4, 6, 8].includes(r)) || t === 32;
  })) add('lvyise');

  if (kind === 'standard' && melds.length === 0) {
    // 九莲宝灯（须门清）
    if (realTiles.length && realTiles.every((t) => suitOf(t) === suitOf(realTiles[0]))) {
      const s = suitOf(realTiles[0]);
      if (s < 3 && isNineGates(countTiles(realTiles), s, laiziList, concealed)) add('jiulianbaodeng');
    }
  }

  // ---- 和牌方式 ----
  if (ctx.isSelfDraw) add('zimo');
  if (ctx.isLastWallTile) add('haidilao');
  if (ctx.isGangReplacement) add('gangshanghua');
  if (ctx.isRobGang) add('qianggang');
  if (ctx.isTianHu) add('tianhu');
  if (ctx.isDiHu) add('dihu');
  if (ctx.isMenQing) add('menqing');
  if (ctx.isMenQing && ctx.isSelfDraw) add('buqiuren');
  if (ctx.isQuanQiuRen) add('quanqiuren');

  // ---- 国标听牌细节：单钓 / 边张 / 坎张 ----
  if (winningTile !== null && winningTile !== undefined && kind === 'standard') {
    const w = winningTile;
    const inPair = solution.pair.some((e) => e.t === w);
    if (inPair && solution.pair.every((e) => !e.w)) add('danDiao');
    else {
      for (const g of solution.groups) {
        if (g.some((e) => e.t === w) && g.every((e) => !e.w) && isSequenceGroup(g)) {
          const ranks = g.map((e) => rankOf(e.t)).sort((a, b) => a - b);
          if (ranks[1] === rankOf(w)) add('kanZhang');
          else if ((ranks[0] === 1 && ranks[2] === 3 && rankOf(w) === 3) ||
                   (ranks[0] === 7 && ranks[2] === 9 && rankOf(w) === 7)) add('bianZhang');
        }
      }
    }
  }

  // ---- 互斥过滤 ----
  const result = [];
  const rawKeys = new Set(raw.map((r) => r.key));
  for (const r of raw) {
    let blocked = false;
    for (const other of rawKeys) {
      if (other !== r.key && (SUPERSEDES[other] || []).includes(r.key)) { blocked = true; break; }
    }
    if (!blocked) result.push(r);
  }
  result.sort((a, b) => b.value - a.value);
  return result;
}

function isNineGates(counts, suit, laiziList, concealed) {
  const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  const wild = concealed.filter((t) => laiziList.includes(t)).length;
  for (let extra = 0; extra < 9; extra++) {
    let need = 0;
    let ok = true;
    for (let r = 0; r < 9; r++) {
      const id = suit * 9 + r;
      const target = base[r] + (r === extra ? 1 : 0);
      if (counts[id] > target) { ok = false; break; }
      need += target - counts[id];
    }
    if (ok && need === wild) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 完整分析                                                             */
/* ------------------------------------------------------------------ */

/**
 * 分析一次胡牌：形状 + 所有拆解 + 最优番型。
 * @param {object} p
 * @param {number[]} p.concealed 胡牌时手牌（已含胡的那张）
 * @param {Array} p.melds 副露
 * @param {number[]} p.laizi 癞子 id
 * @param {number|null} p.winningTile 胡的那张牌
 * @param {object} p.ctx 和牌上下文（见 engine 传参）
 * @param {object} p.rules 规则
 */
export function analyzeWin({ concealed, melds = [], laizi = [], winningTile = null, ctx = {}, rules }) {
  const empty = { winning: false, kind: null, fan: [], total: 0, meetsMinimum: false, scoreUnit: 0, solutions: [] };
  if (!rules) return empty;

  let kind = null;
  let solutionList = [];
  if (melds.length === 0) {
    if (rules.allowSevenPairs !== false && isSevenPairs(concealed, laizi)) kind = 'seven-pairs';
    else if (rules.allowThirteenOrphans !== false && isThirteenOrphans(concealed, laizi)) kind = 'thirteen-orphans';
  }
  if (!kind) {
    const expected = 14 - 3 * melds.length;
    if (concealed.length !== expected || concealed.length < 2) return empty;
    if ((concealed.length - 2) % 3 !== 0) return empty;
    solutionList = decompose(concealed, laizi);
    if (!solutionList.length) return empty;
    kind = 'standard';
  }

  if (rules.requiredQueYiMen) {
    const suits = realSuitsUsed(concealed, melds, laizi);
    let numbered = 0;
    for (const s of suits) if (s < 3) numbered++;
    if (numbered > 2) return empty;
  }

  let bestFan = null;
  let bestSolution = null;
  const evaluate = (sol) => evaluateFan(kind, sol, concealed, melds, laizi, winningTile, ctx, rules);
  if (kind === 'standard') {
    for (const sol of solutionList) {
      const fan = evaluate(sol);
      if (!bestFan || fanTotal(fan) > fanTotal(bestFan)) {
        bestFan = fan;
        bestSolution = sol;
      }
    }
  } else {
    bestSolution = { groups: [], pair: null };
    bestFan = evaluate(bestSolution);
  }

  const total = fanTotal(bestFan);
  const meetsMinimum = total >= (rules.minFan || 0);
  const scoreUnit = rules.scoringSet === SCORING_SETS.FAN_POINTS
    ? total
    : (rules.baseScore || 1) * Math.pow(2, total);

  return {
    winning: true,
    kind,
    fan: bestFan,
    total,
    meetsMinimum,
    scoreUnit,
    multiplier: rules.scoringSet === SCORING_SETS.FAN_POINTS ? 1 : Math.pow(2, total),
    solution: bestSolution,
    solutions: solutionList.length,
  };
}

function fanTotal(fan) {
  return fan.reduce((s, f) => s + f.value, 0);
}

/**
 * 番型名称表（设置界面/帮助文档展示用）。
 */
export function getFanCatalog(tableId) {
  const vals = VALUES[tableId] || {};
  return Object.keys(vals).map((key) => ({ key, ...F[key], value: vals[key] }));
}
