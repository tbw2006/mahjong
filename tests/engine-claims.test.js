/**
 * 引擎交互流程专项测试：碰、吃（癞子补位）、大明杠、抢杠胡、点炮胡、番数门槛。
 * 运行：node tests/engine-claims.test.js
 */

import { MahjongEngine } from '../src/core/engine.js';
import { getPreset, normalizeRules } from '../src/core/rules.js';
import { ACTIONS } from '../src/core/protocol.js';

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); }
}

function freshEngine(presetId = 'guangdong', seed = 42) {
  const rules = normalizeRules(getPreset(presetId)).rules;
  const engine = new MahjongEngine(rules, { seed, humanSeat: 0 });
  engine.startHand();
  return engine;
}

function junkHand(keep = []) {
  const h = [];
  let t = 27;
  while (h.length < 13) {
    if (!keep.includes(t)) h.push(t);
    t = (t + 1) % 34;
  }
  return h;
}

console.log('\n[碰（Pong）]');
{
  const e = freshEngine();
  const s = e.state;
  s.players[0].concealed = [...junkHand([5]), 5];
  s.currentSeat = 0;
  s.drawnTile = 5;
  s.mustDiscard = true;
  s.players[1].concealed = [5, 5, ...junkHand([])];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);

  let r = e.take({ type: ACTIONS.DISCARD, seat: 0, tile: 5 });
  check('舍牌后开启响应', r.ok && s.claim && s.claim.tile === 5);
  check('下家可碰', e.getClaimOptions(1, 5, 0).some((o) => o.claim === 'pong'));
  e.take({ type: ACTIONS.PASS, seat: 2 });
  e.take({ type: ACTIONS.PASS, seat: 3 });
  r = e.take({ type: ACTIONS.PONG, seat: 1, tile: 5 });
  check('碰成功', r.ok, r.error || '');
  check('碰后形成副露', s.players[1].melds.length === 1 && s.players[1].melds[0].type === 'pong');
  check('碰后轮到碰家出牌', s.currentSeat === 1 && s.mustDiscard);
  check('被碰的牌在牌河中标记移除', s.discardPool.some((d) => d.removed === true));
}

console.log('\n[吃 · 癞子补位]');
{
  const e = freshEngine('custom');
  const s = e.state;
  s.laizi = [33];
  s.players[1].concealed = [1, 33, 27, 28, 29, 30, 31, 32, 0, 3, 4, 5, 6];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);
  s.claim = { kind: 'discard', tile: 0, from: 0, poolEntry: null, responses: {}, seats: [1] };
  e.take({ type: ACTIONS.PASS, seat: 2 });
  e.take({ type: ACTIONS.PASS, seat: 3 });
  const r = e.take({ type: ACTIONS.CHI, seat: 1, tile: 0, a: 1, b: 2 });
  check('吃成功（2万缺 3万用癞子补）', r.ok, r.error || '');
  const meld = s.players[1].melds[0];
  check('副露为吃', meld && meld.type === 'chi');
  check('副露中含癞子实体', meld && meld.tiles.includes(33));
  check('癞子已从手牌移除', !s.players[1].concealed.includes(33));
}

console.log('\n[大明杠 · 杠后补牌]');
{
  const e = freshEngine();
  const s = e.state;
  s.players[0].concealed = [...junkHand([7]), 7];
  s.currentSeat = 0; s.drawnTile = 7; s.mustDiscard = true;
  s.players[1].concealed = [7, 7, 7, ...junkHand([])];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);
  const wallEndBefore = s.wall[s.wall.length - 1];
  e.take({ type: ACTIONS.DISCARD, seat: 0, tile: 7 });
  e.take({ type: ACTIONS.PASS, seat: 2 });
  e.take({ type: ACTIONS.PASS, seat: 3 });
  const r = e.take({ type: ACTIONS.GANG, seat: 1, tile: 7 });
  check('明杠成功', r.ok, r.error || '');
  check('杠家形成 4 张副露', s.players[1].melds[0]?.type === 'gang' && s.players[1].melds[0].tiles.length === 4);
  check('杠后从牌墙尾补牌', s.players[1].concealed.includes(wallEndBefore) && s.drawnTile === wallEndBefore);
  const discardTile = s.players[1].concealed.find((t) => t !== wallEndBefore);
  const r2 = e.take({ type: ACTIONS.DISCARD, seat: 1, tile: discardTile });
  check('杠后可以出牌', r2.ok, r2.error || '');
}

