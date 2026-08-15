/**
 * 玩法规则配置。
 *
 * 每个规则集都是纯数据对象，便于：
 *   - 序列化后随对局状态一起联网传输；
 *   - 未来新增玩法只需在 PRESETS 中登记，无需改动引擎。
 */

export const SCORING_SETS = {
  /** 广东/香港/四川/自定义：番数按 2^番 翻倍 */
  FAN_DOUBLE: 'fan-double',
  /** 国标：番点累加，≥ 起胡点 */
  FAN_POINTS: 'fan-points',
};

export const FAN_TABLES = {
  GUANGDONG: 'guangdong',
  XIANGGANG: 'xianggang',
  SICHUAN: 'sichuan',
  GUOBIAO: 'guobiao',
  CUSTOM: 'custom',
};

const SUIT_ALL = [true, true, true];

/** 各预设规则 */
export const PRESETS = [
  {
    id: 'guangdong',
    name: '广东麻将 · 鸡胡',
    shortName: '广东麻将',
    desc: '经典鸡胡推倒胡：全牌张、只碰杠不能吃、0番起胡、按 2^番 翻倍。点炮由放炮者单付，自摸三家各付。',
    suits: SUIT_ALL.slice(), dragons: true, winds: true, copies: 4,
    laiziCount: 0,
    scoringSet: SCORING_SETS.FAN_DOUBLE,
    fanTable: FAN_TABLES.GUANGDONG,
    minFan: 0,
    baseScore: 1,
    allowChi: false, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: true,
    dealerDouble: false,
    requiredQueYiMen: false,
    allowSevenPairs: true,
    allowThirteenOrphans: true,
  },
  {
    id: 'guobiao',
    name: '国标麻将 · 8番起胡',
    shortName: '国标麻将',
    desc: '国标规则（番点累加）：全牌张、可吃碰杠、8番点起胡。大三元 88 点、清一色 24 点、七对 24 点等。',
    suits: SUIT_ALL.slice(), dragons: true, winds: true, copies: 4,
    laiziCount: 0,
    scoringSet: SCORING_SETS.FAN_POINTS,
    fanTable: FAN_TABLES.GUOBIAO,
    minFan: 8,
    baseScore: 1,
    allowChi: true, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: true,
    dealerDouble: false,
    requiredQueYiMen: false,
    allowSevenPairs: true,
    allowThirteenOrphans: true,
  },
  {
    id: 'sichuan',
    name: '四川麻将 · 血战简版',
    shortName: '四川麻将',
    desc: '只留万筒条（无字无风）、必须缺一门、只碰杠不能吃。血战到底为多向结算，本作先实现单局结算简版。',
    suits: SUIT_ALL.slice(), dragons: false, winds: false, copies: 4,
    laiziCount: 0,
    scoringSet: SCORING_SETS.FAN_DOUBLE,
    fanTable: FAN_TABLES.SICHUAN,
    minFan: 0,
    baseScore: 1,
    allowChi: false, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: false,
    dealerDouble: false,
    requiredQueYiMen: true,
    allowSevenPairs: true,
    allowThirteenOrphans: false,
  },
  {
    id: 'xianggang',
    name: '香港麻将 · 3番起胡',
    shortName: '香港麻将',
    desc: '全牌张、可吃碰杠、3番起胡、按 2^番 翻倍。番型与广东麻将接近，鼓励做大牌。',
    suits: SUIT_ALL.slice(), dragons: true, winds: true, copies: 4,
    laiziCount: 0,
    scoringSet: SCORING_SETS.FAN_DOUBLE,
    fanTable: FAN_TABLES.XIANGGANG,
    minFan: 3,
    baseScore: 1,
    allowChi: true, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: true,
    dealerDouble: false,
    requiredQueYiMen: false,
    allowSevenPairs: true,
    allowThirteenOrphans: true,
  },
  {
    id: 'laizi',
    name: '癞子麻将 · 四癞翻倍',
    shortName: '癞子麻将',
    desc: '翻牌定癞：开牌后翻指示牌，其下一张起的连续 4 张为癞子（万能牌），可代替任意牌，计分同样按番翻倍。',
    suits: SUIT_ALL.slice(), dragons: true, winds: true, copies: 4,
    laiziCount: 4,
    scoringSet: SCORING_SETS.FAN_DOUBLE,
    fanTable: FAN_TABLES.CUSTOM,
    minFan: 0,
    baseScore: 1,
    allowChi: true, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: true,
    dealerDouble: false,
    requiredQueYiMen: false,
    allowSevenPairs: true,
    allowThirteenOrphans: true,
  },
  {
    id: 'custom',
    name: '自定义玩法',
    shortName: '自定义',
    desc: '自由组合：万筒条、字牌（中发白）、风牌（东南西北）、癞子数量、起胡番、吃碰杠开关，底分均可调节。',
    suits: SUIT_ALL.slice(), dragons: true, winds: true, copies: 4,
    laiziCount: 0,
    scoringSet: SCORING_SETS.FAN_DOUBLE,
    fanTable: FAN_TABLES.CUSTOM,
    minFan: 0,
    baseScore: 1,
    allowChi: true, allowPong: true, allowGang: true,
    allowLaiziGang: false,
    payMode: 'discarder-single',
    dealerStaysOnWin: true,
    dealerStaysOnDraw: true,
    dealerDouble: false,
    requiredQueYiMen: false,
    allowSevenPairs: true,
    allowThirteenOrphans: true,
  },
];

