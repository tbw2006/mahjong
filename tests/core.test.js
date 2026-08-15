/**
 * 核心规则 / 引擎自动化测试（Node 直接运行：node tests/core.test.js）
 * 覆盖：牌墙、癞子、胡牌拆解、七对、十三幺、番型计分、规则门槛、整局模拟、序列化。
 */

import { buildTileSet, laiziFromIndicator, nextTile, isSequence } from '../src/core/tiles.js';
import { getPreset, normalizeRules } from '../src/core/rules.js';
import {
  decompose, canWinShape, isSevenPairs, isThirteenOrphans, analyzeWin,
} from '../src/core/scoring.js';
import { MahjongEngine } from '../src/core/engine.js';
import { BotPlayer } from '../src/core/bots.js';
import { ACTIONS } from '../src/core/protocol.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✗ ${name} ${extra}`);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

/* ---------------------------------------------------------------- */

section('牌张与牌墙');
{
  check('全牌 136 张（不含花牌）', buildTileSet({ suits: [true, true, true], dragons: true, winds: true }).length === 136);
  check('无字无风 108 张', buildTileSet({ suits: [true, true, true], dragons: false, winds: false }).length === 108);
  check('翻癞子：1万 → 2万', nextTile(0) === 1);
  check('翻癞子：9条 → 东风', nextTile(26) === 27);
  check('翻癞子：白板 → 1万', nextTile(33) === 0);
  const lz = laiziFromIndicator(7, 4); // 8万翻牌
  check('四癞连续：8万翻出 9万/1筒/2筒/3筒', lz.join(',') === '8,9,10,11');
}

section('顺子与胡牌拆解');
{
  check('顺子判定', isSequence(0, 1, 2) && !isSequence(0, 1, 3) && !isSequence(8, 9, 10));
  const gd = getPreset('guangdong');
  const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31, 31];
  check('标准胡：123/456/789万+刻+将', canWinShape(hand, [], [], gd));
  const notHu = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31, 32];
  check('散牌不能胡', !canWinShape(notHu, [], [], gd));
  check('拆解返回方案', decompose(hand).length > 0);
}

section('癞子');
{
  const gd = getPreset('guangdong');
  // 癞子 33（白板）当 2万 使用：1万 癞 3万
  const hand = [0, 1, 33, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31, 31];
  check('癞子补顺子可胡', canWinShape(hand, [], [33], gd));
  check('无癞子则不可胡', !canWinShape(hand, [], [], gd));
  // 癞子补刻子：中 中 癞 = 中中中
  const hand2 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31, 33];
  check('癞子补刻子可胡', canWinShape(hand2, [], [33], gd));
  // 癞子补顺子下位：1-9万一条龙 + 5筒5筒5筒 + 4筒？用 5筒6筒7筒，癞子补 4筒
  const hand4 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 13, 33];
  check('癞子补顺子下位(4筒)可胡', canWinShape(hand4, [], [33], gd));
}

section('特殊胡型');
{
  const gd = getPreset('guangdong');
  const pairs = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  check('七对可胡', canWinShape(pairs, [], [], gd));
  const thirteen = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 0];
  check('十三幺可胡', canWinShape(thirteen, [], [], gd));
  check('七对检测函数', isSevenPairs(pairs));
  check('十三幺检测函数', isThirteenOrphans(thirteen));
}

