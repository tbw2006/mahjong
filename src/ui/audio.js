/**
 * 轻量音效：WebAudio 程序化合成，无外部资源。
 * 未来联网时音效仍由客户端本地播放（事件驱动，无需改动）。
 */

let ctx = null;
let enabled = true;

try {
  enabled = localStorage.getItem('mahjong-sound') !== 'off';
} catch { /* ignore */ }

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.08, type = 'sine', gain = 0.12, when = 0) {
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function clickNoise(dur = 0.05, gain = 0.16, when = 0) {
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  }
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = gain;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2600;
  src.buffer = buf;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
}

export const SOUNDS = {
  click() { if (!enabled) return; clickNoise(0.04, 0.14); tone(1900, 0.05, 'triangle', 0.05); },
  draw() { if (!enabled) return; clickNoise(0.06, 0.1); tone(800, 0.09, 'sine', 0.06); },
  meld() { if (!enabled) return; clickNoise(0.05, 0.2); tone(620, 0.1, 'triangle', 0.14); tone(460, 0.12, 'triangle', 0.12, 0.05); },
  gang() { if (!enabled) return; clickNoise(0.06, 0.22); tone(520, 0.1, 'square', 0.08); tone(400, 0.14, 'triangle', 0.12, 0.06); },
  win() {
    if (!enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, i * 0.12));
    clickNoise(0.12, 0.06, 0.5);
  },
  error() { if (!enabled) return; tone(220, 0.12, 'sawtooth', 0.05); },
};

export function isSoundEnabled() { return enabled; }

export function setSoundEnabled(v) {
  enabled = !!v;
  try { localStorage.setItem('mahjong-sound', enabled ? 'on' : 'off'); } catch { /* ignore */ }
  return enabled;
}
