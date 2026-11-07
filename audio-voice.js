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
// Best quality: Microsoft Edge ships free neural "Natural" Arabic voices
// (Salma / Shakir - Egypt, Zariyah / Hamed - Saudi, ...). Chrome on Windows only
// has the old robotic desktop voices, so the app recommends Edge when no natural voice exists.
const VOICE_PREF_KEY = 'khiam_voice_name';
const VOICE_RATE_KEY = 'khiam_voice_rate';
let cachedBestArabicVoice = null;

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function getArabicVoices() {
  if (!('speechSynthesis' in window)) return [];
  return (window.speechSynthesis.getVoices() || [])
    .filter(v => v.lang && (v.lang.toLowerCase().startsWith('ar') || /arabic/i.test(v.name || '')));
}

function isNaturalVoice(v) {
  return /natural|online|neural/i.test(v.name || '');
}

// Higher = better. Egyptian neural voices first (warehouse staff are Egyptian).
function scoreArabicVoice(v) {
  const name = (v.name || '').toLowerCase();
  const lang = (v.lang || '').toLowerCase();
  let score = 0;
  if (isNaturalVoice(v)) score += 100;
  if (lang === 'ar-eg') score += 30;
  else if (lang === 'ar-sa') score += 20;
  if (/salma/.test(name)) score += 8;      // clear female Egyptian neural voice
  if (/shakir/.test(name)) score += 6;
  if (/google/.test(name)) score += 50;    // Chrome's online Arabic voice (better than desktop SAPI)
  if (!v.localService) score += 5;
  return score;
}

function resolveBestArabicVoice() {
  const voices = getArabicVoices();
  if (voices.length === 0) return null;

  const preferred = readPref(VOICE_PREF_KEY, 'auto');
  if (preferred && preferred !== 'auto') {
    const chosen = voices.find(v => v.name === preferred);
    if (chosen) return chosen;
  }
  return voices.slice().sort((a, b) => scoreArabicVoice(b) - scoreArabicVoice(a))[0];
}

// Pre-load voices on startup
if ('speechSynthesis' in window) {
  cachedBestArabicVoice = resolveBestArabicVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedBestArabicVoice = resolveBestArabicVoice();
    window.dispatchEvent(new CustomEvent('voices-changed'));
  };
}

/**
 * Make text easier for Arabic TTS: spell sizes in Arabic, drop label codes like (C1)/(e1),
 * and avoid symbols that voices read out literally.
 */
const SIZE_WORDS = {
  'XS': 'إكس سمول', 'S': 'سمول', 'M': 'ميديم', 'L': 'لارج', 'XL': 'إكس لارج',
  'XXL': 'دبل إكس لارج', '2XL': 'دبل إكس لارج', 'XXXL': 'تريبل إكس لارج', '3XL': 'تريبل إكس لارج',
  '4XL': 'فور إكس لارج', '5XL': 'فايف إكس لارج', '6XL': 'سيكس إكس لارج'
};
function prepareArabicSpeech(text) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/\([^)]*\)/g, ' ');                       // (C1), (e1), (S2) label codes
  t = t.replace(/\b(\d?X{0,3}[SML]|\dXL|X{1,3}L)\b/gi, m => SIZE_WORDS[m.toUpperCase()] || m);
  t = t.replace(/[\/|\_*#]+/g, '، ');
  t = t.replace(/\s*-\s*/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/\s+([،,])/g, '$1');
  t = t.replace(/([،,])\s*[،,]+/g, '$1');
  return t;
}

/**
 * Hands-free Arabic voice guidance with natural voice priority
 */
function speakArabic(text) {
  if (!('speechSynthesis' in window)) return;
  if (window.soundEngine && window.soundEngine.voiceMuted) return;

  try {
    window.speechSynthesis.cancel(); // clear previous utterance for zero lag

    if (!cachedBestArabicVoice) {
      cachedBestArabicVoice = resolveBestArabicVoice();
    }

    const utterance = new SpeechSynthesisUtterance(prepareArabicSpeech(text));
    utterance.lang = cachedBestArabicVoice ? cachedBestArabicVoice.lang : 'ar-EG';
    // Natural voices sound best at normal speed; old desktop voices get a touch slower for clarity
    const userRate = parseFloat(readPref(VOICE_RATE_KEY, '1')) || 1;
    utterance.rate = cachedBestArabicVoice && !isNaturalVoice(cachedBestArabicVoice) ? userRate * 0.95 : userRate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    if (cachedBestArabicVoice) {
      utterance.voice = cachedBestArabicVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('SpeechSynthesis error:', err);
  }
}

window.arabicVoice = {
  list: getArabicVoices,
  current: () => cachedBestArabicVoice,
  isNatural: isNaturalVoice,
  getPreferred: () => readPref(VOICE_PREF_KEY, 'auto'),
  setPreferred(name) {
    writePref(VOICE_PREF_KEY, name || 'auto');
    cachedBestArabicVoice = resolveBestArabicVoice();
  },
  getRate: () => parseFloat(readPref(VOICE_RATE_KEY, '1')) || 1,
  setRate(rate) { writePref(VOICE_RATE_KEY, String(rate)); },
  isEdge: () => /Edg\//.test(navigator.userAgent),
  prepare: prepareArabicSpeech
};

// Global Instances
window.soundEngine = new SoundEngine();
window.speakArabic = speakArabic;
