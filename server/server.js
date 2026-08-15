/**
 * 雅趣麻将 · 公网权威服务器
 *
 *  - 同端口提供：静态页面服务 + WebSocket 游戏服务（部署时一个进程即可）
 *  - 服务器持有 MahjongEngine：所有动作先经 take() 全量规则校验才广播
 *  - 房间码建房/加入；游戏中断线由 BotPlayer 托管，可用 sessionId 重连恢复快照
 *  - 人机混合：少于 4 人时由机器人补位
 *  - 操作倒计时：出牌 25 秒、响应 8 秒，超时自动出牌/过
 *
 * 运行：node server/server.js  （PORT 环境变量可改端口）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { MahjongEngine } from '../src/core/engine.js';
import { BotPlayer } from '../src/core/bots.js';
import { normalizeRules } from '../src/core/rules.js';
import { ACTIONS } from '../src/core/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8000);
const TURN_MS = 25000;
const CLAIM_MS = 8000;
const NEXT_HAND_MS = 7000;
const LOBBY_GC_MS = 120000;

/* ------------------------------------------------------------------ */
/* 静态文件                                                             */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // 联机客户端升级频繁，html/js/css 不缓存；素材可缓存
      'Cache-Control': ext === '.svg' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */
/* 房间管理                                                             */
/* ------------------------------------------------------------------ */

const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code));
  return code;
}

const BOT_NAMES = ['电脑·下家', '电脑·对家', '电脑·上家'];

function makeRoom(rules, hostName) {
  const players = [null, null, null, null];
  const room = {
    id: genCode(),
    phase: 'lobby',
    hostSeat: 0,
    rules,
    players,
    engine: null,
    seed: crypto.randomInt(0x7fffffff),
    timers: {},
    promptedTurnKey: null,
    promptedClaim: null,
    nextHandTimer: null,
    createdAt: Date.now(),
    lastHumanAt: Date.now(),
  };
  players[0] = {
    name: hostName || '玩家',
    ws: null,
    sessionId: crypto.randomUUID(),
    connected: true,
    isBot: false,
    managedByBot: false,
    ready: true,
  };
  rooms.set(room.id, room);
  return room;
}

function publicPlayers(room) {
  return room.players.map((p, seat) => p ? {
    seat,
    name: p.managedByBot ? `${p.name}（托管中）` : p.name,
    isBot: p.isBot,
    connected: p.connected,
    ready: p.ready,
    isHost: seat === room.hostSeat,
  } : null);
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }
}

function broadcast(room, msg, exceptSeat = null) {
  for (const p of room.players) {
    if (p && p.ws && p.connected && p.seat !== exceptSeat) send(p.ws, msg);
  }
}

function sendRoomUpdate(room) {
  broadcast(room, {
    type: 'room-update',
    roomId: room.id,
    phase: room.phase,
    hostSeat: room.hostSeat,
    rules: room.rules,
    players: publicPlayers(room),
  });
}

function findPlayerByWs(ws) {
  for (const room of rooms.values()) {
    for (let seat = 0; seat < 4; seat++) {
      const p = room.players[seat];
      if (p && p.ws === ws) return { room, seat, p };
    }
  }
  return null;
}

function clearSeatTimers(room, seat) {
  if (room.timers[seat]) {
    clearTimeout(room.timers[seat]);
    delete room.timers[seat];
  }
}

function clearAllTimers(room) {
  for (const seat of Object.keys(room.timers)) clearSeatTimers(room, seat);
  room.promptedTurnKey = null;
  room.promptedClaim = null;
}

/* ------------------------------------------------------------------ */
/* 座位视角状态（信息隐藏：别人手牌只保留张数）                          */
/* ------------------------------------------------------------------ */

function viewState(engineState, seat) {
  const s = JSON.parse(JSON.stringify(engineState));
  for (let i = 0; i < 4; i++) {
    if (i === seat) continue;
    const p = s.players[i];
    p.concealed = new Array(p.concealed.length).fill(-1);
  }
  if (s.drawnTile !== null && s.currentSeat !== seat) s.drawnTile = null;
  return s;
}