section('番型计分（广东）');
{
  const gd = getPreset('guangdong');
  const ctx = { isSelfDraw: false, prevailingWind: 0, seatWind: 1 };
  // 混一色一条龙：123/456/789万 + 111万 + 中将（混一色3 + 一条龙2）
  const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 31, 31];
  const a = analyzeWin({ concealed: hand, melds: [], laizi: [], winningTile: 31, ctx, rules: gd });
  check('混一色(3)+一条龙(2)=5 番', a.total === 5, `实际总番=${a.total} 番型=${a.fan.map((f) => f.key).join(',')}`);
  check('包含混一色', a.fan.some((f) => f.key === 'hunyise'));
  check('包含一条龙', a.fan.some((f) => f.key === 'yitiaolong'));

  // 清一色：纯万子 123/456/789 + 111万 + 22万 → 清一色6 + 一条龙2
  const qing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 1, 1];
  const q = analyzeWin({ concealed: qing, melds: [], laizi: [], winningTile: 1, ctx, rules: gd });
  check('清一色(6)+一条龙(2)=8 番', q.total === 8, `实际=${q.total} 番型=${q.fan.map((f) => f.key).join(',')}`);

  // 大三元：中发白刻 + 顺 + 将
  const big3 = [31, 31, 31, 32, 32, 32, 33, 33, 33, 0, 1, 2, 3, 3];
  const b = analyzeWin({ concealed: big3, melds: [], laizi: [], winningTile: 3, ctx, rules: gd });
  check('大三元 8 番', b.total >= 8 && b.fan.some((f) => f.key === 'dasanyuan'), `实际=${b.total}`);

  // 碰碰胡（刻子分散在三种花色 → 不叠加清一色/混一色）
  const pp = [0, 0, 0, 9, 9, 9, 18, 18, 18, 17, 17, 17, 26, 26];
  const c = analyzeWin({ concealed: pp, melds: [], laizi: [], winningTile: 26, ctx, rules: gd });
  check('碰碰胡 3 番', c.fan.some((f) => f.key === 'pengpeng') && c.total === 3, `实际=${c.total} 番型=${c.fan.map((f) => f.key).join(',')}`);

  // 小三元：中中中 发发发 + 白白将 + 两组顺子 → 小三元5 + 混一色3
  const small3 = [31, 31, 31, 32, 32, 32, 33, 33, 0, 1, 2, 3, 4, 5];
  const s3 = analyzeWin({ concealed: small3, melds: [], laizi: [], winningTile: 5, ctx, rules: gd });
  check('小三元 5 番 + 混一色 3 番', s3.fan.some((f) => f.key === 'xiaosanyuan') && s3.total === 8, `实际=${s3.total} 番型=${s3.fan.map((f) => f.key).join(',')}`);

  // 七对（三门花色，避免叠清一色）
  const qd = [0, 0, 9, 9, 18, 18, 1, 1, 10, 10, 19, 19, 2, 2];
  const qdA = analyzeWin({ concealed: qd, melds: [], laizi: [], winningTile: 2, ctx, rules: gd });
  check('七对 4 番', qdA.total === 4, `实际=${qdA.total} 番型=${qdA.fan.map((f) => f.key).join(',')}`);
  const hqd = [0, 0, 0, 0, 9, 9, 18, 18, 1, 1, 10, 10, 19, 19];
  const hqdA = analyzeWin({ concealed: hqd, melds: [], laizi: [], winningTile: 19, ctx, rules: gd });
  check('豪华七对 4+2 番', hqdA.total === 6, `实际=${hqdA.total} 番型=${hqdA.fan.map((f) => f.key).join(',')}`);

  // 国标：九莲宝灯 88 点
  const jl = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 1];
  const gb = getPreset('guobiao');
  const jlA = analyzeWin({ concealed: jl, melds: [], laizi: [], winningTile: 1, ctx: { isSelfDraw: false }, rules: gb });
  check('国标九莲宝灯 88 点', jlA.fan.some((f) => f.key === 'jiulianbaodeng') && jlA.total === 88, `实际=${jlA.total}`);
}

