// Procedural sound: every effect is synthesised with WebAudio, so the game ships
// no audio files and makes no network request. One shared context, created lazily
// on the first user gesture (browsers block audio before that).
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function noiseBuffer(seconds) {
    const c = ensure();
    if (!c) return null;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst({ duration = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', when = 0 }) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(duration + 0.05);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  function tone({ freq = 440, to = null, duration = 0.1, gain = 0.25, type = 'sine', when = 0 }) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    shot(kind = 'rifle', distant = false) {
      if (distant) { burst({ duration: 0.09, freq: 900, gain: 0.12 }); return; }
      if (kind === 'pistol') burst({ duration: 0.09, freq: 2400, gain: 0.4 });
      else if (kind === 'smg') burst({ duration: 0.07, freq: 2600, gain: 0.32 });
      else if (kind === 'dmr') { burst({ duration: 0.22, freq: 1400, gain: 0.6 }); tone({ freq: 160, to: 60, duration: 0.18, gain: 0.3, type: 'triangle' }); }
      else burst({ duration: 0.11, freq: 1800, gain: 0.5 });
      tone({ freq: 220, to: 70, duration: 0.08, gain: 0.18, type: 'triangle' });
    },
    dryFire() { tone({ freq: 1200, duration: 0.03, gain: 0.12, type: 'square' }); },
    reload() {
      tone({ freq: 900, duration: 0.04, gain: 0.15, type: 'square', when: 0 });
      tone({ freq: 700, duration: 0.04, gain: 0.15, type: 'square', when: 0.35 });
      tone({ freq: 1100, duration: 0.05, gain: 0.2, type: 'square', when: 0.8 });
    },
    hit(kill) {
      tone({ freq: kill ? 1320 : 880, duration: 0.06, gain: 0.22, type: 'sine' });
      if (kill) tone({ freq: 1760, duration: 0.12, gain: 0.2, type: 'sine', when: 0.07 });
    },
    hurt() { tone({ freq: 180, to: 90, duration: 0.18, gain: 0.3, type: 'sawtooth' }); },
    explosion() {
      burst({ duration: 0.7, freq: 500, gain: 0.9 });
      tone({ freq: 120, to: 35, duration: 0.6, gain: 0.5, type: 'sine' });
    },
    beep(final = false) { tone({ freq: final ? 1560 : 1040, duration: final ? 0.3 : 0.09, gain: 0.2, type: 'sine' }); },
    plant() { tone({ freq: 660, duration: 0.08, gain: 0.18, type: 'sine' }); tone({ freq: 660, duration: 0.08, gain: 0.18, type: 'sine', when: 0.15 }); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.22, gain: 0.22, type: 'triangle', when: i * 0.12 })); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, duration: 0.25, gain: 0.2, type: 'triangle', when: i * 0.14 })); },
    buy() { tone({ freq: 980, duration: 0.07, gain: 0.2, type: 'sine' }); tone({ freq: 1240, duration: 0.1, gain: 0.18, type: 'sine', when: 0.08 }); },
    deny() { tone({ freq: 220, duration: 0.12, gain: 0.2, type: 'square' }); },
  };
}