function filterEvent(evt, seat) {
  if (!evt || !evt.visibleTo || evt.visibleTo.includes(seat)) return evt;
  const copy = { ...evt };
  delete copy.tile; // draw/replacement-draw 的私有牌面
  delete copy.hand;
  delete copy.melds;
  delete copy.visibleTo;
  return copy;
}

function broadcastGame(room, events = []) {
  for (const p of room.players) {
    if (!p || !p.ws || !p.connected) continue;
    const seat = p.seat;
    send(p.ws, {
      type: 'sync',
      roomId: room.id,
      phase: room.phase,
      state: viewState(room.engine.state, seat),
      events: events.map((e) => filterEvent(e, seat)),
      yourSeat: seat,
    });
  }
}

/* ------------------------------------------------------------------ */
/* 对局推进                                                             */
/* ------------------------------------------------------------------ */

function isBotish(room, seat) {
  const p = room.players[seat];
  return !p || p.isBot || !p.connected || p.managedByBot;
}

function scheduleBotTurn(room, seat, delay = 450 + Math.random() * 500) {
  if (room.timers[seat]) return;
  room.timers[seat] = setTimeout(() => {
    delete room.timers[seat];
    if (!room.engine || room.engine.state.status !== 'playing') return;
    const pending = room.engine.pending;
    if (pending.phase !== 'turn' || pending.seat !== seat) return;
    const bot = new BotPlayer(seat, { rng: Math.random });
    const options = room.engine.getTurnOptions(seat);
    const act = bot.decideTurn(room.engine.state, options);
    const res = room.engine.take(act);
    afterTake(room, res);
  }, delay);
}

function scheduleBotClaim(room, seat, delay = 300 + Math.random() * 400) {
  if (room.timers[seat]) return;
  room.timers[seat] = setTimeout(() => {
    delete room.timers[seat];
    if (!room.engine) return;
    const st = room.engine.state;
    if (!st.claim || st.claim.responses[seat]) return;
    const pending = room.engine.pending;
    const bot = new BotPlayer(seat, { rng: Math.random });
    const options = room.engine.getClaimOptions(seat, st.claim.tile, st.claim.from, st.claim.kind);
    const act = bot.decideClaim(st, seat, options);
    const res = room.engine.take(act);
    afterTake(room, res);
  }, delay);
}

function promptHumanTurn(room, seat) {
  const st = room.engine.state;
  const key = `${seat}:${st.turnCount}:${st.drawnTile}`;
  if (room.promptedTurnKey === key) return;
  room.promptedTurnKey = key;
  const options = room.engine.getTurnOptions(seat);
  const p = room.players[seat];
  send(p.ws, {
    type: 'prompt',
    kind: 'turn',
    seat,
    options,
    deadline: Date.now() + TURN_MS,
  });
  clearSeatTimers(room, seat);
  room.timers[seat] = setTimeout(() => {
    delete room.timers[seat];
    if (room.promptedTurnKey !== key) return;
    room.promptedTurnKey = null;
    const bot = new BotPlayer(seat, { rng: Math.random });
    const act = bot.decideTurn(room.engine.state, options);
    const res = room.engine.take(act);
    afterTake(room, res);
  }, TURN_MS);
}

function promptHumanClaim(room, seat, tile, from, kind, options) {
  const st = room.engine.state;
  if (room.promptedClaim === st.claim && room.timers[seat]) return;
  room.promptedClaim = st.claim;
  const p = room.players[seat];
  send(p.ws, {
    type: 'prompt',
    kind: 'claim',
    seat,
    claim: { tile, from, kind },
    options,
    deadline: Date.now() + CLAIM_MS,
  });
  clearSeatTimers(room, seat);
  room.timers[seat] = setTimeout(() => {
    delete room.timers[seat];
    if (!room.engine || !room.engine.state.claim || room.engine.state.claim.responses[seat]) return;
    const res = room.engine.take({ type: ACTIONS.PASS, seat });
    afterTake(room, res);
  }, CLAIM_MS);
}

