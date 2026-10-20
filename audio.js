/**
 * AudioEngine - Web Audio API Sound Synthesizer
 * 0ms latency, zero external audio assets required.
 * Synthesizes 4 distinct sound profiles for warehouse scanning.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._initOnUserInteraction();
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _initOnUserInteraction() {
    const unlock = () => {
      this._initContext();
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  setMuted(muted) {
    this.muted = !!muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * 1. playOrderLoadedSound
   * Fast ascending dual-tone sine wave (500Hz -> 800Hz in 120ms)
   * Indicates a valid Bosta Waybill or new order has been loaded.
   */
  playOrderLoadedSound() {
    if (this.muted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Frequency ramp from 500Hz to 800Hz
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.12);

    // Smooth envelope
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * 2. playProductSuccessSound
   * Pure crisp "Ding" (B5: 987.77Hz, then E6: 1318.51Hz) with pleasant decay
   * Indicates a valid matching product SKU scanned into order.
   */
  playProductSuccessSound() {
    if (this.muted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Tone 1: B5 (987.77 Hz)
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(987.77, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.22, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.17);

    // Tone 2: E6 (1318.51 Hz) - slight offset for melodic ding
    const t2 = now + 0.07;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.28, t2 + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.35);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.36);
  }

  /**
   * 3. playOrderCompleteSound
   * Joyful victory fanfare (C5 -> E5 -> G5 -> C6)
   * Indicates all required items in current order are 100% prepared.
   */
  playOrderCompleteSound() {
    if (this.muted) return;
    this._initContext();
    if (!this.ctx) return;

    const notes = [
      { freq: 523.25, time: 0.00, dur: 0.12 }, // C5
      { freq: 659.25, time: 0.10, dur: 0.12 }, // E5
      { freq: 783.99, time: 0.20, dur: 0.14 }, // G5
      { freq: 1046.50, time: 0.32, dur: 0.45 } // C6 (sustained finale)
    ];

    const baseTime = this.ctx.currentTime;

    notes.forEach((n, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = baseTime + n.time;
      const isLast = idx === notes.length - 1;

      osc.type = isLast ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(n.freq, startTime);

      const peakVolume = isLast ? 0.32 : 0.22;
      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(peakVolume, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + n.dur + 0.05);
    });
  }

  /**
   * 4. playErrorSound
   * Dual low-frequency warning buzz (Sawtooth wave 160Hz then 130Hz for 350ms)
   * Unmistakable alert for wrong item or surplus scan.
   */
  playErrorSound() {
    if (this.muted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Buzz pulse 1: 160Hz sawtooth
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(160, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.28, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Buzz pulse 2: 130Hz lower buzzer
    const t2 = now + 0.16;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(130, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.3, t2 + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.18);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.2);
  }
}

// Global Sound instance
window.soundEngine = new SoundEngine();