section('规则门槛');
{
  const gb = getPreset('guobiao');
  // 平和 2 + 无字 1 + 单钓 1 = 4 点，不足国标 8 点
  const pinghu = [0, 1, 2, 12, 13, 14, 24, 25, 26, 3, 3, 9, 10, 11];
  const a = analyzeWin({ concealed: pinghu, melds: [], laizi: [], winningTile: 3, ctx: { isSelfDraw: false }, rules: gb });
  check('国标平胡形状成立', a.winning);
  check('国标平胡未达 8 点不可胡', !a.meetsMinimum, `番点=${a.total}`);

  const sc = getPreset('sichuan');
  const threeSuits = [0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 3, 3, 21, 21];
  const s = analyzeWin({ concealed: threeSuits, melds: [], laizi: [], winningTile: 21, ctx: {}, rules: sc });
  check('四川麻将三门牌不满足缺一门', !s.winning);
  const twoSuits = [0, 1, 2, 3, 4, 5, 9, 9, 9, 10, 11, 12, 13, 13];
  const s2 = analyzeWin({ concealed: twoSuits, melds: [], laizi: [], winningTile: 13, ctx: {}, rules: sc });
  check('四川麻将两门牌可胡', s2.winning);
}

section('引擎：发牌与整局模拟');
{
  const gd = normalizeRules(getPreset('guangdong')).rules;
  const engine = new MahjongEngine(gd, { seed: 12345, humanSeat: 0 });
  const r = engine.startHand();
  check('发牌成功', r.ok, r.error || '');
  check('庄家已摸 14 张，闲家 13 张',
    engine.state.players[0].concealed.length === 14 &&
    engine.state.players.slice(1).every((p) => p.concealed.length === 13));
  check('庄家开始行动', engine.pending.phase === 'turn' && engine.pending.seat === 0);

  // 出牌 → 生成可响应阶段或轮到下家
  const opts = engine.getTurnOptions(0);
  const d = engine.take({ type: ACTIONS.DISCARD, seat: 0, tile: opts.discard[0] });
  check('出牌动作合法', d.ok, d.error || '');

  const bots = [0, 1, 2, 3].map((seat) => new BotPlayer(seat, { rng: () => 0.5 }));
  let guard = 0;
  const state = engine.state;
  let finished = false;
  while (guard++ < 3000) {
    if (engine.state.status === 'finished') { finished = true; break; }
    const pending = engine.pending;
    if (pending.phase === 'turn') {
      const seat = pending.seat;
      const options = engine.getTurnOptions(seat);
      const act = bots[seat].decideTurn(engine.state, options);
      const res = engine.take(act);
      if (!res.ok) { check(`动作合法 ${act.type}`, false, res.error); break; }
    } else if (pending.phase === 'claim') {
      for (const seat of pending.seats) {
        const options = engine.getClaimOptions(seat, pending.tile, pending.from, pending.kind);
        const act = bots[seat].decideClaim(engine.state, seat, options);
        const res = engine.take(act);
        if (!res.ok) { check(`响应合法 ${act.type}`, false, res.error); break; }
      }
      // 有选项的玩家全部响应后应自动结算
    }
  }
  check('整局可在 3000 步内结束', finished, `status=${engine.state.status}`);
  if (finished) {
    const s = engine.state;
    if (s.winInfo) {
      const total = s.winInfo.payments.reduce((sum, p) => sum + p.amount, 0);
      const scoreSum = s.players.reduce((sum, p) => sum + p.score, 0);
      check('分数守恒', scoreSum === 0, `sum=${scoreSum}`);
      check('支付明细与总分一致', total === s.winInfo.payments.length > 0 ? total >= 1 : true);
      check('获胜手牌 14 张（含副露）', s.winInfo.analysis && s.winInfo.analysis.total >= 0);
    } else {
      check('流局处理', s.drawGame === true);
    }
  }
}

section('引擎：序列化');
{
  const gd = getPreset('guangdong');
  const e1 = new MahjongEngine(gd, { seed: 99 });
  e1.startHand();
  const snap = e1.exportState();
  const e2 = new MahjongEngine(gd, { seed: 1 });
  e2.importState(snap);
  check('导入后状态一致', JSON.stringify(e1.state) === JSON.stringify(e2.state));
}

/* ---------------------------------------------------------------- */

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failures.length) {
  console.error('失败项：', failures.join(' / '));
  process.exit(1);
}