/** 按 id 取预设 */
export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

/** 深拷贝规则（自定义界面修改前先克隆） */
export function cloneRules(rule) {
  return JSON.parse(JSON.stringify(rule));
}

/**
 * 校验并规范化规则。
 * @returns {{ok:boolean, error?:string, rules?:object}}
 */
export function normalizeRules(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: '规则为空' };
  const rules = typeof input.id === 'string' && input.id !== 'custom' ? { ...getPreset(input.id) } : { ...getPreset('custom'), ...input };

  rules.suits = Array.isArray(rules.suits) ? rules.suits.slice(0, 3).map(Boolean) : [true, true, true];
  if (!rules.suits.some(Boolean)) return { ok: false, error: '万/筒/条至少保留一种花色' };

  rules.dragons = !!rules.dragons;
  rules.winds = !!rules.winds;
  rules.copies = 4;
  rules.laiziCount = Math.max(0, Math.min(8, Number(rules.laiziCount) || 0));
  if (rules.laiziCount > 0 && !rules.suits.some(Boolean)) return { ok: false, error: '有癞子时至少保留一种数牌花色' };

  rules.minFan = Math.max(0, Math.min(20, Number(rules.minFan) || 0));
  rules.baseScore = Math.max(1, Math.min(100, Number(rules.baseScore) || 1));
  rules.allowChi = !!rules.allowChi;
  rules.allowPong = !!rules.allowPong;
  rules.allowGang = !!rules.allowGang;
  rules.allowLaiziGang = false;
  rules.allowSevenPairs = rules.allowSevenPairs !== false;
  rules.allowThirteenOrphans = rules.allowThirteenOrphans !== false;
  rules.requiredQueYiMen = !!rules.requiredQueYiMen;
  rules.dealerStaysOnWin = rules.dealerStaysOnWin !== false;
  rules.dealerStaysOnDraw = rules.dealerStaysOnDraw !== false;
  rules.dealerDouble = !!rules.dealerDouble;
  rules.payMode = rules.payMode || 'discarder-single';
  rules.scoringSet = rules.scoringSet || SCORING_SETS.FAN_DOUBLE;
  rules.fanTable = rules.fanTable || FAN_TABLES.CUSTOM;
  rules.tilesPerHand = 13;

  return { ok: true, rules };
}

/** 规则摘要文本（设置页/结算页展示） */
export function describeRules(rules) {
  const parts = [];
  parts.push(rules.suits[0] ? '万' : '无万');
  parts.push(rules.suits[1] ? '筒' : '无筒');
  parts.push(rules.suits[2] ? '条' : '无条');
  if (rules.dragons) parts.push('字牌');
  if (rules.winds) parts.push('风牌');
  parts.push(rules.laiziCount > 0 ? `癞子×${rules.laiziCount}` : '无癞子');
  parts.push(`${rules.minFan}番起胡`);
  parts.push(rules.allowChi ? '可吃' : '不可吃');
  parts.push(rules.allowPong ? '可碰' : '不可碰');
  parts.push(rules.allowGang ? '可杠' : '不可杠');
  if (rules.requiredQueYiMen) parts.push('缺一门');
  return parts.join(' · ');
}
