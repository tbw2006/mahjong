/**
 * NetworkClient —— 面向公网的 WebSocket 客户端封装。
 *
 *  - 自动重连（指数退避，最大 10 秒）
 *  - 未连接时消息排队，连接后自动补发
 *  - 状态回调：onOpen / onMessage / onClose / onStatus
 *  - 使用 wss://（页面为 https 时）或 ws://（本地开发）
 */

export class NetworkClient {
  constructor({ onOpen = null, onMessage = null, onClose = null, onStatus = null } = {}) {
    this.cbs = { onOpen, onMessage, onClose, onStatus };
    this.ws = null;
    this.shouldReconnect = false;
    this.retry = 0;
    this.retryTimer = null;
    this.queue = [];
    this.status = 'idle'; // idle | connecting | online | reconnecting | closed
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.shouldReconnect = true;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this._setStatus('connecting');
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retry = 0;
      this._setStatus('online');
      const pending = this.queue.splice(0);
      for (const msg of pending) this._rawSend(msg);
      if (this.cbs.onOpen) this.cbs.onOpen();
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (this.cbs.onMessage) this.cbs.onMessage(msg);
    };

    this.ws.onclose = () => {
      this.ws = null;
      this._setStatus('reconnecting');
      if (this.cbs.onClose) this.cbs.onClose();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => { /* onclose 统一处理 */ };
  }

  send(msg) {
    this.queue.push(msg);
    if (this.ws && this.ws.readyState === 1) {
      const pending = this.queue.splice(0);
      for (const m of pending) this._rawSend(m);
    } else if (!this.shouldReconnect) {
      this.connect();
    }
  }

  _rawSend(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* 连接中断由 onclose 处理 */ }
    } else {
      this.queue.push(msg);
    }
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect || this.retryTimer) return;
    const delay = Math.min(10000, 800 * 2 ** this.retry);
    this.retry += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  get isOnline() {
    return this.status === 'online';
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    this.queue = [];
    this._setStatus('closed');
  }

  _setStatus(status) {
    this.status = status;
    if (this.cbs.onStatus) this.cbs.onStatus(status);
  }
}
