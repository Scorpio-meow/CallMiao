const params = new URLSearchParams(location.search);
const rawId = params.get('id');
const id = rawId && /^\d+$/.test(rawId) ? rawId : null;
const socket = io();
let ticket = null;
let lastStatus = null;
let latestOverview = null;
let lastSignature = null;
let loadInFlight = false;
let loadPending = false;
let retryTimer = null;
let notifyEnabled = (localStorage.getItem('notifyEnabled') === '1');
let audioCtx = null;
function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) { }
}
function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
  } catch (_) { return null; }
}
function beep(times = 2) {
  const ctx = ensureAudio();
  if (!ctx) return;
  let t = ctx.currentTime;
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
    t += 0.38;
  }
}
function triggerAlert() {
  if (!notifyEnabled) return;
  vibrate([220, 100, 220, 120, 360]);
  try {
    beep(3);
  } catch (_) { }
}
function setupNotifyUI() {
  const btn = document.getElementById('enableNotify');
  const statusEl = document.getElementById('notifyStatus');
  const reflect = () => {
    if (notifyEnabled) {
      btn.style.display = 'none';
      statusEl.textContent = '提醒已啟用（若瀏覽器支援）';
    } else {
      btn.style.display = '';
      statusEl.textContent = '';
    }
  };
  btn.addEventListener('click', async () => {
    try {
      const ctx = ensureAudio();
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch (_) { }
    notifyEnabled = true;
    localStorage.setItem('notifyEnabled', '1');
    vibrate([100]);
    reflect();
  });
  reflect();
}
const STATUS_LABEL = {
  waiting: '等候',
  called: '已叫號',
  serving: '服務中',
  finished: '已完成',
  canceled: '已取消'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }
function isActiveStatus(s) { return s === 'called' || s === 'serving'; }
function renderInfo(ticket) {
  const infoWrap = document.querySelector('#info');
  if (!infoWrap) return;
  infoWrap.textContent = '';
  const pNum = document.createElement('p'); pNum.textContent = '號碼：'; const strong = document.createElement('strong'); strong.textContent = String(ticket.number || ''); pNum.appendChild(strong); infoWrap.appendChild(pNum);
  const pStatus = document.createElement('p'); pStatus.textContent = '狀態：' + statusLabel(ticket.status); infoWrap.appendChild(pStatus);
  const pCounter = document.createElement('p'); pCounter.textContent = '櫃台：' + String(ticket.counter || '-'); infoWrap.appendChild(pCounter);
  const pCreated = document.createElement('p'); pCreated.textContent = '建立：' + new Date(ticket.createdAt).toLocaleString(); infoWrap.appendChild(pCreated);
}
function scheduleRetry(res) {
  const retryAfterSec = Number(res.headers.get('Retry-After'));
  if (retryTimer || !Number.isFinite(retryAfterSec) || retryAfterSec <= 0) return;
  retryTimer = setTimeout(() => { retryTimer = null; load(); }, retryAfterSec * 1000);
}
async function load() {
  if (loadInFlight) { loadPending = true; return; }
  loadInFlight = true;
  try {
    await loadOnce();
  } finally {
    loadInFlight = false;
    if (loadPending) { loadPending = false; load(); }
  }
}
function signatureOf(overview) {
  const call = overview.currentCalls.find(c => String(c.id) === id);
  if (call) return `${call.status}|${call.serviceType}|${call.counter}`;
  for (const [serviceType, tickets] of Object.entries(overview.waiting)) {
    if (tickets.some(t => String(t.id) === id)) return `waiting|${serviceType}`;
  }
  return 'closed';
}
function renderProgress() {
  const progressEl = document.querySelector('#progress');
  progressEl.textContent = '';
  if (!ticket || !latestOverview) return;
  const latest = latestOverview.currentCalls.find(c => c.serviceType === ticket.serviceType);
  const pNow = document.createElement('p');
  pNow.textContent = '目前叫號：' + (latest ? `${latest.number}${latest.counter ? `（${latest.counter}櫃台）` : ''}` : '-');
  progressEl.appendChild(pNow);
  const queue = latestOverview.waiting[ticket.serviceType];
  const ahead = ticket.status === 'waiting' && queue ? queue.findIndex(t => String(t.id) === id) : -1;
  if (ahead >= 0) {
    const pAhead = document.createElement('p');
    pAhead.textContent = `前面尚有：${ahead} 位`;
    progressEl.appendChild(pAhead);
  }
}
async function loadOnce() {
  const res = await fetch(`/api/ticket/${id}`);
  if (res.status === 404) {
    document.querySelector('#info').textContent = '票券不存在';
    document.querySelector('#progress').textContent = '';
    return;
  }
  if (!res.ok) {
    scheduleRetry(res);
    return;
  }
  ticket = (await res.json()).ticket;
  renderInfo(ticket);
  renderProgress();
  if (lastStatus && lastStatus !== ticket.status && isActiveStatus(ticket.status)) triggerAlert();
  lastStatus = ticket.status;
}
function applyOverview(overview) {
  latestOverview = overview;
  const signature = signatureOf(overview);
  if (signature === lastSignature) {
    renderProgress();
    return;
  }
  lastSignature = signature;
  load();
}
async function init() {
  setupNotifyUI();
  if (!id) {
    document.querySelector('#info').textContent = '缺少票券 ID';
    return;
  }
  socket.on('queue:update', (payload) => applyOverview(payload.overview));
  socket.on('call:made', (data) => {
    const t = data.ticket;
    if (String(t.id) !== id) return;
    ticket = t;
    renderInfo(t);
    renderProgress();
    if (isActiveStatus(t.status)) triggerAlert();
    lastStatus = t.status;
  });
  const res = await fetch('/api/overview');
  const fetched = res.ok ? await res.json() : null;
  if (fetched && !latestOverview) {
    latestOverview = fetched;
    lastSignature = signatureOf(latestOverview);
  }
  load();
}
init();