const $ = (s) => document.querySelector(s);
const socket = io();
const STATUS_LABEL = {
  waiting: '等候',
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
const ERROR_TEXT = {
  'no waiting ticket': '目前沒有等候中的票',
  'counter busy': '這個櫃台還有進行中的票，請先結束或取消',
  'counter not assigned': '尚未設定櫃台號，請聯絡管理員',
  'invalid ticket state': '這張票目前的狀態不能執行此操作',
  'ticket belongs to another counter': '這張票屬於其他櫃台',
  'ticket not called to a counter': '這張票尚未叫號到櫃台',
  'unknown counter': '找不到這個櫃台',
  'invalid counter': '櫃台號格式不正確',
  'a counter can only be assigned to a called or serving ticket that keeps its status': '只有保留狀態的已叫號或服務中票券可以指定櫃台',
  'agent not found': '找不到這位人員',
  'ambiguous agent name': '有多位人員同名，請改用指定櫃台',
  'text is required': '請輸入訊息內容',
  'invalid serviceType': '服務別不正確',
  'not found': '找不到這張票',
  'unauthorized - not logged in': '登入已失效，即將前往登入頁',
  'unauthorized - session revoked': '登入已失效，即將前往登入頁'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }
function errorText(error) { return ERROR_TEXT[error] || error; }
let me = null;
let services = [];
let latestOverview = null;
let selected = null;
let csrfToken = null;
let dialogTicket = null;
function displayName(agent) { return agent.name || agent.account; }
function myCounter() { return me ? String(me.counter || '').trim() : ''; }
function serviceName(code) {
  const service = services.find(s => s.code === code);
  return service ? service.name : code;
}
function redirectToLogin() {
  window.location.href = `/login/index.html?redirect=${encodeURIComponent(location.pathname)}`;
}
async function fetchCsrf() {
  const res = await fetch('/api/csrf', { credentials: 'include' });
  csrfToken = res.ok ? (await res.json()).csrfToken : null;
}
async function apiFetch(url, opts = {}, retried = false) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { ...opts.headers };
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutating) {
    if (!csrfToken) await fetchCsrf();
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
  }
  const res = await fetch(url, { ...opts, headers, credentials: 'include' });
  if (res.status === 401) {
    setTimeout(redirectToLogin, 1500);
    return res;
  }
  if (res.status === 403 && mutating && !retried) {
    const data = await res.clone().json().catch(() => null);
    if (data && data.error === 'invalid csrf token') {
      csrfToken = null;
      return apiFetch(url, opts, true);
    }
  }
  return res;
}
const OFFLINE_TEXT = '無法連線到伺服器，請檢查網路';
async function postJson(url, body) {
  let res;
  try {
    res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { error: OFFLINE_TEXT };
  }
  return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}
