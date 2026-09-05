import { Platform } from "react-native";

// Loud, continuous alarm siren for the web (tab open / foreground). Browsers
// block audio until the user has interacted with the page, so we keep a single
// shared AudioContext and resume it on the first interaction (see unlockAudio).
// On native we rely on haptics + a local notification sound (handled by caller).

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

function getCtx(): AudioContext | null {
  if (Platform.OS !== "web") return null;
  const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

/** Resume the audio engine. Call on any user gesture so alarms can play later. */
export async function unlockAudio(): Promise<void> {
  const c = getCtx();
  if (c && c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      // ignore
    }
  }
}

/** Start a loud two-tone siren that repeats until stopAlarm() is called. */
export function startAlarm(): void {
  if (Platform.OS !== "web") return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  if (osc) return; // already sounding

  osc = c.createOscillator();
  gain = c.createGain();
  osc.type = "square";
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.value = 0.0001;
  osc.start();

  let on = false;
  let high = false;
  const tick = () => {
    if (!gain || !osc || !ctx) return;
    on = !on;
    // Loud when on, near-silent when off -> pulsing "beep beep beep" siren.
    gain.gain.setTargetAtTime(on ? 0.9 : 0.0001, ctx.currentTime, 0.005);
    if (on) {
      high = !high;
      osc.frequency.setValueAtTime(high ? 900 : 660, ctx.currentTime);
    }
  };
  tick();
  beat = setInterval(tick, 320);
}

/** Stop the siren. */
export function stopAlarm(): void {
  if (beat) {
    clearInterval(beat);
    beat = null;
  }
  try {
    if (gain && ctx) gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.005);
    if (osc) {
      osc.stop();
      osc.disconnect();
    }
    if (gain) gain.disconnect();
  } catch {
    // ignore
  }
  osc = null;
  gain = null;
}

/** Play a short burst so the user can test/confirm the alarm sound. */
export function testAlarmSound(): void {
  startAlarm();
  setTimeout(stopAlarm, 2600);
}

// Back-compat: a single short burst.
export function alarmBeep(): void {
  testAlarmSound();
}
