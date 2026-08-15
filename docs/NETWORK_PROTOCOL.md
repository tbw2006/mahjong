# 联网协议（已实现）

本文档描述 `server/server.js` 与 `src/net/network.js` 之间已实现的客户端 ↔ 服务器协议。

## 1. 架构

```
浏览器（电脑/手机） ──WebSocket(/ws)──▶ 权威服务器
                                        ├─ MahjongEngine（规则裁决）
                                        ├─ BotPlayer（空位/断线托管）
                                        └─ 房间与会话管理
```

- 服务器是唯一权威：客户端发送动作，服务器 `engine.take()` 校验后才广播。
- 服务器为**每个玩家**生成一份视角状态（他人手牌替换为 -1 占位，仅保留张数），摸牌类事件按 `visibleTo` 过滤。
- 同一 HTTP 端口同时服务静态页面与 WebSocket，部署简单。

## 2. 连接

- 端点：`ws://host/ws`（https 页面自动用 `wss://host/ws`）。
- 客户端用 `NetworkClient` 自动重连（指数退避，最大 10 秒），重连后凭 `sessionId` 恢复座位。

## 3. 客户端 → 服务器

| type | 字段 | 说明 |
| --- | --- | --- |
| `create-room` | `name, rules` | 建房，房主坐 0 号位 |
| `join-room` | `roomId, name, sessionId?` | 加入；带 `sessionId` 时优先断线重连 |
| `set-name` | `name` | 改昵称 |
| `set-rules` | `rules` | 房主开局前改玩法 |
| `start` | — | 房主开局（空位电脑补位） |
| `leave-room` | — | 离开/放弃座位（对局中变为托管） |
| `action` | `action` | 标准 ACTION（`discard/hu/pong/chi/gang/anGang/buGang/pass`） |

ACTION 定义见 `src/core/protocol.js`。服务器**以连接对应的座位为准**覆盖 `action.seat`，客户端无法冒充他人。

## 4. 服务器 → 客户端

| type | 字段 | 说明 |
| --- | --- | --- |
| `joined` | `roomId, seat, sessionId, hostSeat, phase, rules, players` | 建房/加入/重连成功 |
| `room-update` | `roomId, phase, hostSeat, rules, players` | 大厅状态变化 |
| `sync` | `state, events[], yourSeat, phase` | 每次状态推进后的全量视角快照 + 增量事件 |
| `prompt` | `kind, seat, options, claim, deadline` | 轮到该玩家行动（turn: 出牌/胡/杠；claim: 碰杠吃胡） |
| `error` | `message` | 动作被拒绝或消息错误 |
| `left` | — | 已离开房间 |

`sync.state` 是 `engine.exportState()` 的座位视角副本：

- 自己的 `players[seat].concealed` 为真实手牌；
- 他人 `concealed` 为等长 `-1` 占位（只暴露张数）；
- `winInfo`（胡牌番型/支付/牌面）公开，结算弹窗据此渲染。

`prompt` 仅在轮到该玩家时发送；超时未响应则由服务器代为行动（出牌 25 秒 / 响应 8 秒）。

## 5. 状态一致性与重连

- 每步推进后广播 `sync` 全量快照：客户端渲染纯函数化，天然避免事件丢失造成的不一致。
- 掉线 → 服务器立即将座位交给 `BotPlayer` 托管；`join-room` 带原 `sessionId` 重连即恢复人控并收到最新快照。
- 大厅座位离线保留 60 秒；对局中座位始终保留。
- 房间在无在线玩家且超过 GC 时间后自动回收。

## 6. 扩展点（后续可加，无需改 core/）

- 一炮多响：`engine._maybeResolveClaim()` 集中处理胡家优先级；
- 排行榜/账号：在服务器消息层增加登录与统计即可；
- 观战/回放：服务器记录事件流或种子，`exportState()` 提供快照；
- 移动端：客户端已含横屏与触控，可继续打磨 PWA 推送等。