function advance(room) {
  if (!room || room.phase !== 'playing' || !room.engine) return;
  const st = room.engine.state;
  if (st.status === 'finished') {
    if (!room.nextHandTimer) {
      room.nextHandTimer = setTimeout(() => {
        room.nextHandTimer = null;
        startNextHand(room);
      }, NEXT_HAND_MS);
    }
    return;
  }
  const pending = room.engine.pending;
  if (pending.phase === 'turn') {
    const seat = pending.seat;
    if (isBotish(room, seat)) scheduleBotTurn(room, seat);
    else promptHumanTurn(room, seat);
  } else if (pending.phase === 'claim') {
    const stClaim = st.claim;
    for (let d = 1; d <= 3; d++) {
      const seat = (stClaim.from + d) % 4;
      if (stClaim.responses[seat]) continue;
      const options = room.engine.getClaimOptions(seat, stClaim.tile, stClaim.from, stClaim.kind);
      if (isBotish(room, seat)) {
        scheduleBotClaim(room, seat);
        continue;
      }
      if (!options.length) {
        // 无可响应项：自动过（无需打扰玩家）
        const res = room.engine.take({ type: ACTIONS.PASS, seat });
        afterTake(room, res);
        return; // afterTake 会继续 advance
      }
      promptHumanClaim(room, seat, stClaim.tile, stClaim.from, stClaim.kind, options);
    }
  }
}

function afterTake(room, res) {
  if (!room.engine) return;
  // 响应阶段结束时清理所有提示计时器
  if (!room.engine.state.claim) {
    for (const seat of Object.keys(room.timers)) clearSeatTimers(room, seat);
    room.promptedClaim = null;
  }
  broadcastGame(room, res && res.events ? res.events : []);
  advance(room);
}

function startRoom(room) {
  const rules = room.rules;
  // 机器人补位
  let botIdx = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (!room.players[seat]) {
      room.players[seat] = {
        name: BOT_NAMES[botIdx % BOT_NAMES.length],
        ws: null,
        sessionId: null,
        connected: false,
        isBot: true,
        managedByBot: false,
        ready: false,
      };
      botIdx++;
    } else {
      room.players[seat].ready = true;
    }
  }
  room.phase = 'playing';
  room.engine = new MahjongEngine(rules, { seed: room.seed, humanSeat: room.hostSeat });
  room.engine.startHand();
  // 用大厅里的玩家名覆盖引擎默认名
  for (let seat = 0; seat < 4; seat++) {
    if (room.players[seat]) room.engine.state.players[seat].name = room.players[seat].name;
  }
  sendRoomUpdate(room);
  broadcastGame(room, []);
  advance(room);
}

function startNextHand(room) {
  if (!room || !room.engine) return;
  const dealer = room.engine.suggestNextDealer();
  const res = room.engine.startHand({ dealerSeat: dealer });
  clearAllTimers(room);
  broadcastGame(room, res.events || []);
  advance(room);
}

function roomForReconnect(roomId, sessionId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (let seat = 0; seat < 4; seat++) {
    const p = room.players[seat];
    if (p && p.sessionId && p.sessionId === sessionId && !p.connected) return { room, seat, p };
  }
  return null;
}

