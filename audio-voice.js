/**
 * Audio-Voice Engine - Khiam Store Warehouse
 * Combines zero-latency synthetic tones (Web Audio API) with hands-free Arabic voice guidance (Web Speech API).
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.soundMuted = false;
    this.voiceMuted = false;
    this._initOnInteraction();
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

  _initOnInteraction() {
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

  toggleSound() {
    this.soundMuted = !this.soundMuted;
    return this.soundMuted;
  }

  toggleVoice() {
    this.voiceMuted = !this.voiceMuted;
    return this.voiceMuted;
  }

  /**
   * 1. playChirp()
   * 500Hz to 850Hz sine wave 120ms (Bosta waybill / new order loaded)
   */
  playChirp() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.12);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * 2. playDing()
   * High pleasant harmonic sine 1046Hz (C6) -> 1318Hz (E6) (Correct product item)
   */
  playDing() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Harmonic 1: 1046.50Hz
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.50, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.17);

    // Harmonic 2: 1318.51Hz
    const t2 = now + 0.07;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.3, t2 + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.35);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.36);
  }

  /**
   * 3. playComplete()
   * Major chord arpeggio C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz) (Order complete fanfare)
   */
  playComplete() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx) return;

    const base = this.ctx.currentTime;
    const notes = [
      { freq: 523.25, offset: 0.00, dur: 0.12 }, // C5
      { freq: 659.25, offset: 0.10, dur: 0.12 }, // E5
      { freq: 783.99, offset: 0.20, dur: 0.14 }, // G5
      { freq: 1046.50, offset: 0.32, dur: 0.50 } // C6
    ];

    notes.forEach((n, i) => {
      const isLast = i === notes.length - 1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = base + n.offset;

      osc.type = isLast ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(n.freq, start);

      const peak = isLast ? 0.35 : 0.22;
      gain.gain.setValueAtTime(0.01, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + n.dur + 0.05);
    });
  }

  /**
   * 4. playBuzzer()
   * Sawtooth 150Hz dual harsh buzz 350ms (Wrong item / duplicate scan)
   */
  playBuzzer() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Buzz 1
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(155, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.32, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Buzz 2
    const t2 = now + 0.16;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(130, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.35, t2 + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.18);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.2);
  }

  /**
   * 5. playSizeMismatch()
   * Alternating two-tone alert 400Hz - 600Hz (Model matches but size differs!)
   */
  playSizeMismatch() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const tones = [
      { f: 400, start: now, dur: 0.12 },
      { f: 600, start: now + 0.13, dur: 0.15 }
    ];

    tones.forEach(t => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(t.f, t.start);

      gain.gain.setValueAtTime(0.01, t.start);
      gain.gain.linearRampToValueAtTime(0.18, t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t.start + t.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t.start);
      osc.stop(t.start + t.dur + 0.02);
    });
  }
}

/**
 * Hands-free Arabic voice guidance using Web Speech API
 */
function speakArabic(text) {
  if (!('speechSynthesis' in window)) return;
  if (window.soundEngine && window.soundEngine.voiceMuted) return;

  try {
    window.speechSynthesis.cancel(); // clear previous queue for instant response
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ar-EG';
    utterance.rate = 1.15; // slightly faster for warehouse packing speed
    utterance.pitch = 1.0;

    // Pick Arabic voice if available
    const voices = window.speechSynthesis.getVoices();
    const arabicVoice = voices.find(v => v.lang.startsWith('ar'));
    if (arabicVoice) {
      utterance.voice = arabicVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('SpeechSynthesis error:', err);
  }
}

// Global Sound & Voice Instances
window.soundEngine = new SoundEngine();
window.speakArabic = speakArabic;