function setSelectedInfo(ticket) {
  const el = $('#selectedInfo');
  el.textContent = '';
  if (!ticket) { el.textContent = '尚未選取票券'; return; }
  el.append('已選取 ');
  const strong = document.createElement('strong');
  strong.textContent = String(ticket.number || '');
  el.appendChild(strong);
  el.append(ticket.counter ? `，櫃台 ${ticket.counter}` : `，${serviceName(ticket.serviceType)}等候中`);
}
function selectTicket(ticket) {
  selected = ticket ? { id: ticket.id, number: ticket.number, counter: ticket.counter, serviceType: ticket.serviceType } : null;
  $('#ticketId').value = selected ? selected.number : '';
  setSelectedInfo(selected);
}
function findListedTicket(overview, matches) {
  const call = overview.currentCalls.find(matches);
  if (call) return call;
  for (const [serviceType, tickets] of Object.entries(overview.waiting)) {
    const waiting = tickets.find(matches);
    if (waiting) return { ...waiting, serviceType, counter: null };
  }
  return null;
}
function minutesSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
function updateClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  $('#clock').textContent = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
setInterval(updateClock, 1000); updateClock();
function setMinutes(valueSel, unitSel, iso) {
  const hasValue = Boolean(iso);
  $(valueSel).textContent = hasValue ? String(minutesSince(iso)) : '—';
  $(unitSel).classList.toggle('hidden', !hasValue);
}
function renderCategoryList(summary) {
  const counts = Object.fromEntries(summary.map(s => [s.serviceType, s.waiting]));
  const active = $('#serviceType').value;
  const wrap = $('#categoryList');
  wrap.textContent = '';
  for (const service of services) {
    const isActive = service.code === active;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = isActive ? 'queue-item active' : 'queue-item';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(isActive));
    const labelEl = document.createElement('span'); labelEl.className = 'name'; labelEl.textContent = service.name;
    const countEl = document.createElement('span'); countEl.className = 'count'; countEl.textContent = String(counts[service.code]);
    row.append(labelEl, countEl);
    row.onclick = () => {
      $('#serviceType').value = service.code;
      refresh(latestOverview);
    };
    wrap.appendChild(row);
  }
  $('#activeServiceName').textContent = serviceName(active);
}
async function refresh(overview) {
  if (overview) {
    latestOverview = overview;
  } else {
    const res = await apiFetch('/api/overview');
    if (!res.ok) return;
    latestOverview = await res.json();
  }
  const data = latestOverview;
  const myCall = data.currentCalls.find(c => myCounter() && c.counter === myCounter());
  const stillListed = selected && findListedTicket(data, t => t.id === selected.id);
  if (stillListed) {
    selected = { id: stillListed.id, number: stillListed.number, counter: stillListed.counter, serviceType: stillListed.serviceType };
    setSelectedInfo(selected);
  } else if (document.activeElement !== $('#ticketId')) {
    selectTicket(myCall || null);
  } else {
    selected = null;
    setSelectedInfo(null);
  }
  const firstWaiting = data.waiting[$('#serviceType').value][0];
  setMinutes('#waitTimeField', '#waitTimeUnit', firstWaiting && firstWaiting.createdAt);
  $('#currentCallField').textContent = myCall ? myCall.number : '—';
  setMinutes('#serviceTimeField', '#serviceTimeUnit', myCall && myCall.calledAt);
  $('#totalWaitCount').textContent = String(data.summary.reduce((n, s) => n + s.waiting, 0));
  renderCategoryList(data.summary);
}
function requireSelection() {
  if (!selected) {
    toast('請先選取一張票券', 'error');
    $('#ticketId').focus();
  }
  return selected;
}
function requireCounter() {
  if (!myCounter()) toast('尚未設定櫃台號，請聯絡管理員', 'error');
  return Boolean(myCounter());
}
async function runAction(url, body, describe, after) {
  const data = await postJson(url, body);
  if (data.error) {
    toast(errorText(data.error), 'error');
    return false;
  }
  toast(describe(data.ticket), 'success');
  if (after) after(data.ticket);
  return true;
}
function openDialog(id, title) {
  const dialog = $(id);
  const form = dialog.querySelector('form');
  if (form) form.reset();
  if (title) dialog.querySelector('.modal-title').textContent = title;
  dialog.showModal();
  const first = dialog.querySelector('textarea, input:not([type="radio"]), select');
  if (first) first.focus();
}
async function submitDialog(form, action) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    if (await action()) form.closest('dialog').close();
  } finally {
    btn.disabled = false;
  }
}
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});
$('#pickForm').onsubmit = (e) => {
  e.preventDefault();
  const typed = $('#ticketId').value.trim().toUpperCase();
  if (!typed) { toast('請先輸入號碼', 'error'); $('#ticketId').focus(); return; }
  const ticket = latestOverview && findListedTicket(latestOverview, t => String(t.number).toUpperCase() === typed || String(t.id) === typed);
  if (!ticket) { toast(`找不到 ${typed}，只能選取等候中或進行中的票`, 'error'); return; }
  selectTicket(ticket);
};
$('#callNext').onclick = () => {
  if (!requireCounter()) return;
  runAction('/api/agent/callNext', { serviceType: $('#serviceType').value }, t => `已叫號 ${t.number}`, selectTicket);
};
$('#markServing').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  runAction('/api/agent/markServing', { ticketId: ticket.id }, t => `開始服務 ${t.number}`);
};
$('#recall').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  runAction('/api/agent/recall', { ticketId: ticket.id }, t => `已重叫 ${t.number}`, selectTicket);
};
$('#finish').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  dialogTicket = ticket;
  openDialog('#finishDialog', `結束服務 ${ticket.number}`);
};
$('#finishForm').onsubmit = (e) => {
  e.preventDefault();
  const ticket = dialogTicket;
  const result = $('#finishResult').value.trim();
  submitDialog(e.target, () => runAction('/api/agent/finish', { ticketId: ticket.id, result: result || undefined }, t => `已完成 ${t.number}`, () => selectTicket(null)));
};
$('#cancel').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  dialogTicket = ticket;
  openDialog('#cancelDialog', `取消 ${ticket.number}`);
};
$('#cancelForm').onsubmit = (e) => {
  e.preventDefault();
  const ticket = dialogTicket;
  const reason = $('#cancelReason').value.trim();
  submitDialog(e.target, () => runAction('/api/agent/cancel', { ticketId: ticket.id, reason: reason || undefined }, t => `已取消 ${t.number}`, () => selectTicket(null)));
};
function syncTransferCounter() {
  const keep = document.querySelector('input[name="transferKeep"]:checked').value === 'keep';
  $('#transferCounter').disabled = !keep;
  if (!keep) $('#transferCounter').value = '';
}
document.querySelectorAll('input[name="transferKeep"]').forEach(input => { input.onchange = syncTransferCounter; });
$('#transfer').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  dialogTicket = ticket;
  const select = $('#transferService');
  select.textContent = '';
  const keepOption = document.createElement('option');
  keepOption.value = '';
  keepOption.textContent = `維持目前（${serviceName(ticket.serviceType)}）`;
  select.appendChild(keepOption);
  for (const service of services) {
    if (service.code === ticket.serviceType) continue;
    const option = document.createElement('option');
    option.value = service.code;
    option.textContent = service.name;
    select.appendChild(option);
  }
  openDialog('#transferDialog', `轉櫃／轉服務 ${ticket.number}`);
  syncTransferCounter();
};
$('#transferForm').onsubmit = (e) => {
  e.preventDefault();
  const ticket = dialogTicket;
  const keepStatus = document.querySelector('input[name="transferKeep"]:checked').value === 'keep';
  const toServiceType = $('#transferService').value || undefined;
  const toCounter = keepStatus ? ($('#transferCounter').value.trim() || undefined) : undefined;
  submitDialog(e.target, () => runAction('/api/agent/transfer', { ticketId: ticket.id, toServiceType, toCounter, keepStatus }, t => `已轉出 ${t.number}`));
};
function callSpecific(internal) {
  const ticket = requireSelection(); if (!ticket) return;
  if (!requireCounter()) return;
  runAction('/api/agent/callSpecific', { ticketId: ticket.id, internal }, t => `${internal ? '內部叫號' : '指定叫號'} ${t.number}`, selectTicket);
}
$('#callSpecific').onclick = () => callSpecific(false);
$('#internalCall').onclick = () => callSpecific(true);
function createCounterTicket() {
  runAction('/api/agent/createTicket', { serviceType: $('#serviceType').value }, t => `已取號 ${t.number}`);
}
$('#createTicket').onclick = createCounterTicket;
$('#pickup').onclick = createCounterTicket;
$('#pause').onclick = () => {
  const ticket = requireSelection(); if (!ticket) return;
  runAction('/api/agent/transfer', { ticketId: ticket.id, keepStatus: false }, t => `已暫停 ${t.number}，票券回到等候`);
};
function renderHistoryState(text) {
  const body = $('#historyBody');
  body.textContent = '';
  const box = document.createElement('div');
  box.className = 'empty-state';
  const strong = document.createElement('strong');
  strong.textContent = text;
  box.appendChild(strong);
  body.appendChild(box);
}
$('#history').onclick = async () => {
  const serviceType = $('#serviceType').value;
  $('#historyTitle').textContent = `歷史紀錄：${serviceName(serviceType)}`;
  renderHistoryState('載入中…');
  $('#historyDrawer').showModal();
  let res;
  try {
    res = await apiFetch(`/api/agent/history?limit=100&serviceType=${encodeURIComponent(serviceType)}`);
  } catch (err) {
    renderHistoryState(`查詢失敗：${OFFLINE_TEXT}`);
    return;
  }
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) { renderHistoryState(`查詢失敗：${errorText(data.error || '請稍後再試')}`); return; }
  const rows = data.tickets;
  if (!rows.length) { renderHistoryState('這個服務別還沒有已完成或已取消的票'); return; }
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  [['號碼', ''], ['狀態', ''], ['櫃台', ''], ['完成時間', 'time']].forEach(([h, cls]) => {
    const th = document.createElement('th'); th.textContent = h; if (cls) th.className = cls; headRow.appendChild(th);
  });
  thead.appendChild(headRow); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(t => {
    const tr = document.createElement('tr');
    const tdNumber = document.createElement('td'); tdNumber.textContent = String(t.number || ''); tr.appendChild(tdNumber);
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${STATUS_BADGE[t.status] || ''}`.trim();
    badge.textContent = statusLabel(t.status);
    tdStatus.appendChild(badge); tr.appendChild(tdStatus);
    const tdCounter = document.createElement('td'); tdCounter.textContent = String(t.counter || '-'); tr.appendChild(tdCounter);
    const tdTime = document.createElement('td'); tdTime.className = 'time'; tdTime.textContent = t.finishedAt ? new Date(t.finishedAt).toLocaleString() : '-'; tr.appendChild(tdTime);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const body = $('#historyBody');
  body.textContent = '';
  body.appendChild(table);
};
$('#historyClose').onclick = () => $('#historyDrawer').close();
function syncMessageTarget() {
  const target = document.querySelector('input[name="messageTarget"]:checked').value;
  $('#messageCounterField').classList.toggle('hidden', target !== 'counter');
  $('#messageAgentField').classList.toggle('hidden', target !== 'agent');
}
document.querySelectorAll('input[name="messageTarget"]').forEach(input => { input.onchange = syncMessageTarget; });
$('#message').onclick = () => {
  openDialog('#messageDialog');
  syncMessageTarget();
  $('#messageText').focus();
};
$('#messageForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#messageText').value.trim();
  const target = document.querySelector('input[name="messageTarget"]:checked').value;
  const body = { text };
  if (!text) { toast('請輸入訊息內容', 'error'); $('#messageText').focus(); return; }
  if (target === 'counter') {
    body.toCounter = $('#messageCounter').value.trim();
    if (!body.toCounter) { toast('請輸入櫃台號', 'error'); $('#messageCounter').focus(); return; }
  } else if (target === 'agent') {
    body.toAgent = $('#messageAgent').value.trim();
    if (!body.toAgent) { toast('請輸入人員姓名', 'error'); $('#messageAgent').focus(); return; }
  }
  submitDialog(e.target, async () => {
    const data = await postJson('/api/agent/message', body);
    if (data.error) { toast(errorText(data.error), 'error'); return false; }
    toast('已送出訊息', 'success');
    return true;
  });
};
$('#logoutBtn').onclick = async () => {
  csrfToken = null;
  const res = await apiFetch('/api/logout', { method: 'POST' }).catch(() => null);
  if (res && res.status === 401) return;
  if (!res || !res.ok) { toast('登出失敗，請重試', 'error'); return; }
  window.location.href = '/login/index.html';
};
socket.on('agent:message', (payload) => {
  const { text, from } = payload;
  if (me && from === displayName(me)) return;
  toast(`${from}：${text}`, 'info', 8000);
});
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  const target = { n: '#callNext', s: '#markServing', f: '#finish', x: '#cancel' }[key];
  if (!target) return;
  e.preventDefault();
  $(target).click();
});
async function init() {
  const profileRes = await apiFetch('/api/agent/profile');
  if (!profileRes.ok) return;
  me = (await profileRes.json()).agent;
  const configRes = await fetch('/api/config');
  if (!configRes.ok) { toast('無法載入服務設定', 'error'); return; }
  services = (await configRes.json()).services;
  $('#serviceType').value = services[0].code;
  $('#agentNameDisplay').textContent = displayName(me);
  $('#counter').textContent = myCounter() || '未設定';
  socket.on('queue:update', (payload) => refresh(payload.overview));
  await refresh();
}
init();
