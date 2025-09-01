// Agent UI logic externalized. Uses cookie-based JWT auth; no PIN stored client-side.
// Minimal DOM helpers
const $ = (s) => document.querySelector(s);
function escapeHTML(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

// Socket.IO client
const socket = io();

// State kept only for display (non-sensitive)
let agentName = sessionStorage.getItem('agent_name') || '';
let savedCounter = sessionStorage.getItem('agent_counter') || '';

// Status mapping
const STATUS_LABEL = {
  waiting: '等待',
  called: '已叫號',
  serving: '服務中',
  finished: '已完成',
  canceled: '已取消',
  cancelled: '已取消',
};
const statusLabel = (s) => STATUS_LABEL[s] || (s || '-');

function updateAgentNameUI() {
  const el = $('#agentNameDisplay');
  if (el) el.textContent = agentName || '—';
}

function maskPhone(p) {
  if (!p) return '';
  return String(p).replace(/(\d{3})\d{4}(\d{3,4})/, '$1****$2');
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  const host = $('#toaster');
  if (host) host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    el.remove();
  }, 3000);
}

async function apiFetch(url, opts = {}) {
  const merged = Object.assign({ headers: {} }, opts);
  // Cookie-based auth; include credentials for same-origin just in case
  merged.credentials = 'same-origin';
  const res = await fetch(url, merged);
  if (res.status === 401) {
    // Not authenticated; redirect to central login preserving return
    const redirect = encodeURIComponent('/agent/index.html');
    window.location.href = `/login/index.html?redirect=${redirect}`;
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }
  return res;
}

function setSelectedInfo(ticket) {
  const el = $('#selectedInfo');
  if (!el) return;
  if (!ticket) {
    el.textContent = '';
    return;
  }
  const phoneMasked = maskPhone(ticket.phone);
  el.innerHTML = `選擇：<strong>${escapeHTML(ticket.number)}</strong>，櫃台 ${escapeHTML(ticket.counter || '-') }，電話 ${escapeHTML(phoneMasked || '-')}`;
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
  const clk = $('#clock');
  if (clk) clk.textContent = str;
}
setInterval(updateClock, 1000);
updateClock();

function renderCategoryList(summary) {
  const SERVICE_NAMES = {
    A: '一般保險服務',
    B: '理賠送件服務',
    C: '保單借據服務',
    D: '繳費服務',
    E: '人生設計所保險諮詢',
  };
  const order = ['A', 'B', 'C', 'D', 'E'];
  const map = (summary || []).reduce((acc, s) => {
    acc[s.serviceType] = s.waiting || 0;
    return acc;
  }, {});
  const categoriesHtml = `${order
    .map((code) => {
      const count = map[code] || 0;
      return `<div class="category-row" data-service="${code}" style="cursor:pointer"><div class="count">${count}</div><div class="label">${SERVICE_NAMES[code] || code}</div></div>`;
    })
    .join('')}`;
  const wrap = $('#categoryList');
  if (wrap) {
    wrap.innerHTML = categoriesHtml;
    const rows = wrap.querySelectorAll('.category-row');
    rows.forEach((el) => {
      el.onclick = () => {
        const svc = el.getAttribute('data-service');
        const svcInput = $('#serviceType');
        if (svcInput) svcInput.value = svc;
        rows.forEach((r) => r.classList.remove('active'));
        el.classList.add('active');
        refresh();
      };
    });
    const svc0 = $('#serviceType')?.value;
    if (svc0) {
      rows.forEach((r) => r.classList.remove('active'));
      const initial = wrap.querySelector(`.category-row[data-service="${svc0}"]`);
      if (initial) initial.classList.add('active');
    }
  }
}

