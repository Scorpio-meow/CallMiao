const socket = io();
let audioEnabled = false;
async function render() {
  const res = await fetch('/api/overview');
  const data = await res.json();
  const calls = data.currentCalls || [];
  const wrap = document.querySelector('#calls');
  wrap.textContent = '';
  if (!calls.length) {
    const empty = document.createElement('div');
    empty.className = 'row empty';
    empty.textContent = '暫無叫號';
    wrap.appendChild(empty);
    return;
  }
  calls.slice(0, 8).forEach(c => {
    const row = document.createElement('div'); row.className = 'row';
    const num = document.createElement('div'); num.className = 'num'; num.textContent = String(c.number || '');
    const ctr = document.createElement('div'); ctr.className = 'ctr'; ctr.textContent = `櫃台 ${c.counter || '-'}`;
    row.appendChild(num); row.appendChild(ctr);
    wrap.appendChild(row);
  });
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) {
      console.warn('speechSynthesis not supported in this browser');
      return;
    }
    if (!audioEnabled) {
      // Many browsers block speech until a user gesture; warn to help debugging
      console.warn('audio not enabled yet; call enableAudio() or click 啟用聲音');
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    speechSynthesis.speak(u);
  } catch (e) { console.error('speak error', e); }
}
// Voice selection and speak multiple parts in sequence.
// Format number to improve clarity & perceived loudness (read char-by-char)
function formatNumberForSpeak(s) {
  try {
    if (s == null) return '';
    const str = String(s);
    // Insert spaces between each character, e.g., A123 -> "A 1 2 3"
    // This helps some TTS voices pronounce with more emphasis/clarity
    return str.split('').join(' ');
  } catch (_) { return String(s || ''); }
}
let selectedVoice = null;
function chooseVoice() {
  try {
    const voices = speechSynthesis.getVoices() || [];
    console.info('available voices', voices.map(v => ({ name: v.name, lang: v.lang })));
    // prefer Chinese voice
    selectedVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('zh')) || voices[0] || null;
    if (selectedVoice) console.info('selected voice', { name: selectedVoice.name, lang: selectedVoice.lang });
  } catch (e) { console.warn('chooseVoice failed', e); }
}
if ('speechSynthesis' in window) {
  chooseVoice();
  speechSynthesis.onvoiceschanged = chooseVoice;
}
// Speak multiple parts. Each part may be a string or an object { text, volume, rate, pitch }
function speakParts(parts) {
  try {
    if (!('speechSynthesis' in window)) return;
    if (!audioEnabled) console.warn('audio not enabled yet; speak may be blocked');
    let i = 0;
    function next() {
      if (i >= parts.length) return;
      const part = parts[i];
      const text = (typeof part === 'string') ? part : (part && part.text) || '';
      const opts = (typeof part === 'object') ? part : {};
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      if (selectedVoice) u.voice = selectedVoice;
      if (opts.volume !== undefined) {
        // clamp to valid range
        const v = Number(opts.volume);
        u.volume = Math.max(0, Math.min(1, isFinite(v) ? v : 1));
      }
      if (opts.rate !== undefined) u.rate = opts.rate; // default ~1
      if (opts.pitch !== undefined) u.pitch = opts.pitch; // default ~1
      u.onend = () => { i++; setTimeout(next, opts.pauseAfter || 80); };
      speechSynthesis.speak(u);
    }
    next();
  } catch (err) { console.error('speakParts error', err); }
}
function enableAudio() {
  // Called by a user gesture to unlock audio autoplay policy in browsers
  try {
    if ('speechSynthesis' in window) {
      const priming = new SpeechSynthesisUtterance('聲音已啟用');
      priming.lang = 'zh-TW';
      speechSynthesis.speak(priming);
      // mark enabled so subsequent calls won't warn
      audioEnabled = true;
      const btn = document.getElementById('enableSoundBtn');
      if (btn) btn.style.display = 'none';
      console.info('audio enabled via user gesture');
      return;
    }
  } catch (err) {
    console.warn('enableAudio speech failed, trying WebAudio fallback', err);
  }
  // Fallback: create short silent buffer to prime audio output via Web Audio API
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0; // silent
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { try { o.stop(); ctx.close(); } catch (e) { } }, 100);
    audioEnabled = true;
    const btn = document.getElementById('enableSoundBtn');
    if (btn) btn.style.display = 'none';
    console.info('audio primed via WebAudio fallback');
  } catch (e) {
    console.error('audio priming fallback failed', e);
  }
}
socket.on('queue:update', render);
socket.on('call:made', (payload) => {
  render();
  const t = payload?.ticket;
  if (t) {
    // fallback for counter and chain parts to ensure complete speech
    const counter = t.counter || '服務櫃台';
    console.info('call:made payload', { number: t.number, counter });
    // Emphasize number by:
    // 1) speaking it twice
    // 2) spacing characters (A 1 2 3) to increase clarity
    // 3) using max volume=1.0 and a more natural pitch/rate that sounds louder to human ears
    const numSpaced = formatNumberForSpeak(t.number);
    speakParts([
      { text: '請號碼', volume: 1.0, rate: 0.95, pitch: 1.0, pauseAfter: 160 },
      { text: numSpaced, volume: 1.0, rate: 0.95, pitch: 0.96, pauseAfter: 220 },
      { text: numSpaced, volume: 1.0, rate: 0.98, pitch: 0.98, pauseAfter: 240 },
      { text: `到 ${counter} 號櫃台`, volume: 0.98, rate: 0.96, pitch: 1.0, pauseAfter: 140 }
    ]);
  }
});
render();
// attach enable button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('enableSoundBtn');
  if (btn) btn.addEventListener('click', enableAudio);
  // If speechSynthesis is not available, hide the button
  if (!('speechSynthesis' in window) && btn) {
    btn.style.display = 'none';
  }
});
