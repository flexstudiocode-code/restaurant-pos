// Kitchen-display sound alerts: a short two-tone beep when a new KOT arrives.
// Web Audio API — no audio files to bundle, works offline, and reverb-free on
// every platform (Android WebView, Electron, browser). A previous AudioContext
// is reused; if the browser blocks autoplay the context starts suspended and
// resume() is retried on the next beep (the first user interaction unlocks it).

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Unlock audio after a user gesture (mobile browsers require this once). */
export function primeKitchenSound(): void {
  audioContext();
}

/** Play a short attention beep: two quick ascending square-wave tones. */
export function beepNewKot(): void {
  const ac = audioContext();
  if (!ac) return;
  // Two tones: 880 Hz then 1175 Hz (D6) — clearly audible over kitchen noise.
  const tones = [
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 1175, start: 0.15, dur: 0.16 },
  ];
  for (const t of tones) {
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = t.freq;
      const t0 = ac.currentTime + t.start;
      // Small attack/decay ramp avoids the clicks a hard on/off causes.
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22, t0 + 0.01);
      gain.gain.setValueAtTime(0.22, t0 + t.dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + t.dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + t.dur + 0.02);
    } catch {
      // ignore — sound is best-effort
    }
  }
}