async function refresh() {
  const res = await apiFetch('/api/overview');
  const data = await res.json().catch(() => ({}));
  const svcEl = $('#serviceType');
  const serviceType = (svcEl && svcEl.value) ? svcEl.value : 'A';

  const waitingRes = await apiFetch(`/api/tickets/waiting?serviceType=${serviceType}`);
  const waitingData = await waitingRes.json().catch(() => ({ tickets: [] }));
  const waitingTbody = $('#waiting');
  if (waitingTbody) {
    waitingTbody.innerHTML =
      waitingData.tickets
        .map(
          (t) =>
      `<tr class="clickable" data-waiting-id="${t.id}" data-id="${t.id}" data-number="${escapeHTML(t.number)}">
        <td>${escapeHTML(t.number)}</td>
                <td>${new Date(t.createdAt).toLocaleTimeString()}</td>
        <td>${escapeHTML(maskPhone(t.phone))}</td>
            </tr>`
        )
        .join('') || '<tr><td colspan="3">無</td></tr>';
  }

  const currentTbody = $('#current');
  if (currentTbody) {
    currentTbody.innerHTML =
      (data.currentCalls || [])
        .map(
          (c) =>
      `<tr class="clickable" data-id="${c.id}" data-number="${escapeHTML(c.number)}">
        <td><span class="badge">${escapeHTML(c.serviceType)}</span> ${escapeHTML(c.number)}</td>
        <td>${escapeHTML(c.counter || '-')}</td>
                <td>${new Date(c.calledAt).toLocaleTimeString()}</td>
                <td><button class="btn btn-light" data-pick="${c.id}">選擇</button></td>
            </tr>`
        )
        .join('') || '<tr><td colspan="4">無</td></tr>';
  }

  document.querySelectorAll('[data-id]').forEach((tr) => {
    tr.onclick = () => {
      const id = tr.getAttribute('data-id');
      const num = tr.getAttribute('data-number') || '';
      const vis = $('#ticketId');
      if (vis) vis.value = num || '';
      const hid = $('#ticketInternalId');
      if (hid) hid.value = id || '';
    };
  });
  document.querySelectorAll('button[data-pick]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-pick');
      const row = document.querySelector(`[data-id="${id}"]`);
      const num = row ? row.getAttribute('data-number') || '' : '';
      const vis = $('#ticketId');
      if (vis) vis.value = num || '';
      const hid = $('#ticketInternalId');
      if (hid) hid.value = id || '';
    };
  });

  const hidVal = $('#ticketInternalId')?.value;
  const selId = hidVal ? Number(hidVal) : null;
  const visNum = $('#ticketId')?.value;
  let cur = null;
  if (selId) {
    cur = (data.currentCalls || []).find((x) => x.id === selId);
  }
  if (!cur && visNum) {
    cur = (data.currentCalls || []).find((x) => String(x.number) === String(visNum));
  }
  setSelectedInfo(cur || null);

  const summary = data.summary || [];
  const sumMap = summary.reduce((acc, s) => {
    acc[s.serviceType] = s.waiting || 0;
    return acc;
  }, {});
  const local = sumMap[serviceType] || 0;
  const total = summary.reduce((n, s) => n + (s.waiting || 0), 0);
  const lw = $('#localWaitCount');
  if (lw) lw.textContent = local;
  const tw = $('#totalWaitCount');
  if (tw) tw.textContent = total;

  const firstWaiting = waitingData.tickets?.[0];
  const waitField = $('#waitTimeField');
  if (waitField) {
    if (firstWaiting) {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(firstWaiting.createdAt).getTime()) / 60000));
      waitField.value = `${mins} 分鐘`;
    } else {
      waitField.value = '—';
    }
  }
  const currentCallField = $('#currentCallField');
  const ticketIdEl = $('#ticketId');
  const ticketInternalEl = $('#ticketInternalId');
  if (currentCallField) {
    currentCallField.value = cur ? cur.number : '—';
  }
  if (cur) {
    if (ticketIdEl) ticketIdEl.value = cur.number || '';
    if (ticketInternalEl) ticketInternalEl.value = cur.id != null ? String(cur.id) : '';
  } else {
    if (ticketIdEl) ticketIdEl.value = '';
    if (ticketInternalEl) ticketInternalEl.value = '';
  }
  const serviceTimeField = $('#serviceTimeField');
  if (serviceTimeField) {
    if (cur && cur.calledAt) {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(cur.calledAt).getTime()) / 60000));
      serviceTimeField.value = `${mins} 分鐘`;
    } else {
      serviceTimeField.value = '—';
    }
  }

  renderCategoryList(summary);
}

