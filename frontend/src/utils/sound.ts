import { Platform } from "react-native";

// Loud alarm beep. On web we use the Web Audio API; on native we rely on
// haptics + local notification sound (handled by the caller).
export function alarmBeep() {
  if (Platform.OS !== "web") return;
  try {
    const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // three rising beeps
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 660 + i * 220;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // ignore
  }
}
