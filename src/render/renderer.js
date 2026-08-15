/**
 * 渲染层：真实矢量牌面（CC0 公有领域素材）+ 木纹牌桌 DOM 渲染。
 *
 * 牌面素材：FluffyStuff/riichi-mahjong-tiles（CC0 1.0 公有领域）
 * 本地目录：assets/tiles/*.svg（300×400 矢量，任意缩放不模糊）
 *
 * 渲染层只读取 state 快照，不修改引擎状态（保持引擎可运行于服务器）。
 */

import { tileName, isLaiziTile } from '../core/tiles.js';

/* ------------------------------------------------------------------ */
/* 牌面素材映射                                                         */
/* ------------------------------------------------------------------ */

/** 游戏内牌 id → 素材文件名（不含扩展名） */
const ASSET_BY_TILE = {
  0: 'Man1', 1: 'Man2', 2: 'Man3', 3: 'Man4', 4: 'Man5', 5: 'Man6', 6: 'Man7', 7: 'Man8', 8: 'Man9',
  9: 'Pin1', 10: 'Pin2', 11: 'Pin3', 12: 'Pin4', 13: 'Pin5', 14: 'Pin6', 15: 'Pin7', 16: 'Pin8', 17: 'Pin9',
  18: 'Sou1', 19: 'Sou2', 20: 'Sou3', 21: 'Sou4', 22: 'Sou5', 23: 'Sou6', 24: 'Sou7', 25: 'Sou8', 26: 'Sou9',
  27: 'Ton', 28: 'Nan', 29: 'Shaa', 30: 'Pei',
  31: 'Chun', 32: 'Hatsu', 33: 'Haku',
};

const TILE_URL_CACHE = new Map();

/**
 * 牌面图片 URL（CSS background-image 用）。
 * @param {number} tile 牌 id
 * @param {number} [size] 保留参数，兼容旧调用（SVG 矢量无需尺寸）
 * @param {boolean} [laizi] 是否癞子（癞子样式由 CSS 徽标承担）
 */
export function tileFace(tile, size = 96, laizi = false) {
  const name = ASSET_BY_TILE[tile];
  if (!name) return '';
  const key = `${tile}:${laizi ? 1 : 0}`;
  if (!TILE_URL_CACHE.has(key)) {
    // 注意：用单引号包裹 URL，便于直接拼进 style="..." 的 HTML 属性
    TILE_URL_CACHE.set(key, `url('assets/tiles/${name}.svg')`);
  }
  return TILE_URL_CACHE.get(key);
}

/** 牌背图片 URL */
export function tileBackFace(size = 96) {
  return "url('assets/tiles/Back.svg')";
}

/**
 * 兼容旧接口：tileSVG 现直接返回本地素材文件路径。
 */
export function tileSVG(tile, { size = 96, laizi = false } = {}) {
  const name = ASSET_BY_TILE[tile];
  return name ? `assets/tiles/${name}.svg` : '';
}

/* ------------------------------------------------------------------ */
/* DOM 渲染                                                             */
/* ------------------------------------------------------------------ */

const WINDS = ['东', '南', '西', '北'];

export class TableRenderer {
  constructor(root = document) {
    this.$ = (id) => root.querySelector(`#${id}`);
  }

  /** 全量渲染牌桌 */
  render(state, view = {}) {
    const humanSeat = view.humanSeat ?? 0;
    const lastEvent = view.lastEvent || null;

    this.renderPlaque(state);
    this.renderScoreboard(state, humanSeat);
    this.renderOpponent(state, humanSeat, 1, 'right');
    this.renderOpponent(state, humanSeat, 2, 'top');
    this.renderOpponent(state, humanSeat, 3, 'left');
    this.renderRiver(state, humanSeat, 0, 'bottom');
    this.renderRiver(state, humanSeat, 1, 'right');
    this.renderRiver(state, humanSeat, 2, 'top');
    this.renderRiver(state, humanSeat, 3, 'left');
    this.renderHuman(state, humanSeat, lastEvent);
  }

  tileEl(tile, cls = 'tile', laizi = false, label = '') {
    const div = document.createElement('div');
    div.className = cls;
    div.style.backgroundImage = tileFace(tile, 96, laizi);
    div.dataset.tile = String(tile);
    div.title = tileName(tile);
    if (label) div.textContent = label;
    return div;
  }

  backEl(cls = 'tile tile-back') {
    const div = document.createElement('div');
    div.className = cls;
    div.style.backgroundImage = tileBackFace(96);
    return div;
  }

  renderPlaque(state) {
    const el = this.$('center-plaque');
    if (!el) return;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'plaque-inner';
    const wall = document.createElement('div');
    wall.className = 'plaque-item';
    wall.innerHTML = `<span class="plaque-label">牌墙</span><span class="plaque-value">${state.wall.length}</span>`;
    wrap.appendChild(wall);

    if (state.indicator !== null) {
      const ind = document.createElement('div');
      ind.className = 'plaque-item';
      ind.innerHTML = `<span class="plaque-label">指示牌</span>`;
      const t = this.tileEl(state.indicator, 'tile tile-mini', false);
      ind.appendChild(t);
      wrap.appendChild(ind);
    }
    if (state.laizi && state.laizi.length) {
      const lz = document.createElement('div');
      lz.className = 'plaque-item';
      lz.innerHTML = `<span class="plaque-label">癞子 ×${state.laizi.length}</span>`;
      const row = document.createElement('div');
      row.className = 'plaque-tiles';
      for (const t of state.laizi) row.appendChild(this.tileEl(t, 'tile tile-mini', true));
      lz.appendChild(row);
      wrap.appendChild(lz);
    }
    if (state.status === 'finished') {
      const done = document.createElement('div');
      done.className = 'plaque-item';
      done.innerHTML = `<span class="plaque-label">本局</span><span class="plaque-value">${state.drawGame ? '流局' : '已胡牌'}</span>`;
      wrap.appendChild(done);
    }
    el.appendChild(wrap);
  }

