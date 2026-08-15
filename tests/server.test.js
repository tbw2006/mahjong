/**
 * 服务器端到端测试：
 *   两个真实 WebSocket 客户端 → 建房/加入 → 开局 → 人类按提示出牌/过、电脑托管其余动作
 *   → 一局结束（胡或流局）→ 断线后凭 sessionId 重连恢复座位。
 * 运行：node tests/server.test.js （默认端口 18123）
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { getPreset, normalizeRules } from '../src/core/rules.js';

const PORT = Number(process.env.TEST_PORT || 18123);
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); }
}

class TestClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.messages = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        this.messages.push(msg);
        // 只消费匹配的等待器，不匹配的保留等待后续消息
        const still = [];
        for (const w of this.waiters) {
          if (msg.type === w.type && w.predicate(msg)) {
            clearTimeout(w.timer);
            w.resolve(msg);
          } else {
            still.push(w);
          }
        }
        this.waiters = still;
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  waitFor(type, predicate = () => true, timeout = 15000) {
    const existing = this.messages.find((m) => m.type === type && predicate(m));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => reject(new Error(`${this.name} 等待 ${type} 超时`)), timeout);
      this.waiters.push(waiter);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function playUntilFinished(client, other) {
  let guard = 0;
  while (guard++ < 2500) {
    // 收集两个客户端中属于“我的”提示：消息可能同时发给两人
    const prompt = client.messages.find((m) => m.type === 'prompt');
    if (prompt) {
      client.messages = client.messages.filter((m) => m !== prompt);
      if (prompt.kind === 'turn') {
        const discard = prompt.options?.discard?.[0];
        if (discard === undefined) throw new Error('没有可出牌选项');
        client.send({ type: 'action', action: { type: 'discard', seat: prompt.seat, tile: discard } });
      } else {
        client.send({ type: 'action', action: { type: 'pass', seat: prompt.seat } });
      }
    }
    // 服务器会把对局状态同步给两人，检查是否结束
    const sync = client.messages.find((m) => m.type === 'sync' && m.state?.status === 'finished');
    if (sync) {
      client.messages = [];
      return sync.state;
    }
    if (other) {
      const p2 = other.messages.find((m) => m.type === 'prompt');
      if (p2) {
        other.messages = other.messages.filter((m) => m !== p2);
        if (p2.kind === 'turn') {
          const d = p2.options?.discard?.[0];
          other.send({ type: 'action', action: { type: 'discard', seat: p2.seat, tile: d } });
        } else {
          other.send({ type: 'action', action: { type: 'pass', seat: p2.seat } });
        }
      }
    }
    await sleep(60);
  }
  throw new Error('对局超时未结束');
}

const server = spawn('node', ['server/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), BOT_FAST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
server.stderr.on('data', (d) => { stderr += d.toString(); });

async function main() {
  // 等待端口就绪
  for (let i = 0; i < 50; i++) {
    try {
      const probe = new WebSocket(WS_URL);
      await new Promise((res, rej) => { probe.on('open', () => { probe.close(); res(); }); probe.on('error', rej); });
      break;
    } catch {
      await sleep(120);
    }
  }

  console.log('\n[建房 / 加入 / 开局]');
  const A = new TestClient('A');
  const B = new TestClient('B');
  await A.connect();
  const rules = normalizeRules(getPreset('guangdong')).rules;
  A.send({ type: 'create-room', name: '测试员A', rules });

  const joinedA = await A.waitFor('joined');
  check('房主创建成功并获得房间码', /^[A-Z0-9]{6}$/.test(joinedA.roomId || ''), JSON.stringify(joinedA));
  check('房主座位为 0', joinedA.seat === 0);

  await B.connect();
  B.send({ type: 'join-room', roomId: joinedA.roomId, name: '测试员B' });
  const joinedB = await B.waitFor('joined');
  check('第二人加入成功', joinedB.roomId === joinedA.roomId && joinedB.seat === 1, JSON.stringify(joinedB));

  await A.waitFor('room-update', (m) => m.players.filter(Boolean).length === 2);
  check('房间列表出现两名玩家', true);

  A.send({ type: 'start' });
  const syncA = await A.waitFor('sync');
  check('开局后收到同步状态', syncA.state?.status === 'playing', syncA.state?.status || '无状态');
  check('自己手牌可见', Array.isArray(syncA.state.players[0].concealed) && syncA.state.players[0].concealed.length >= 13);
  check('他人手牌被遮蔽', syncA.state.players[1].concealed.every((t) => t === -1));

  console.log('\n[双人 + 电脑完整对局]');
  const finalState = await playUntilFinished(A, B);
  check('对局在一局内结束', finalState.status === 'finished');
  if (finalState.winInfo) {
    const sum = finalState.players.reduce((s, p) => s + p.score, 0);
    check('胡牌计分守恒', sum === 0, `总分=${sum}`);
    check('结算信息完整', finalState.winInfo.analysis && finalState.winInfo.analysis.total >= 0);
  } else {
    check('流局处理正常', finalState.drawGame === true);
  }

  console.log('\n[断线托管与重连]');
  const seatB = joinedB.seat;
  B.close();
  await sleep(800);
  const C = new TestClient('B重连');
  await C.connect();
  C.send({ type: 'join-room', roomId: joinedA.roomId, sessionId: joinedB.sessionId, name: '测试员B' });
  const rejoin = await C.waitFor('joined');
  check('凭 sessionId 重连成功', rejoin.seat === seatB, `seat=${rejoin.seat}`);
  let rejoinSync = null;
  try { rejoinSync = await C.waitFor('sync', () => true, 5000); } catch { /* 忽略 */ }
  check('重连后收到同步快照', !!rejoinSync && !!rejoinSync.state, JSON.stringify(rejoinSync || {}).slice(0, 120));

  C.close();
  A.close();
  server.kill('SIGTERM');
  await sleep(200);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (stderr) console.error('server stderr:', stderr);
  if (failed) {
    console.error('失败项：', fails.join(' / '));
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error('FATAL', e.message || e);
  server.kill('SIGTERM');
  process.exit(1);
});
