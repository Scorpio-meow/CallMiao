const $ = (s) => document.querySelector(s);
const socket = io();
const STATUS_LABEL = {
    waiting: '等候',
    called: '已叫號',
    serving: '服務中',
    finished: '已完成',
    canceled: '已取消'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }
let me = null;
let services = [];
let latestOverview = null;
let selected = null;
let csrfToken = null;
function displayName(agent) { return agent.name || agent.account; }
function myCounter() { return me ? String(me.counter || '').trim() : ''; }
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toaster').appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => { el.classList.remove('show'); el.remove(); }, 3000);
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
        toast('認證失敗，請重新登入', 'error');
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
async function postJson(url, body) {
    const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}
function setSelectedInfo(ticket) {
    const el = $('#selectedInfo');
    if (!ticket) { el.textContent = ''; return; }
    el.textContent = '選取：';
    const strong = document.createElement('strong');
    strong.textContent = String(ticket.number || '');
    el.appendChild(strong);
    el.appendChild(document.createTextNode(`，櫃台 ${String(ticket.counter || '-')}`));
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
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    $('#clock').textContent = `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
}
setInterval(updateClock, 1000); updateClock();
function renderCategoryList(summary) {
    const counts = Object.fromEntries(summary.map(s => [s.serviceType, s.waiting]));
    const active = $('#serviceType').value;
    const wrap = $('#categoryList');
    wrap.textContent = '';
    for (const service of services) {
        const row = document.createElement('div');
        row.className = service.code === active ? 'category-row active' : 'category-row';
        const countEl = document.createElement('div'); countEl.className = 'count'; countEl.textContent = String(counts[service.code]);
        const labelEl = document.createElement('div'); labelEl.className = 'label'; labelEl.textContent = service.name;
        row.appendChild(countEl);
        row.appendChild(labelEl);
        row.onclick = () => {
            $('#serviceType').value = service.code;
            refresh(latestOverview);
        };
        wrap.appendChild(row);
    }
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
    $('#waitTimeField').value = firstWaiting ? `${minutesSince(firstWaiting.createdAt)} 分鐘` : '—';
    $('#currentCallField').value = myCall ? myCall.number : '—';
    $('#serviceTimeField').value = myCall && myCall.calledAt ? `${minutesSince(myCall.calledAt)} 分鐘` : '—';
    $('#totalWaitCount').textContent = String(data.summary.reduce((n, s) => n + s.waiting, 0));
    renderCategoryList(data.summary);
}
function requireSelection() {
    if (!selected) alert('請選取一筆叫號');
    return selected;
}
function requireCounter() {
    if (!myCounter()) alert('櫃台號未設定，請聯絡管理員設定您的櫃台號');
    return Boolean(myCounter());
}
async function runAction(url, body, describe, after) {
    const data = await postJson(url, body);
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(describe(data.ticket), 'success');
        if (after) after(data.ticket);
    }
}
$('#pickFromInput').onclick = (e) => {
    e.preventDefault();
    const typed = $('#ticketId').value.trim().toUpperCase();
    if (!typed) { alert('請先輸入或選取號碼'); return; }
    const ticket = latestOverview && findListedTicket(latestOverview, t => String(t.number).toUpperCase() === typed || String(t.id) === typed);
    if (!ticket) { alert('找不到對應的叫號'); return; }
    selectTicket(ticket);
};
$('#callNext').onclick = () => {
    if (!requireCounter()) return;
    runAction('/api/agent/callNext', { serviceType: $('#serviceType').value }, t => `已叫號 ${t.number}`, selectTicket);
};
$('#markServing').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    runAction('/api/agent/markServing', { ticketId: ticket.id }, t => `已開始服務 ${t.number}`);
};
$('#finish').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    const result = prompt(`結束 ${ticket.number}：處理結果（備註，可留空）`);
    if (result === null) return;
    runAction('/api/agent/finish', { ticketId: ticket.id, result: result || undefined }, t => `已完成 ${t.number}`, () => selectTicket(null));
};
$('#cancel').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    const reason = prompt(`取消 ${ticket.number}：取消原因（備註，可留空）`);
    if (reason === null) return;
    if (!confirm(`確定要取消 ${ticket.number}？此動作無法復原。`)) return;
    runAction('/api/agent/cancel', { ticketId: ticket.id, reason: reason || undefined }, t => `已取消 ${t.number}`, () => selectTicket(null));
};
$('#recall').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    runAction('/api/agent/recall', { ticketId: ticket.id }, t => `重叫 ${t.number}`, selectTicket);
};
$('#transfer').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    const codes = services.map(s => s.code).join('/');
    const toServiceType = prompt(`${ticket.number} 轉至服務類型（${codes}，不填維持）`) || undefined;
    const keepStatus = confirm('保持狀態與叫號時間？按 確定 保持 / 取消 重置為等待');
    const toCounter = keepStatus ? (prompt('指定櫃台（可留空，僅限已叫號或服務中的票）') || undefined) : undefined;
    runAction('/api/agent/transfer', { ticketId: ticket.id, toServiceType, toCounter, keepStatus }, t => `已轉至 ${t.serviceType}`);
};
function callSpecific(internal) {
    const ticket = requireSelection(); if (!ticket) return;
    if (!requireCounter()) return;
    runAction('/api/agent/callSpecific', { ticketId: ticket.id, internal }, t => `${internal ? '內部叫號' : '指定叫號'} ${t.number}`, selectTicket);
}
$('#callSpecific').onclick = () => callSpecific(false);
$('#internalCall').onclick = () => callSpecific(true);
function createCounterTicket() {
    runAction('/api/agent/createTicket', { serviceType: $('#serviceType').value }, t => `已建立 ${t.number}`);
}
$('#createTicket').onclick = createCounterTicket;
$('#pickup').onclick = createCounterTicket;
$('#pause').onclick = () => {
    const ticket = requireSelection(); if (!ticket) return;
    runAction('/api/agent/transfer', { ticketId: ticket.id, keepStatus: false }, () => '已暫停，票券回到等待');
};
$('#history').onclick = async () => {
    const serviceType = $('#serviceType').value;
    const res = await apiFetch(`/api/agent/history?limit=100&serviceType=${encodeURIComponent(serviceType)}`);
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || data.error) { alert(data.error || '查詢失敗'); return; }
    const rows = data.tickets;
    const body = $('#historyBody');
    body.textContent = '';
    if (!rows.length) {
        const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = '無資料';
        body.appendChild(empty);
    } else {
        const table = document.createElement('table'); table.className = 'table';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['號碼', '狀態', '櫃台', '完成時間'].forEach(h => { const th = document.createElement('th'); th.textContent = h; headRow.appendChild(th); });
        thead.appendChild(headRow); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        rows.forEach(t => {
            const tr = document.createElement('tr');
            [String(t.number || ''), statusLabel(t.status), String(t.counter || '-'), t.finishedAt ? new Date(t.finishedAt).toLocaleString() : '-'].forEach(v => {
                const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody); body.appendChild(table);
    }
    $('#historyModal').classList.remove('hidden');
};
$('#historyClose').onclick = () => $('#historyModal').classList.add('hidden');
$('#message').onclick = async () => {
    const text = prompt('輸入要傳送的訊息');
    if (!text) return;
    const targetType = prompt('指定傳送對象類型：輸入 C 表示櫃台，A 表示人員，留空表示廣播');
    const body = { text };
    if (targetType && targetType.toUpperCase() === 'C') {
        const ctr = prompt('輸入目標櫃台號（例如：1 或 A1）');
        if (!ctr) { alert('未輸入櫃台，取消'); return; }
        body.toCounter = ctr;
    } else if (targetType && targetType.toUpperCase() === 'A') {
        const ag = prompt('輸入目標服務人員姓名（完全匹配）');
        if (!ag) { alert('未輸入姓名，取消'); return; }
        body.toAgent = ag;
    }
    const data = await postJson('/api/agent/message', body);
    if (data.error) { alert(data.error); return; }
    toast('已送出訊息', 'success');
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
    toast(`【訊息】${from}：${text}`, 'info');
});
window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#callNext').click(); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); $('#markServing').click(); }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); $('#finish').click(); }
    if (e.key === 'x' || e.key === 'X') { e.preventDefault(); $('#cancel').click(); }
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
    $('#authStatus').textContent = '已登入';
    $('#counter').value = myCounter();
    if (!myCounter()) $('#counter').placeholder = '未設定（請聯絡管理員）';
    socket.on('queue:update', (payload) => refresh(payload.overview));
    await refresh();
}
init();