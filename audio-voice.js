/**
 * Audio-Voice Engine - Khiam Store Warehouse
 * Features:
 * 1. High-Volume Warehouse Audio Boost: Master GainNode (2.5x) + DynamicsCompressorNode
 *    to prevent distortion/clipping while driving PC speakers to maximum audible volume.
 * 2. High-penetration acoustic waveforms (140Hz Sawtooth buzzer, 1200Hz resonant Sine ding).
 * 3. Intelligent Natural Arabic Voice Selector (Microsoft Salma/Shakir Natural -> Google -> ar-EG/ar-SA).
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.compressor = null;
    this.masterGain = null;
    this.soundMuted = false;
    this.voiceMuted = false;
    this._initOnInteraction();
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();

        // 1. DynamicsCompressorNode to prevent clipping/distortion when boosted
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

        // 2. High-Volume Boost GainNode (2.5x gain)
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(2.5, this.ctx.currentTime);

        // Chain: [Sound Nodes] -> masterGain -> compressor -> destination
        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
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
   * 1. playChirp() - High-volume waybill loaded chirp
   * Sine sweep 500Hz -> 880Hz (A5)
   */
  playChirp() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * 2. playDing() - High-penetration resonant success ding
   * Piercing Sine resonant bell (1200Hz -> 1318.5Hz E6) that cuts through packing noise
   */
  playDing() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // Harmonic 1: 1200 Hz
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1200, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.40, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    osc1.start(now);
    osc1.stop(now + 0.19);

    // Harmonic 2: 1318.5 Hz (E6 bell ring)
    const t2 = now + 0.06;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.45, t2 + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.38);

    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(t2);
    osc2.stop(t2 + 0.39);
  }

  /**
   * 3. playComplete() - Major chord victory fanfare
   * C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz)
   */
  playComplete() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx || !this.masterGain) return;

    const base = this.ctx.currentTime;
    const notes = [
      { freq: 523.25, offset: 0.00, dur: 0.12 },
      { freq: 659.25, offset: 0.10, dur: 0.12 },
      { freq: 783.99, offset: 0.20, dur: 0.14 },
      { freq: 1046.50, offset: 0.32, dur: 0.55 }
    ];

    notes.forEach((n, i) => {
      const isLast = i === notes.length - 1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = base + n.offset;

      osc.type = isLast ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(n.freq, start);

      const peak = isLast ? 0.45 : 0.32;
      gain.gain.setValueAtTime(0.01, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(start);
      osc.stop(start + n.dur + 0.05);
    });
  }

  /**
   * 4. playBuzzer() - Piercing double Sawtooth wave at 140Hz
   * Low, harsh, and loud to instantly alert workers to wrong items or duplicate scans
   */
  playBuzzer() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // Buzz 1: 140Hz Sawtooth
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(140, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.50, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Buzz 2: 125Hz Sawtooth lower bite
    const t2 = now + 0.17;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(125, t2);

    gain2.gain.setValueAtTime(0.01, t2);
    gain2.gain.linearRampToValueAtTime(0.55, t2 + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.19);

    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(t2);
    osc2.stop(t2 + 0.21);
  }

  /**
   * 5. playSizeMismatch() - Alternating square wave 400Hz - 600Hz
   */
  playSizeMismatch() {
    if (this.soundMuted) return;
    this._initContext();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const tones = [
      { f: 400, start: now, dur: 0.13 },
      { f: 600, start: now + 0.14, dur: 0.16 }
    ];

    tones.forEach(t => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(t.f, t.start);

      gain.gain.setValueAtTime(0.01, t.start);
      gain.gain.linearRampToValueAtTime(0.30, t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t.start + t.dur);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t.start);
      osc.stop(t.start + t.dur + 0.02);
    });
  }
}

// ----------------------------------------------------
// Natural Arabic Voice Engine (Web Speech API)
// ----------------------------------------------------
let cachedBestArabicVoice = null;

function resolveBestArabicVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  // Filter all Arabic voices
  const arabicVoices = voices.filter(v => v.lang && (v.lang.startsWith('ar') || v.lang.includes('Arabic')));

  if (arabicVoices.length === 0) return null;

  // Priority 1: Natural / Online voices (e.g. Microsoft Salma Online (Natural) or Shakir)
  const naturalVoice = arabicVoices.find(v => {
    const name = (v.name || '').toLowerCase();
    return name.includes('natural') || name.includes('online');
  });
  if (naturalVoice) return naturalVoice;

  // Priority 2: Google Arabic voices (Google العربية / Google Arabic)
  const googleVoice = arabicVoices.find(v => (v.name || '').toLowerCase().includes('google'));
  if (googleVoice) return googleVoice;

  // Priority 3: Egyptian (ar-EG) or Saudi (ar-SA)
  const egVoice = arabicVoices.find(v => v.lang === 'ar-EG');
  if (egVoice) return egVoice;

  const saVoice = arabicVoices.find(v => v.lang === 'ar-SA');
  if (saVoice) return saVoice;

  // Priority 4: Any Arabic voice
  return arabicVoices[0];
}

// Pre-load voices on startup
if ('speechSynthesis' in window) {
  cachedBestArabicVoice = resolveBestArabicVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedBestArabicVoice = resolveBestArabicVoice();
  };
}

/**
 * Hands-free Arabic voice guidance with natural voice priority
 */
function speakArabic(text) {
  if (!('speechSynthesis' in window)) return;
  if (window.soundEngine && window.soundEngine.voiceMuted) return;

  try {
    window.speechSynthesis.cancel(); // clear previous utterance for zero lag

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ar-EG';
    utterance.rate = 1.1; // crisp and agile pace for warehouse picking
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    if (!cachedBestArabicVoice) {
      cachedBestArabicVoice = resolveBestArabicVoice();
    }
    if (cachedBestArabicVoice) {
      utterance.voice = cachedBestArabicVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('SpeechSynthesis error:', err);
  }
}

// Global Instances
window.soundEngine = new SoundEngine();
window.speakArabic = speakArabic;
