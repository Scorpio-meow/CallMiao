const $ = (s) => document.querySelector(s);
const socket = io();
// 狀態中文對照
const STATUS_LABEL = {
    waiting: '等候',
    called: '已叫號',
    serving: '服務中',
    finished: '已完成',
    canceled: '已取消',
    cancelled: '已取消'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }
let agentName = sessionStorage.getItem('ui_agent_name') || '';
let savedCounter = sessionStorage.getItem('ui_agent_counter') || '';
function updateAgentNameUI() { $('#agentNameDisplay').textContent = agentName || '—'; }
function initializeCounterDisplay() {
    const savedCounter = sessionStorage.getItem('ui_agent_counter') || '';
    const counterEl = document.querySelector('#counter');
    if (counterEl) {
        counterEl.value = savedCounter || '';
        if (!savedCounter) {
            counterEl.placeholder = '未設定（請聯絡管理員）';
        }
    }
}
if (savedCounter) { const c = document.querySelector('#counter'); if (c && !c.value) c.value = savedCounter; }
if (agentName) document.querySelector('#authStatus').textContent = '已登入';
updateAgentNameUI();
initializeCounterDisplay();
// overlay login
function showOverlay() { document.querySelector('#authOverlay').classList.remove('hidden'); }
function hideOverlay() { document.querySelector('#authOverlay').classList.add('hidden'); }
// If there's no stored agent info, redirect to the centralized login page and request return to this page.
if (!agentName) {
    const redirect = encodeURIComponent('/agent/index.html');
    window.location.href = `/login/index.html?redirect=${redirect}`;
}
document.querySelector('#loginBtn').onclick = () => {
    const nm = document.querySelector('#loginName').value.trim();
    const ctr = document.querySelector('#loginCounter').value.trim();
    if (!nm) { alert('請輸入姓名'); return; }
    if (!ctr) { alert('請輸入櫃台號'); return; }
    agentName = nm; savedCounter = ctr;
    // ⚠️ 僅供 UI 顯示用途，實際認證由後端 session 處理
    if (agentName) sessionStorage.setItem('ui_agent_name', agentName);
    if (savedCounter) sessionStorage.setItem('ui_agent_counter', savedCounter);
    // Update the counter display
    initializeCounterDisplay();
    document.querySelector('#authStatus').textContent = '已登入';
    updateAgentNameUI();
    hideOverlay();
    refresh();
};
document.querySelector('#logoutBtn').onclick = async () => {
    // Call server logout API to destroy session
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (err) {
        console.warn('Logout API error:', err);
    }
    // Clear UI-only sessionStorage keys (server session destroyed via API)
    sessionStorage.removeItem('ui_agent_name');
    sessionStorage.removeItem('ui_agent_account');
    sessionStorage.removeItem('ui_agent_counter');
    sessionStorage.removeItem('ui_agent_id');
    sessionStorage.removeItem('ui_agent_role');
    document.querySelector('#authStatus').textContent = '';
    updateAgentNameUI();
    // Clear counter display
    const counterEl = document.querySelector('#counter');
    if (counterEl) {
        counterEl.value = '';
        counterEl.placeholder = '未設定（請聯絡管理員）';
    }
    // Redirect to login page
    window.location.href = '/login/index.html';
};
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.querySelector('#toaster').appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => { el.classList.remove('show'); el.remove(); }, 3000);
}
// apiFetch wrapper: Now authentication is handled by server-side session cookies
// We no longer need to send custom headers for authentication
// CSRF token cache and fetch helper
let __cachedCsrf = null;
let __cachedCsrfTs = 0;
async function fetchCsrf() {
    try {
        const res = await fetch('/api/csrf', { method: 'GET', credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.csrfToken) {
            __cachedCsrf = data.csrfToken;
            __cachedCsrfTs = Date.now();
            return __cachedCsrf;
        }
        return null;
    } catch (e) { console.warn('fetchCsrf err', e); return null; }
}
async function apiFetch(url, opts = {}) {
    opts = Object.assign({
        headers: {},
        credentials: 'include' // Important: include cookies for session
    }, opts);
    // For state-changing requests, ensure we have a CSRF token
    const method = (opts.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        if (!opts.headers['x-csrf-token'] && !opts.headers['X-CSRF-Token']) {
            // If token not present or older than 10 minutes, fetch a new one
            if (!__cachedCsrf || (Date.now() - __cachedCsrfTs) > (14 * 60 * 1000)) {
                await fetchCsrf();
            }
            if (__cachedCsrf) {
                opts.headers['x-csrf-token'] = __cachedCsrf;
            }
        }
    }
    let res = await fetch(url, opts);
    if (res.status === 401) {
        toast('認證失敗，請重新登入', 'error');
        // Clear sessionStorage
        sessionStorage.clear();
        setTimeout(() => {
            window.location.href = '/login/index.html';
        }, 1500);
        return res;
    }
    return res;
}
function setSelectedInfo(ticket) {
    const el = document.querySelector('#selectedInfo');
    if (!el) return;
    if (!ticket) { el.textContent = ''; return; }
    // Use textContent and DOM methods to avoid XSS via ticket fields
    // Format: 選取：<strong>TICKET</strong>，櫃台 COUNTER
    el.textContent = '選取：';
    const strong = document.createElement('strong');
    strong.textContent = String(ticket.number || '');
    el.appendChild(strong);
    el.appendChild(document.createTextNode(`，櫃台 ${String(ticket.counter || '-')}`));
}
function updateClock() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const str = `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    const clk = document.querySelector('#clock'); if (clk) clk.textContent = str;
}
setInterval(updateClock, 1000); updateClock();
function renderCategoryList(summary) {
    // Keep the label mapping consistent with the service buttons in the UI
    const SERVICE_NAMES = {
        A: '一般保險服務',
        B: '理賠送件服務',
        C: '保單借據服務',
        D: '繳費服務',
        E: '人生設計所保險諮詢'
    };
    // Standard order A..E
    const order = ['A', 'B', 'C', 'D', 'E'];
    const map = (summary || []).reduce((acc, s) => { acc[s.serviceType] = s.waiting || 0; return acc; }, {});
    // Render only the category rows (no service buttons or quick counters)
    const wrap = document.querySelector('#categoryList');
    if (wrap) {
        wrap.innerHTML = '';
        order.forEach(code => {
            const count = map[code] || 0;
            const row = document.createElement('div');
            row.className = 'category-row';
            row.setAttribute('data-service', code);
            const countEl = document.createElement('div'); countEl.className = 'count'; countEl.textContent = String(count);
            const labelEl = document.createElement('div'); labelEl.className = 'label'; labelEl.textContent = (SERVICE_NAMES[code] || code);
            row.appendChild(countEl);
            row.appendChild(labelEl);
            wrap.appendChild(row);
        });
        // click to select serviceType, update visual active state, and refresh
        const rows = wrap.querySelectorAll('.category-row');
        rows.forEach(el => {
            el.onclick = () => {
                const svc = el.getAttribute('data-service');
                const svcInput = document.querySelector('#serviceType');
                if (svcInput) svcInput.value = svc;
                // visual active
                rows.forEach(r => r.classList.remove('active'));
                el.classList.add('active');
                refresh();
            };
        });
        // initialize active row from #serviceType
        const svc0 = document.querySelector('#serviceType')?.value;
        if (svc0) {
            rows.forEach(r => r.classList.remove('active'));
            const initial = wrap.querySelector(`.category-row[data-service="${svc0}"]`);
            if (initial) initial.classList.add('active');
        }
    }
}
// pick button next to ticketId input: find matching ticket by visible number or internal id
const pickBtn = document.querySelector('#pickFromInput');
if (pickBtn) {
    pickBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const vis = document.querySelector('#ticketId');
        const hid = document.querySelector('#ticketInternalId');
        const num = vis ? (vis.value || '').trim() : '';
        if (!num) { alert('請先輸入或選取號碼'); return; }
        // try to find a row in current list by data-number
        const rowByNumber = document.querySelector(`[data-number="${CSS.escape(num)}"]`);
        if (rowByNumber) {
            const id = rowByNumber.getAttribute('data-id') || '';
            if (hid) hid.value = id;
            if (vis) vis.value = num;
            // construct selected info from currentCalls if present
            const svc = rowByNumber.querySelector('.badge') ? rowByNumber.querySelector('.badge').textContent : '';
            setSelectedInfo({ number: num, counter: rowByNumber.querySelector('td:nth-child(2)') ? rowByNumber.querySelector('td:nth-child(2)').textContent.trim() : '-', serviceType: svc, id: id });
            return;
        }
        // fallback: if num looks numeric, try match by internal id
        const possibleRowById = document.querySelector(`[data-id="${CSS.escape(num)}"]`);
        if (possibleRowById) {
            const number = possibleRowById.getAttribute('data-number') || '';
            if (hid) hid.value = possibleRowById.getAttribute('data-id') || '';
            if (vis) vis.value = number;
            setSelectedInfo({ number: number, counter: possibleRowById.querySelector('td:nth-child(2)') ? possibleRowById.querySelector('td:nth-child(2)').textContent.trim() : '-', id: possibleRowById.getAttribute('data-id') });
            return;
        }
        alert('找不到對應的叫號');
    });
}
async function refresh() {
    const res = await apiFetch('/api/overview');
    const data = await res.json();
    const serviceType = document.querySelector('#serviceType').value;
    // update waiting table (legacy)
    const waitingRes = await apiFetch(`/api/tickets/waiting?serviceType=${serviceType}`);
    const waitingData = await waitingRes.json();
    const waitingTbody = document.querySelector('#waiting');
    if (waitingTbody) {
        waitingTbody.innerHTML = '';
        if (!waitingData.tickets || waitingData.tickets.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td'); td.setAttribute('colspan', '2'); td.textContent = '無'; tr.appendChild(td);
            waitingTbody.appendChild(tr);
        } else {
            waitingData.tickets.forEach(t => {
                const tr = document.createElement('tr'); tr.className = 'clickable';
                tr.setAttribute('data-waiting-id', String(t.id));
                tr.setAttribute('data-id', String(t.id));
                tr.setAttribute('data-number', String(t.number));
                const tdNumber = document.createElement('td'); tdNumber.textContent = String(t.number || '');
                const tdCreated = document.createElement('td'); tdCreated.textContent = new Date(t.createdAt).toLocaleTimeString();
                tr.appendChild(tdNumber); tr.appendChild(tdCreated);
                waitingTbody.appendChild(tr);
            });
        }
    }
    const currentTbody = document.querySelector('#current');
    if (currentTbody) {
        currentTbody.innerHTML = '';
        const calls = data.currentCalls || [];
        if (!calls.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td'); td.setAttribute('colspan', '4'); td.textContent = '無'; tr.appendChild(td);
            currentTbody.appendChild(tr);
        } else {
            calls.forEach(c => {
                const tr = document.createElement('tr'); tr.className = 'clickable';
                tr.setAttribute('data-id', String(c.id)); tr.setAttribute('data-number', String(c.number || ''));
                const tdNum = document.createElement('td');
                const span = document.createElement('span'); span.className = 'badge'; span.textContent = c.serviceType || '';
                tdNum.appendChild(span); tdNum.appendChild(document.createTextNode(' ' + String(c.number || '')));
                const tdCounter = document.createElement('td'); tdCounter.textContent = c.counter || '-';
                const tdCalled = document.createElement('td'); tdCalled.textContent = c.calledAt ? new Date(c.calledAt).toLocaleTimeString() : '-';
                const tdBtn = document.createElement('td'); const btn = document.createElement('button'); btn.className = 'btn btn-light'; btn.setAttribute('data-pick', String(c.id)); btn.textContent = '選取'; tdBtn.appendChild(btn);
                tr.appendChild(tdNum); tr.appendChild(tdCounter); tr.appendChild(tdCalled); tr.appendChild(tdBtn);
                currentTbody.appendChild(tr);
            });
        }
    }
    document.querySelectorAll('[data-id]').forEach(tr => {
        tr.onclick = () => {
            const id = tr.getAttribute('data-id');
            const num = tr.getAttribute('data-number') || '';
            const vis = document.querySelector('#ticketId'); if (vis) vis.value = num || '';
            const hid = document.querySelector('#ticketInternalId'); if (hid) hid.value = id || '';
            // Immediately update selected info with available data
            let ticketInfo = { number: num, id: id };
            // waiting ticket
            if (tr.hasAttribute('data-waiting-id')) {
                const waitingTicket = waitingData.tickets?.find(t => t.id === Number(id));
                if (waitingTicket) {
                    ticketInfo = { ...ticketInfo, counter: waitingTicket.counter };
                }
            } else {
                // current call info
                const currentCall = (data.currentCalls || []).find(c => c.id === Number(id));
                if (currentCall) {
                    ticketInfo = { ...ticketInfo, counter: currentCall.counter, serviceType: currentCall.serviceType };
                }
            }
            setSelectedInfo(ticketInfo);
        };
    });
    document.querySelectorAll('button[data-pick]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-pick');
            const row = document.querySelector(`[data-id="${id}"]`);
            const num = row ? (row.getAttribute('data-number') || '') : '';
            const vis = document.querySelector('#ticketId'); if (vis) vis.value = num || '';
            const hid = document.querySelector('#ticketInternalId'); if (hid) hid.value = id || '';
            // Get detailed info and update selected info
            let ticketInfo = { number: num, id: id };
            const currentCall = (data.currentCalls || []).find(c => c.id === Number(id));
            if (currentCall) {
                ticketInfo = { ...ticketInfo, counter: currentCall.counter, serviceType: currentCall.serviceType };
            }
            setSelectedInfo(ticketInfo);
        };
    });
    // selection: prefer hidden internal id (numeric). If missing, fallback to visible ticket number match.
    const hidVal = document.querySelector('#ticketInternalId')?.value;
    const selId = hidVal ? Number(hidVal) : null;
    const visNum = document.querySelector('#ticketId')?.value;
    let cur = null;
    if (selId) { cur = (data.currentCalls || []).find(x => x.id === selId); }
    if (!cur && visNum) { cur = (data.currentCalls || []).find(x => String(x.number) === String(visNum)); }
    // If still no selection, auto-select current call for this counter (if any).
    if (!cur) {
        const myCounter = sessionStorage.getItem('ui_agent_counter') || document.querySelector('#counter')?.value || '';
        if (myCounter) {
            cur = (data.currentCalls || []).find(c => String(c.counter) === String(myCounter));
        }
    }
    setSelectedInfo(cur || null);
    // Stats: local (selected service waiting), total (sum waiting)
    const summary = data.summary || [];
    const sumMap = summary.reduce((acc, s) => { acc[s.serviceType] = s.waiting || 0; return acc; }, {});
    const local = sumMap[serviceType] || 0;
    const total = summary.reduce((n, s) => n + (s.waiting || 0), 0);
    const lw = document.querySelector('#localWaitCount'); if (lw) lw.textContent = local;
    const tw = document.querySelector('#totalWaitCount'); if (tw) tw.textContent = total;
    // Info fields
    const firstWaiting = waitingData.tickets?.[0];
    const waitField = document.querySelector('#waitTimeField');
    if (waitField) {
        if (firstWaiting) {
            const mins = Math.max(0, Math.floor((Date.now() - new Date(firstWaiting.createdAt).getTime()) / 60000));
            waitField.value = `${mins} 分鐘`;
        } else { waitField.value = '—'; }
    }
    const currentCallField = document.querySelector('#currentCallField');
    const ticketIdEl = document.querySelector('#ticketId');
    const ticketInternalEl = document.querySelector('#ticketInternalId');
    if (currentCallField) { currentCallField.value = cur ? cur.number : '—'; }
    // keep visible ticketId in sync with current call's number, and store internal id in hidden field
    if (cur) {
        if (ticketIdEl) ticketIdEl.value = cur.number || '';
        if (ticketInternalEl) ticketInternalEl.value = (cur.id !== undefined && cur.id !== null) ? String(cur.id) : '';
    } else {
        if (ticketIdEl) ticketIdEl.value = '';
        if (ticketInternalEl) ticketInternalEl.value = '';
    }
    const serviceTimeField = document.querySelector('#serviceTimeField');
    if (serviceTimeField) {
        if (cur && cur.calledAt) {
            const mins = Math.max(0, Math.floor((Date.now() - new Date(cur.calledAt).getTime()) / 60000));
            serviceTimeField.value = `${mins} 分鐘`;
        } else { serviceTimeField.value = '—'; }
    }
    renderCategoryList(summary);
}
// Existing handlers (mostly unchanged)
$('#callNext').onclick = async () => {
    const serviceType = $('#serviceType').value;
    const counter = ($('#counter').value || '').trim();
    if (!counter) { alert('櫃台號未設定，請聯絡管理員設定您的櫃台號'); return; }
    const res = await apiFetch('/api/agent/callNext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType })
    });
    const data = await res.json();
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(`已叫號 ${data.ticket.number}`, 'success');
        const vis = document.querySelector('#ticketId');
        const hid = document.querySelector('#ticketInternalId');
        if (vis) vis.value = data.ticket.number || '';
        if (hid) hid.value = data.ticket.id || '';
        try { setSelectedInfo({ number: data.ticket.number, counter: data.ticket.counter, id: data.ticket.id, serviceType: data.ticket.serviceType }); } catch (e) { /* noop */ }
    }
    await refresh();
};
socket.on('queue:update', refresh);
socket.on('call:made', refresh);
// Join rooms for targeted messaging once connected
socket.on('connect', () => {
    try {
        const ctr = sessionStorage.getItem('ui_agent_counter') || '';
        if (ctr) socket.emit('join', `counter:${ctr}`);
        if (agentName) socket.emit('join', `agent:${agentName}`);
    } catch (e) { /* noop */ }
});
// 接收密傳訊息廣播：其他櫃員或系統訊息
socket.on('agent:message', (payload) => {
    try {
        const { text, from, toCounter, toAgent } = payload || {};
        if (!text) return;
        // 若為自己剛發送的訊息，避免重複顯示（已顯示「已送出訊息」）
        if (from && agentName && String(from) === String(agentName)) return;
        // If message has a target and doesn't match this client, ignore
        const myCounter = sessionStorage.getItem('ui_agent_counter') || '';
        if (toCounter && String(toCounter) !== String(myCounter)) return;
        if (toAgent && agentName && String(toAgent) !== String(agentName)) return;
        // Otherwise show
        toast(`【訊息】${from || '系統'}：${text}`, 'info');
    } catch (e) { /* noop */ }
});
refresh();
$('#markServing').onclick = async () => {
    const id = $('#ticketInternalId').value;
    if (!id) { alert('請選取一筆叫號'); return; }
    const res = await apiFetch('/api/agent/markServing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id) })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast(`已開始服務 ${data.ticket.number}`, 'success'); }
    await refresh();
};
$('#finish').onclick = async () => {
    const id = $('#ticketInternalId').value;
    if (!id) { alert('請選取一筆叫號'); return; }
    const result = prompt('處理結果（備註，可留空）') || undefined;
    const res = await apiFetch('/api/agent/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id), result })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast(`已完成 ${data.ticket.number}`, 'success'); document.querySelector('#ticketId').value = ''; document.querySelector('#ticketInternalId').value = ''; setSelectedInfo(null); }
    await refresh();
};
$('#cancel').onclick = async () => {
    const id = $('#ticketInternalId').value;
    if (!id) { alert('請選取一筆叫號'); return; }
    const reason = prompt('取消原因（備註，可留空）') || undefined;
    if (!confirm(`確定要取消此叫號嗎？`)) return;
    const res = await apiFetch('/api/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id), reason })
    });
    const data = await res.json();
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(`已取消 ${data.ticket.number}`, 'success');
        document.querySelector('#ticketId').value = '';
        document.querySelector('#ticketInternalId').value = '';
        setSelectedInfo(null);
    }
    await refresh();
};
$('#recall').onclick = async () => {
    const id = $('#ticketInternalId').value; if (!id) { alert('請選取一筆叫號'); return; }
    const res = await apiFetch('/api/agent/recall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id) })
    });
    const data = await res.json();
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(`重叫 ${data.ticket.number}`, 'success');
        const vis = document.querySelector('#ticketId');
        const hid = document.querySelector('#ticketInternalId');
        if (vis) vis.value = data.ticket.number || '';
        if (hid) hid.value = data.ticket.id || '';
        try { setSelectedInfo({ number: data.ticket.number, counter: data.ticket.counter, id: data.ticket.id, serviceType: data.ticket.serviceType }); } catch (e) { /* noop */ }
    }
    await refresh();
};
$('#transfer').onclick = async () => {
    const id = $('#ticketInternalId').value; if (!id) { alert('請選取一筆叫號'); return; }
    const toServiceType = prompt('轉至服務類型（A/B/C/D/E，不填維持）') || undefined;
    const toCounter = prompt('指定櫃台（可留空）') || undefined;
    const keepStatus = confirm('保持狀態與叫號時間？按 確定 保持 / 取消 重置為等待');
    const res = await apiFetch('/api/agent/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id), toServiceType, toCounter, keepStatus })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast(`已轉至 ${data.ticket.serviceType}`, 'success'); }
    await refresh();
};
$('#callSpecific').onclick = async () => {
    const id = $('#ticketInternalId').value; if (!id) { alert('請選取一筆叫號或輸入 ticketId'); return; }
    const counter = ($('#counter').value || '').trim();
    if (!counter) { alert('櫃台號未設定，請聯絡管理員設定您的櫃台號'); return; }
    const res = await apiFetch('/api/agent/callSpecific', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id) })
    });
    const data = await res.json();
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(`指定叫號 ${data.ticket.number}`, 'success');
        const vis = document.querySelector('#ticketId');
        const hid = document.querySelector('#ticketInternalId');
        if (vis) vis.value = data.ticket.number || '';
        if (hid) hid.value = data.ticket.id || '';
        try { setSelectedInfo({ number: data.ticket.number, counter: data.ticket.counter, id: data.ticket.id, serviceType: data.ticket.serviceType }); } catch (e) { /* noop */ }
    }
    await refresh();
};
$('#createTicket').onclick = async () => {
    const serviceType = document.querySelector('#serviceType').value;
    const res = await apiFetch('/api/agent/createTicket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast(`已建立 ${data.ticket.number}`, 'success'); }
    await refresh();
};
$('#pickup').onclick = async () => {
    const serviceType = document.querySelector('#serviceType').value;
    const res = await apiFetch('/api/agent/createTicket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast(`已補取 ${data.ticket.number}`, 'success'); }
    await refresh();
};
$('#pause').onclick = async () => {
    const id = $('#ticketInternalId').value; if (!id) { alert('請選擇一筆叫號'); return; }
    const res = await apiFetch('/api/agent/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id), keepStatus: false })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); } else { toast('已暫停，票券回到等待', 'success'); }
    await refresh();
};
$('#internalCall').onclick = async () => {
    const id = $('#ticketInternalId').value; if (!id) { alert('請選擇一筆叫號或輸入 ticketId'); return; }
    const counter = ($('#counter').value || '').trim();
    if (!counter) { alert('櫃台號未設定，請聯絡管理員設定您的櫃台號'); return; }
    const res = await apiFetch('/api/agent/callSpecific', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: Number(id), internal: true })
    });
    const data = await res.json();
    if (data.error) {
        toast(data.error, 'error');
    } else {
        toast(`內部叫號 ${data.ticket.number}`, 'success');
        const vis = document.querySelector('#ticketId');
        const hid = document.querySelector('#ticketInternalId');
        if (vis) vis.value = data.ticket.number || '';
        if (hid) hid.value = data.ticket.id || '';
        try { setSelectedInfo({ number: data.ticket.number, counter: data.ticket.counter, id: data.ticket.id, serviceType: data.ticket.serviceType }); } catch (e) { /* noop */ }
    }
    await refresh();
};
$('#history').onclick = async () => {
    const serviceType = document.querySelector('#serviceType').value;
    const res = await apiFetch(`/api/agent/history?limit=100&serviceType=${encodeURIComponent(serviceType)}`);
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || '查詢失敗'); return; }
    const rows = data.tickets || [];
    const body = document.querySelector('#historyBody');
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
    document.querySelector('#historyModal').classList.remove('hidden');
};
document.querySelector('#historyClose').onclick = () => document.querySelector('#historyModal').classList.add('hidden');
$('#message').onclick = async () => {
    const text = prompt('輸入要傳送的訊息');
    if (!text) return;
    const targetType = prompt('指定傳送對象類型：輸入 C 表示櫃台，A 表示人員，留空表示廣播');
    let toCounter = null;
    let toAgent = null;
    if (targetType && (targetType === 'C' || targetType === 'c')) {
        const ctr = prompt('輸入目標櫃台號（例如：1 或 A1）');
        if (!ctr) { alert('未輸入櫃台，取消'); return; }
        toCounter = ctr;
    } else if (targetType && (targetType === 'A' || targetType === 'a')) {
        const ag = prompt('輸入目標服務人員姓名（完全匹配）');
        if (!ag) { alert('未輸入姓名，取消'); return; }
        toAgent = ag;
    }
    const body = { text, from: agentName || 'agent' };
    if (toCounter) body.toCounter = toCounter;
    if (toAgent) body.toAgent = toAgent;
    const res = await apiFetch('/api/agent/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || '傳送失敗'); return; }
    toast('已送出訊息', 'success');
};
window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.querySelector('#callNext').click(); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); document.querySelector('#markServing').click(); }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); document.querySelector('#finish').click(); }
    if (e.key === 'x' || e.key === 'X') { e.preventDefault(); document.querySelector('#cancel').click(); }
});
const openSecondEl = document.querySelector('#openSecondScreen');
if (openSecondEl) openSecondEl.onclick = () => { window.open('/lobby/index.html', '_blank'); };
const counterEl = document.querySelector('#counter');
