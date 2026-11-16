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
    btn.classList.toggle('hidden', notifyEnabled);
    statusEl.classList.toggle('hidden', !notifyEnabled);
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
  waiting: '等候中',
  called: '已叫號',
  serving: '服務中',
  finished: '已完成',
  canceled: '已取消'
};
const STATUS_BADGE = {
  waiting: 'badge-info',
  called: 'badge-warning',
  serving: 'badge-brand',
  finished: 'badge-success',
  canceled: ''
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }
function isActiveStatus(s) { return s === 'called' || s === 'serving'; }
function isOpenStatus(s) { return s === 'waiting' || isActiveStatus(s); }
function showState(title, detail) {
  const infoWrap = document.querySelector('#info');
  infoWrap.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  infoWrap.appendChild(strong);
  if (detail) {
    const p = document.createElement('p');
    p.textContent = detail;
    infoWrap.appendChild(p);
  }
  infoWrap.classList.remove('hidden');
  document.querySelector('#ticketCard').classList.add('hidden');
  document.querySelector('#progress').classList.add('hidden');
  document.querySelector('#notifyBar').classList.add('hidden');
}
function renderInfo(ticket) {
  document.querySelector('#info').classList.add('hidden');
  document.querySelector('#ticketCard').classList.remove('hidden');
  document.querySelector('#progress').classList.remove('hidden');
  document.querySelector('#notifyBar').classList.toggle('hidden', !isOpenStatus(ticket.status));
  document.querySelector('#ticketNumber').textContent = String(ticket.number || '');
  const badge = document.querySelector('#ticketStatus');
  badge.className = `badge status ${STATUS_BADGE[ticket.status] || ''}`.trim();
  badge.textContent = statusLabel(ticket.status);
  const callout = document.querySelector('#ticketCallout');
  const showCallout = ticket.status === 'called' && ticket.counter;
  callout.classList.toggle('hidden', !showCallout);
  callout.textContent = showCallout ? `輪到您了，請前往櫃台 ${ticket.counter}` : '';
  document.querySelector('#ticketCounter').textContent = String(ticket.counter || '-');
  document.querySelector('#ticketCreated').textContent = new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  if (!ticket || !latestOverview) return;
  const latest = latestOverview.currentCalls.find(c => c.serviceType === ticket.serviceType);
  document.querySelector('#currentCall').textContent = latest ? `${latest.number}${latest.counter ? `（櫃台 ${latest.counter}）` : ''}` : '-';
  const queue = latestOverview.waiting[ticket.serviceType];
  const ahead = ticket.status === 'waiting' && queue ? queue.findIndex(t => String(t.id) === id) : -1;
  document.querySelector('#aheadRow').classList.toggle('hidden', ahead < 0);
  document.querySelector('#aheadCount').textContent = ahead >= 0 ? String(ahead) : '';
}
async function loadOnce() {
  const res = await fetch(`/api/ticket/${id}`);
  if (res.status === 404) {
    showState('找不到這張票券', '請確認網址是否完整，或重新掃描取號時的 QR Code。');
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
    showState('網址缺少票券編號', '請重新掃描取號時的 QR Code。');
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