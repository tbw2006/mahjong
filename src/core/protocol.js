/**
 * 统一动作 / 事件协议（联网预留的核心接口）。
 *
 * 设计目标：
 *   - 本地对局：GameController 把人机/机器人的动作交给 MahjongEngine；
 *   - 未来联网：服务器持有 MahjongEngine，客户端通过 WebSocket 发送同构的
 *     ACTION 对象、接收同构的 EVENT 对象即可，不需要改动引擎与渲染层。
 *
 * 所有 ACTION / EVENT 都必须是可 JSON 序列化的纯数据对象。
 */

export const ACTIONS = {
  START_HAND: 'startHand',   // {type:'startHand'}                   服务器/桌主专用
  DRAW: 'draw',              // {type:'draw', seat}                  引擎内部推进
  DISCARD: 'discard',        // {type:'discard', seat, tile}
  HU: 'hu',                  // {type:'hu', seat}                    自摸/点炮/抢杠通用
  PONG: 'pong',              // {type:'pong', seat, tile}
  CHI: 'chi',                // {type:'chi', seat, tile, a, b}       吃牌：tile 为吃入的牌
  GANG: 'gang',              // {type:'gang', seat, tile}            大明杠（杠别人舍牌）
  AN_GANG: 'anGang',         // {type:'anGang', seat, tile}          暗杠
  BU_GANG: 'buGang',         // {type:'buGang', seat, tile}          补杠 / 加杠
  PASS: 'pass',              // {type:'pass', seat}                  放弃碰/杠/吃/胡
  RESET: 'reset',            // {type:'reset'}                       回到未开局状态
};

export const EVENTS = {
  GAME_START: 'game-start',          // 新对局开始
  HAND_START: 'hand-start',          // 新一局开始（含庄家、圈风）
  DEAL: 'deal',                      // 发牌完成
  INDICATOR: 'indicator',            // 翻癞子指示牌
  TURN: 'turn',                      // 轮到某家行动
  DRAW: 'draw',                      // 某家摸牌（tile 仅对本人可见）
  DISCARD: 'discard',                // 某家舍牌
  MELD: 'meld',                      // 碰/杠/吃成型
  AN_GANG: 'an-gang',                // 暗杠
  BU_GANG: 'bu-gang',                // 补杠
  CLAIM_OPEN: 'claim-open',          // 出现可被响应（碰/杠/吃/胡）的牌
  CLAIM_RESPONSE: 'claim-response',  // 某家响应或放弃
  CLAIM_CLOSE: 'claim-close',        // 响应结算，无人响应
  REPLACEMENT_DRAW: 'replacement-draw', // 杠后补牌
  WIN: 'win',                        // 胡牌（含番型与分数明细）
  DRAW_GAME: 'draw-game',            // 荒庄流局
  HAND_OVER: 'hand-over',            // 一局结束
  SCORE: 'score',                    // 分数变动
  GAME_OVER: 'game-over',            // 整场结束
  ERROR: 'error',                    // 非法动作被拒绝
};

/**
 * 构造动作对象。
 * @param {string} type
 * @param {object} [payload]
 * @returns {{type:string}}
 */
export function action(type, payload = {}) {
  return { type, ...payload };
}

/**
 * 构造事件对象。visibleTo 用于联网时做信息隐藏：
 *  - 缺省为 null（广播给所有人）；
 *  - [seat] 表示仅该座位可见（例如摸到的牌面）。
 * @param {string} type
 * @param {object} [payload]
 * @param {number[]|null} [visibleTo]
 * @returns {{type:string, visibleTo: number[]|null}}
 */
export function event(type, payload = {}, visibleTo = null) {
  return { type, visibleTo, ...payload };
}