function removePlayer(room, seat, { left = true } = {}) {
  clearSeatTimers(room, seat);
  const p = room.players[seat];
  if (!p) return;
  if (room.phase === 'lobby') {
    p.ws = null;
    p.connected = false;
    // 60 秒内可用 sessionId 重新进入，超时释放座位
    setTimeout(() => {
      const cur = room.players[seat];
      if (cur && cur.sessionId === p.sessionId && !cur.connected) room.players[seat] = null;
      if (seat === room.hostSeat) transferHost(room);
      if (rooms.get(room.id) === room) sendRoomUpdate(room);
    }, 60000);
  } else {
    p.ws = null;
    p.connected = false;
    p.managedByBot = true;
    sendRoomUpdate(room);
    advance(room); // 立即由机器人接手当前等待的动作
  }
  if (seat === room.hostSeat && left) transferHost(room);
  sendRoomUpdate(room);
}

function transferHost(room) {
  for (let seat = 0; seat < 4; seat++) {
    const p = room.players[seat];
    if (p && !p.isBot && p.connected && seat !== room.hostSeat) {
      room.hostSeat = seat;
      return;
    }
  }
  // 没有可接任的人类主机：若大厅无人则清理
  const hasHuman = room.players.some((p) => p && !p.isBot && p.connected);
  if (!hasHuman && room.phase === 'lobby') {
    rooms.delete(room.id);
    clearAllTimers(room);
  }
}

function cleanupEmptyRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const hasConnectedHuman = room.players.some((p) => p && !p.isBot && p.connected);
    if (!hasConnectedHuman && now - room.createdAt > LOBBY_GC_MS) {
      clearAllTimers(room);
      rooms.delete(id);
    }
  }
}
setInterval(cleanupEmptyRooms, 60000).unref();

/* ------------------------------------------------------------------ */
/* HTTP + WebSocket                                                     */
/* ------------------------------------------------------------------ */

function createHttpServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/ws')) {
      res.writeHead(426).end('websocket only');
      return;
    }
    serveStatic(req, res);
  });
}

function attachWebSocket(server, port) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { send(ws, { type: 'error', message: '消息格式错误' }); return; }
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      const found = findPlayerByWs(ws);
      if (found) removePlayer(found.room, found.seat, { left: false });
    });
  });

  // 心跳
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000).unref();
  return wss;
}

/**
 * 启动监听。端口被占用时：
 *  - 未显式指定 PORT：自动尝试下一个端口（最多 +10），并给出提示；
 *  - 显式指定 PORT：打印排查指引后退出。
 */
function startListening(port) {
  const server = createHttpServer();
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT && port < PORT + 10) {
      console.warn(`⚠ 端口 ${port} 已被占用（常见原因：旧的 python -m http.server 或上次的 npm start 还在运行），自动改用端口 ${port + 1} …`);
      server.close();
      startListening(port + 1);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`✗ 端口 ${port} 已被占用，服务器无法启动。`);
      console.error('  排查命令：');
      console.error(`    ss -ltnp | grep :${port}          # 查看是谁占用`);
      console.error(`    fuser -k ${port}/tcp              # 结束占用该端口的进程`);
      console.error(`  或换一个端口启动：PORT=${port + 1} npm start`);
      console.error('');
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, () => {
    attachWebSocket(server, port);
    console.log('雅趣麻将服务器已启动（网页 + 联机 WebSocket 同端口）');
    console.log(`  本机访问:   http://localhost:${port}`);
    console.log(`  局域网访问: http://<本机IP>:${port}`);
    console.log(`  联机地址:   ws://<主机>:${port}/ws`);
  });
}

startListening(PORT);