  renderScoreboard(state, humanSeat) {
    const el = this.$('scoreboard');
    if (!el) return;
    el.innerHTML = '';
    for (let rel = 0; rel < 4; rel++) {
      const seat = (humanSeat + rel) % 4;
      const p = state.players[seat];
      const row = document.createElement('div');
      row.className = 'score-row' + (seat === state.dealerSeat ? ' dealer' : '');
      row.innerHTML = `
        <span class="score-wind">${WINDS[rel]}</span>
        <span class="score-name">${escapeHtml(p.name)}</span>
        <span class="score-val ${p.score > 0 ? 'pos' : p.score < 0 ? 'neg' : ''}">${p.score >= 0 ? '+' : ''}${p.score}</span>`;
      el.appendChild(row);
    }
  }

  renderOpponent(state, humanSeat, rel, side) {
    const el = this.$(`opp-${side}`);
    if (!el) return;
    const seat = (humanSeat + rel) % 4;
    const p = state.players[seat];
    el.innerHTML = '';

    const plate = document.createElement('div');
    plate.className = 'opp-plate' + (seat === state.dealerSeat ? ' dealer' : '');
    plate.innerHTML = `<span class="wind-mark">${WINDS[rel]}</span><span>${escapeHtml(p.name)}</span><span class="tile-count">${p.concealed.length}</span>`;
    el.appendChild(plate);

    const backs = document.createElement('div');
    backs.className = 'opp-backs';
    for (let i = 0; i < p.concealed.length; i++) backs.appendChild(this.backEl('tile tile-mini tile-back'));

    const meldBox = document.createElement('div');
    meldBox.className = 'opp-melds';
    for (const meld of p.melds) {
      const mg = document.createElement('div');
      mg.className = 'meld-group';
      const fromTag = meld.sub === 'an'
        ? '<span class="meld-from">暗杠</span>'
        : `<span class="meld-from">${meld.type === 'gang' ? '杠' : meld.type === 'pong' ? '碰' : '吃'}</span>`;
      mg.innerHTML = fromTag;
      const tiles = document.createElement('div');
      tiles.className = 'meld-tiles';
      for (const t of meld.tiles) tiles.appendChild(this.tileEl(t, 'tile tile-mini', state.laizi.includes(t)));
      mg.appendChild(tiles);
      meldBox.appendChild(mg);
    }

    // 上家：名牌 + 背面 + 副露横排；左右家：名牌 + 副露 + 背面竖排（控制宽度）
    if (side === 'top') {
      el.appendChild(backs);
      el.appendChild(meldBox);
    } else {
      el.appendChild(meldBox);
      el.appendChild(backs);
    }
  }

  renderRiver(state, humanSeat, rel, side) {
    const el = this.$(`river-${side}`);
    if (!el) return;
    const seat = (humanSeat + rel) % 4;
    el.innerHTML = '';
    const entries = state.discardPool.filter((d) => d.seat === seat);
    let lastActiveIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!entries[i].removed) { lastActiveIdx = i; break; }
    }
    entries.forEach((d, i) => {
      const t = this.tileEl(d.tile, d.removed ? 'tile tile-mini removed' : 'tile tile-mini', false);
      if (i === lastActiveIdx && state.lastDiscard) t.classList.add('last-discard');
      el.appendChild(t);
    });
  }

  renderHuman(state, humanSeat, lastEvent) {
    const handEl = this.$('hand');
    const meldsEl = this.$('my-melds');
    if (!handEl || !meldsEl) return;
    const p = state.players[humanSeat];
    handEl.innerHTML = '';
    meldsEl.innerHTML = '';

    for (const meld of p.melds) {
      const mg = document.createElement('div');
      mg.className = 'meld-group my';
      const fromTag = meld.sub === 'an'
        ? '<span class="meld-from">暗杠</span>'
        : `<span class="meld-from">${meld.type === 'gang' ? '杠' : meld.type === 'pong' ? '碰' : '吃'}</span>`;
      mg.innerHTML = fromTag;
      const tiles = document.createElement('div');
      tiles.className = 'meld-tiles';
      for (const t of meld.tiles) tiles.appendChild(this.tileEl(t, 'tile tile-meld', state.laizi.includes(t)));
      mg.appendChild(tiles);
      meldsEl.appendChild(mg);
    }

    const sorted = p.concealed.slice().sort((a, b) => a - b);
    let drawnIndex = -1;
    if (state.drawnTile !== null) {
      drawnIndex = sorted.lastIndexOf(state.drawnTile);
    }
    sorted.forEach((tile, i) => {
      const isLaizi = isLaiziTile(tile, state.laizi);
      const div = this.tileEl(tile, isLaizi ? 'tile tile-big laizi' : 'tile tile-big', isLaizi);
      if (i === drawnIndex) {
        div.classList.add('drawn');
        div.classList.add('new-tile');
      }
      handEl.appendChild(div);
    });

    if (state.status === 'finished' && state.winInfo && state.winInfo.winnerSeat === humanSeat) {
      handEl.classList.add('win-glow');
    } else {
      handEl.classList.remove('win-glow');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