console.log('\n[抢杠胡]');
{
  const e = freshEngine();
  const s = e.state;
  const T = 31;
  s.players[0].melds = [{ type: 'pong', sub: 'exposed', tiles: [T, T, T], from: 2 }];
  s.players[0].concealed = [T, ...junkHand([])];
  s.currentSeat = 0; s.drawnTile = T; s.mustDiscard = true;
  // 下家：123万 456万 789万 + 111筒 + 中，单钓中
  s.players[1].concealed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);

  let r = e.take({ type: ACTIONS.BU_GANG, seat: 0, tile: T });
  check('补杠后开启抢杠响应', r.ok && s.claim?.kind === 'robGang', r.error || '');
  const opts = e.getClaimOptions(1, T, 0, 'robGang');
  check('下家可抢杠胡', opts.some((o) => o.claim === 'hu'));
  e.take({ type: ACTIONS.PASS, seat: 2 });
  e.take({ type: ACTIONS.PASS, seat: 3 });
  r = e.take({ type: ACTIONS.HU, seat: 1, tile: T });
  check('抢杠胡成功', r.ok && s.status === 'finished' && s.winInfo?.source === 'robGang', r.error || '');
  check('抢杠胡由杠家支付', s.winInfo?.payments[0]?.from === 0 && s.winInfo?.payments[0]?.to === 1);
  check('杠家副露升级为补杠', s.players[0].melds[0]?.sub === 'bu' && s.players[0].melds[0]?.tiles.length === 4);
  check('计分守恒', s.players.reduce((a, p) => a + p.score, 0) === 0);
}

console.log('\n[点炮胡与番数门槛]');
{
  const e = freshEngine();
  const s = e.state;
  s.players[0].concealed = [...junkHand([5]), 5];
  s.currentSeat = 0; s.drawnTile = 5; s.mustDiscard = true;
  s.players[1].concealed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 31];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);
  e.take({ type: ACTIONS.DISCARD, seat: 0, tile: 5 });
  e.take({ type: ACTIONS.PASS, seat: 2 });
  e.take({ type: ACTIONS.PASS, seat: 3 });
  // 这里下家单钓中，与 5 无关，不能胡
  check('无关牌不能胡', !e.getClaimOptions(1, 5, 0).some((o) => o.claim === 'hu'));
}

{
  const e = freshEngine('xianggang');
  const s = e.state;
  s.dealerSeat = 2; // 让舍牌者不是庄家，避免地胡 +5 番
  s.players[0].concealed = [...junkHand([31]), 31];
  s.currentSeat = 0; s.drawnTile = 31; s.mustDiscard = true;
  // 鸡胡手牌：123万 123筒 456筒 123条 + 单张中；胡中作将 → 仅门清 1 番（香港需 3 番起胡）
  s.players[1].concealed = [0, 1, 2, 9, 10, 11, 12, 13, 14, 18, 19, 20, 31];
  s.players[2].concealed = junkHand([]);
  s.players[3].concealed = junkHand([]);
  e.take({ type: ACTIONS.DISCARD, seat: 0, tile: 31 });
  const opts = e.getClaimOptions(1, 31, 0);
  const hasHu = opts.some((o) => o.claim === 'hu');
  check('香港麻将鸡胡不满 3 番不能胡', !hasHu, JSON.stringify(opts));
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed) {
  console.error('失败项：', fails.join(' / '));
  process.exit(1);
}
