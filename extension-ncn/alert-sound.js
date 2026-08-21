/**
 * Phát vài tiếng chuông khi câu hỏi chưa có trong DB.
 */
(function () {
  async function playNotFoundChimes() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const tones = [
      { freq: 880, at: 0, dur: 0.14 },
      { freq: 1108, at: 0.2, dur: 0.14 },
      { freq: 880, at: 0.4, dur: 0.14 },
      { freq: 1108, at: 0.6, dur: 0.14 },
      { freq: 1318, at: 0.82, dur: 0.22 },
    ];

    const t0 = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = tone.freq;
      const start = t0 + tone.at;
      const end = start + tone.dur;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.05);
    }

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1300);
  }

  window.NCN_ALERT = { playNotFoundChimes };
})();