function handleMessage(ws, msg) {
  const { type } = msg;
  if (type === 'create-room') {
    const res = normalizeRules(msg.rules);
    if (!res.ok) { send(ws, { type: 'error', message: res.error }); return; }
    const room = makeRoom(res.rules, msg.name);
    const p = room.players[0];
    p.ws = ws;
    p.seat = 0;
    send(ws, {
      type: 'joined',
      roomId: room.id,
      seat: 0,
      sessionId: p.sessionId,
      hostSeat: 0,
      phase: room.phase,
      rules: room.rules,
      players: publicPlayers(room),
    });
    sendRoomUpdate(room);
    return;
  }

  if (type === 'join-room') {
    const room = rooms.get(String(msg.roomId || '').toUpperCase());
    if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }

    // 断线重连
    if (msg.sessionId) {
      const found = roomForReconnect(room.id, msg.sessionId);
      if (found) {
        found.p.ws = ws;
        found.p.connected = true;
        found.p.managedByBot = false;
        found.p.seat = found.seat;
        clearSeatTimers(room, found.seat);
        room.promptedTurnKey = null;
        room.promptedClaim = null;
        send(ws, {
          type: 'joined', roomId: room.id, seat: found.seat, sessionId: found.p.sessionId,
          hostSeat: room.hostSeat, phase: room.phase, rules: room.rules, players: publicPlayers(room),
        });
        if (room.phase === 'playing' && room.engine) {
          send(ws, {
            type: 'sync', roomId: room.id, phase: room.phase,
            state: viewState(room.engine.state, found.seat),
            events: [], yourSeat: found.seat,
          });
          advance(room); // 若正轮到他，重新发提示
        } else {
          sendRoomUpdate(room);
        }
        return;
      }
    }

    if (room.phase !== 'lobby') { send(ws, { type: 'error', message: '对局已开始' }); return; }
    const freeSeat = room.players.findIndex((p) => p === null);
    if (freeSeat < 0) { send(ws, { type: 'error', message: '房间已满' }); return; }
    const p = {
      name: msg.name || '玩家',
      ws,
      sessionId: crypto.randomUUID(),
      connected: true,
      isBot: false,
      managedByBot: false,
      ready: true,
      seat: freeSeat,
    };
    room.players[freeSeat] = p;
    send(ws, {
      type: 'joined', roomId: room.id, seat: freeSeat, sessionId: p.sessionId,
      hostSeat: room.hostSeat, phase: room.phase, rules: room.rules, players: publicPlayers(room),
    });
    sendRoomUpdate(room);
    return;
  }

  const found = findPlayerByWs(ws);
  if (!found) { send(ws, { type: 'error', message: '尚未加入房间' }); return; }
  const { room, seat } = found;

  if (type === 'set-name') {
    room.players[seat].name = String(msg.name || '玩家').slice(0, 12);
    sendRoomUpdate(room);
    return;
  }

  if (type === 'set-rules') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) { send(ws, { type: 'error', message: '只有房主能在开局前改规则' }); return; }
    const res = normalizeRules(msg.rules);
    if (!res.ok) { send(ws, { type: 'error', message: res.error }); return; }
    room.rules = res.rules;
    sendRoomUpdate(room);
    return;
  }

  if (type === 'start') {
    if (room.phase !== 'lobby') { send(ws, { type: 'error', message: '对局已开始' }); return; }
    if (seat !== room.hostSeat) { send(ws, { type: 'error', message: '只有房主可以开始' }); return; }
    if (!room.players.some((p) => p && !p.isBot && p.connected)) { send(ws, { type: 'error', message: '至少需要一名玩家' }); return; }
    startRoom(room);
    return;
  }

  if (type === 'leave-room') {
    removePlayer(room, seat, { left: true });
    send(ws, { type: 'left' });
    return;
  }

  if (type === 'action') {
    if (!room.engine || room.phase !== 'playing') { send(ws, { type: 'error', message: '对局未开始' }); return; }
    const action = msg.action || {};
    action.seat = seat; // 座位以连接为准，客户端不可冒充
    clearSeatTimers(room, seat);
    room.promptedTurnKey = null;
    const res = room.engine.take(action);
    if (!res.ok) {
      send(ws, { type: 'error', message: res.error });
      send(ws, {
        type: 'sync', roomId: room.id, phase: room.phase,
        state: viewState(room.engine.state, seat), events: res.events, yourSeat: seat,
      });
      advance(room); // 重新提示合法动作
      return;
    }
    afterTake(room, res);
    return;
  }

  send(ws, { type: 'error', message: `未知消息: ${type}` });
}