async function initAuth() {
  // on load, check auth
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) throw new Error('unauth');
    const me = await res.json();
    // enforce role = agent (or admin allowed to act as agent if backend permits)
    if (!me || !me.user || (me.user.role !== 'agent' && me.user.role !== 'admin')) {
      const redirect = encodeURIComponent('/agent/index.html');
      window.location.href = `/login/index.html?redirect=${redirect}`;
      return false;
    }
    agentName = me.user.name || agentName || '';
    sessionStorage.setItem('agent_name', agentName);
  (function(el){ if (el) el.textContent = '已登入'; })($('#authStatus'));
    updateAgentNameUI();
    return true;
  } catch (e) {
    const redirect = encodeURIComponent('/agent/index.html');
    window.location.href = `/login/index.html?redirect=${redirect}`;
    return false;
  }
}

function bindHandlers() {
  const c = $('#counter');
  if (c && !c.value && savedCounter) c.value = savedCounter;
  $('#loginBtn')?.addEventListener('click', () => {
    const nm = $('#loginName').value.trim();
    const ctr = $('#loginCounter').value.trim();
    if (!nm) {
      alert('請輸入姓名');
      return;
    }
    agentName = nm;
    savedCounter = ctr;
    if (agentName) sessionStorage.setItem('agent_name', agentName);
    if (savedCounter) sessionStorage.setItem('agent_counter', savedCounter);
    if (savedCounter && c) c.value = savedCounter;
  (function(el){ if (el) el.textContent = '已登入'; })($('#authStatus'));
    updateAgentNameUI();
    $('#authOverlay').classList.add('hidden');
    refresh();
  });
  $('#logoutBtn')?.addEventListener('click', async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    sessionStorage.removeItem('agent_name');
    sessionStorage.removeItem('agent_counter');
  (function(el){ if (el) el.textContent = ''; })($('#authStatus'));
    updateAgentNameUI();
    window.location.href = '/login/index.html';
  });

  $('#callNext')?.addEventListener('click', async () => {
    const serviceType = $('#serviceType').value;
    const counter = $('#counter').value || undefined;
    const res = await apiFetch('/api/agent/callNext', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceType, counter }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`已叫號 ${data.ticket.number}`, 'success');
      $('#ticketInternalId').value = data.ticket.id;
    }
    await refresh();
  });

  $('#markServing')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    // retrieve full ticket to verify phone last 4 digits
    const ticketRes = await apiFetch(`/api/agent/ticket/${Number(id)}`);
    if (!ticketRes.ok) {
      const j = await ticketRes.json().catch(() => ({ error: '查詢失敗' }));
      alert((j && j.error) || '取得票券失敗');
      return;
    }
    const ticketJson = await ticketRes.json();
    const ticket = ticketJson.ticket;
    const phoneDigits = ticket && ticket.phone ? String(ticket.phone).replace(/\D/g, '') : '';
    if (!phoneDigits) {
      alert('此票券未記錄電話，無法透過電話後四碼驗證開始服務');
      return;
    }
    const last4 = phoneDigits.slice(-4);
    const v = prompt('請輸入客戶電話後四碼以開始服務');
    if (v === null) return;
    if (String(v).trim() !== String(last4)) {
      alert('電話後四碼驗證失敗');
      return;
    }
    const res = await apiFetch('/api/agent/markServing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id) }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`已開始服務 ${data.ticket.number}`, 'success');
    }
    await refresh();
  });

  $('#finish')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    const result = prompt('處理結果（備註，可留空）') || undefined;
    const res = await apiFetch('/api/agent/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), result }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`已完成 ${data.ticket.number}`, 'success');
      $('#ticketId').value = '';
      $('#ticketInternalId').value = '';
      setSelectedInfo(null);
    }
    await refresh();
  });

  $('#recall')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    const res = await apiFetch('/api/agent/recall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id) }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`重叫 ${data.ticket.number}`, 'success');
    }
    await refresh();
  });

  $('#cancel')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    const reason = prompt('取消原因（可留空）') || undefined;
    const res = await apiFetch('/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), reason }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast('已取消', 'success');
    }
    await refresh();
  });

  $('#transfer')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    const toServiceType = prompt('轉至服務類型（A/B/C/D/E，不填維持）') || undefined;
    const toCounter = prompt('指定櫃台（可留空）') || undefined;
    const keepStatus = confirm('保持狀態與叫號時間？按 確定 保持 / 取消 重置為等待');
    const res = await apiFetch('/api/agent/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), toServiceType, toCounter, keepStatus }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`已轉至 ${data.ticket.serviceType}`, 'success');
    }
    await refresh();
  });

  $('#callSpecific')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號或輸入 ticketId');
      return;
    }
    const counter = $('#counter').value || undefined;
    const res = await apiFetch('/api/agent/callSpecific', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), counter }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`指定叫號 ${data.ticket.number}`, 'success');
    }
    await refresh();
  });

  $('#createTicket')?.addEventListener('click', () => {
    showPhoneModal(async (phone) => {
      const serviceType = $('#serviceType').value;
      const res = await apiFetch('/api/agent/createTicket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType, phone }),
      });
      const data = await res.json();
      if (data.error) {
        toast(data.error, 'error');
      } else {
        toast(`已建立 ${data.ticket.number}`, 'success');
      }
      await refresh();
    });
  });

  $('#pickup')?.addEventListener('click', () => {
    showPhoneModal(async (phone) => {
      const serviceType = $('#serviceType').value;
      const res = await apiFetch('/api/agent/createTicket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType, phone }),
      });
      const data = await res.json();
      if (data.error) {
        toast(data.error, 'error');
      } else {
        toast(`已補取 ${data.ticket.number}`, 'success');
      }
      await refresh();
    });
  });

  $('#pause')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號');
      return;
    }
    const res = await apiFetch('/api/agent/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), keepStatus: false }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast('已暫停，票券回到等待', 'success');
    }
    await refresh();
  });

  $('#internalCall')?.addEventListener('click', async () => {
    const id = $('#ticketInternalId').value;
    if (!id) {
      alert('請選擇一筆叫號或輸入 ticketId');
      return;
    }
    const counter = $('#counter').value || undefined;
    const res = await apiFetch('/api/agent/callSpecific', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: Number(id), counter, internal: true }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast(`內部叫號 ${data.ticket.number}`, 'success');
    }
    await refresh();
  });

  $('#history')?.addEventListener('click', async () => {
    const serviceType = $('#serviceType').value;
    const res = await apiFetch(`/api/agent/history?limit=100&serviceType=${encodeURIComponent(serviceType)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      alert(data.error || '查詢失敗');
      return;
    }
    const rows = data.tickets || [];
    const html =
      rows.length
        ?
          `<table class="table"><thead><tr><th>號碼</th><th>狀態</th><th>櫃台</th><th>完成時間</th></tr></thead><tbody>` +
          rows
            .map(
              (t) =>
                `<tr><td>${t.number}</td><td>${statusLabel(t.status)}</td><td>${t.counter || '-'}</td><td>${t.finishedAt ? new Date(t.finishedAt).toLocaleString() : '-'}</td></tr>`
            )
            .join('') +
          `</tbody></table>`
        : '<div class="muted">無資料</div>';
    $('#historyBody').innerHTML = html;
    $('#historyModal').classList.remove('hidden');
  });
  $('#historyClose')?.addEventListener('click', () => $('#historyModal').classList.add('hidden'));

  $('#message')?.addEventListener('click', async () => {
    const text = prompt('輸入要廣播的訊息');
    if (!text) return;
    const res = await apiFetch('/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from: agentName || 'agent' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      alert(data.error || '傳送失敗');
      return;
    }
    toast('已送出訊息', 'success');
  });

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      $('#callNext').click();
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      $('#markServing').click();
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      $('#finish').click();
    }
  });

  // open second screen
  $('#openSecondScreen')?.addEventListener('click', () => window.open('/lobby/index.html', '_blank'));

  // persist counter
  const counterEl = $('#counter');
  if (counterEl) {
    counterEl.addEventListener('change', () => {
      const v = counterEl.value.trim();
      sessionStorage.setItem('agent_counter', v);
    });
  }
}

socket.on('queue:update', refresh);
socket.on('call:made', refresh);
socket.on('agent:message', (payload) => {
  try {
    const { text, from } = payload || {};
    if (!text) return;
    if (from && agentName && String(from) === String(agentName)) return;
    toast(`【訊息】${from || '系統'}：${text}`, 'info');
  } catch (e) {}
});

(async function bootstrap() {
  if (await initAuth()) {
    bindHandlers();
    await refresh();
  }
})();
