/**
 * 牌张基础定义。
 *
 * 牌编号（id）方案（0..33）：
 *   0..8   万子 1万..9万
 *   9..17  筒子 1筒..9筒
 *   18..26 条子 1条..9条
 *   27..30 风牌 东南西北
 *   31..33 字牌（箭牌）中发白
 *
 * 该编号天然满足常用排序：万 → 筒 → 条 → 风 → 箭。
 */

export const SUIT = { WAN: 0, TONG: 1, TIAO: 2, HONOR: 3 };
export const WIND_START = 27;
export const DRAGON_START = 31;
export const TILE_COUNT = 34;

const NAMES = [
  '一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条',
  '东风', '南风', '西风', '北风', '红中', '发财', '白板',
];

const SHORT_NAMES = [
  '1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万',
  '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒',
  '1条', '2条', '3条', '4条', '5条', '6条', '7条', '8条', '9条',
  '东', '南', '西', '北', '中', '发', '白',
];

/** 获取牌名 */
export function tileName(id) {
  return NAMES[id] ?? '?';
}

/** 获取短名 */
export function tileShortName(id) {
  return SHORT_NAMES[id] ?? '?';
}

/** 花色：0 万 / 1 筒 / 2 条 / 3 字 */
export function suitOf(id) {
  if (id < 9) return SUIT.WAN;
  if (id < 18) return SUIT.TONG;
  if (id < 27) return SUIT.TIAO;
  return SUIT.HONOR;
}

/** 数牌点数 1..9；字牌返回 null */
export function rankOf(id) {
  if (id < 27) return (id % 9) + 1;
  return null;
}

export function isNumbered(id) { return id < 27; }
export function isHonor(id) { return id >= 27; }
export function isWind(id) { return id >= 27 && id <= 30; }
export function isDragon(id) { return id >= 31 && id <= 33; }
export function isTerminal(id) {
  const r = rankOf(id);
  return r === 1 || r === 9;
}
export function isLaiziTile(id, laiziList = []) {
  return laiziList.includes(id);
}

/** 是否为同花顺候选（严格递增三步） */
export function isSequence(a, b, c) {
  const s = suitOf(a);
  if (s === SUIT.HONOR) return false;
  if (suitOf(b) !== s || suitOf(c) !== s) return false;
  const ra = rankOf(a), rb = rankOf(b), rc = rankOf(c);
  if (ra === null || rb === null || rc === null) return false;
  return ra + 1 === rb && rb + 1 === rc;
}

/** 排序键：即 id（已按 万筒条风箭 排好） */
export function sortKey(id) {
  return id;
}

/** 翻癞子的“下一张”：万1..9 → 筒1..9 → 条1..9 → 东南西北中发白 → 回一万 */
export function nextTile(id) {
  return id >= TILE_COUNT - 1 ? 0 : id + 1;
}

/**
 * 根据翻出的指示牌计算癞子列表。
 * @param {number} indicator 指示牌 id
 * @param {number} count 癞子张数（0..8）
 */
export function laiziFromIndicator(indicator, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(nextTile((indicator + i) % TILE_COUNT));
  }
  return list;
}

/**
 * 构建整副牌墙。
 * @param {object} tileConfig {suits:[bool,bool,bool], dragons:bool, winds:bool, copies:number}
 * @returns {number[]}
 */
export function buildTileSet({ suits = [true, true, true], dragons = true, winds = true, copies = 4 } = {}) {
  const set = [];
  const push = (id) => {
    for (let i = 0; i < copies; i++) set.push(id);
  };
  for (let s = 0; s < 3; s++) {
    if (!suits[s]) continue;
    for (let r = 0; r < 9; r++) push(s * 9 + r);
  }
  if (winds) for (let i = WIND_START; i <= 30; i++) push(i);
  if (dragons) for (let i = DRAGON_START; i <= 33; i++) push(i);
  return set;
}

/** 统计每张牌数量 */
export function countTiles(tiles) {
  const counts = new Array(TILE_COUNT).fill(0);
  for (const t of tiles) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

/** 从数组里移除一张指定牌（不区分同 id 副本），失败返回 null */
export function removeOne(arr, tile) {
  const i = arr.indexOf(tile);
  if (i < 0) return null;
  return arr.splice(i, 1)[0];
}
