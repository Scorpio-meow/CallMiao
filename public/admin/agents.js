let me = null;
function displayName(agent) { return agent.name || agent.account; }
function showMsg(text, err) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.remove('ok', 'error');
  el.classList.add(err ? 'error' : 'ok');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
async function init() {
  const res = await apiFetch('/api/agent/profile', { method: 'GET' });
  if (res.status === 401) {
    location.href = `/login/index.html?redirect=${encodeURIComponent(location.pathname)}`;
    return;
  }
  if (!res.ok) return showMsg('載入個人資料失敗', true);
  me = (await res.json()).agent;
  if (me.role === 'admin') initializeAdminInterface();
  else initializeAgentInterface();
}
async function apiFetch(url, opts = {}) {
  opts = Object.assign({
    headers: {},
    credentials: 'include'
  }, opts);
  if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
  return fetch(url, opts);
}
async function getCsrfToken() {
  try {
    const res = await apiFetch('/api/csrf', { method: 'GET' });
    if (!res.ok) {
      console.error('Failed to fetch CSRF token, status:', res.status);
      return null;
    }
    const data = await res.json();
    return data.csrfToken;
  } catch (err) {
    console.error('Failed to get CSRF token:', err);
    return null;
  }
}
let AGENTS = [];
let EDITING_AGENT = null;
function isSelf(agent) {
  return agent.id === me.id;
}
function makeBadge(text, cls) {
  const span = document.createElement('span');
  span.className = `badge ${cls}`;
  span.textContent = text;
  return span;
}
function renderAgents() {
  const wrap = document.getElementById('agentsWrap');
  const keyword = document.getElementById('agentFilter').value.trim().toLowerCase();
  const rows = AGENTS.filter(a => !keyword || [a.account, a.name, a.counter].some(v => (v || '').toLowerCase().includes(keyword)));
  if (rows.length === 0) return wrap.innerHTML = `<div class="muted">${AGENTS.length === 0 ? '無帳號' : '沒有符合的帳號'}</div>`;
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>帳號</th><th>姓名</th><th>櫃台</th><th>角色</th><th>狀態</th><th></th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const a of rows) {
    const tr = document.createElement('tr');
    if (!a.active) tr.className = 'inactive';
    tr.title = '點兩下編輯';
    tr.ondblclick = () => openEditDialog(a);
    const tdAccount = document.createElement('td'); tdAccount.textContent = a.account || '';
    if (isSelf(a)) tdAccount.appendChild(makeBadge('你', 'self'));
    tr.appendChild(tdAccount);
    const tdName = document.createElement('td'); tdName.textContent = a.name || '-'; tr.appendChild(tdName);
    const tdCounter = document.createElement('td'); tdCounter.textContent = a.counter || '-'; tr.appendChild(tdCounter);
    const tdRole = document.createElement('td');
    tdRole.appendChild(a.role === 'admin' ? makeBadge('管理員', 'admin') : makeBadge('一般櫃員', 'agent'));
    tr.appendChild(tdRole);
    const tdActive = document.createElement('td');
    tdActive.appendChild(a.active ? makeBadge('啟用', 'on') : makeBadge('停用', 'off'));
    tr.appendChild(tdActive);
    const tdActions = document.createElement('td');
    tdActions.className = 'row-actions';
    const editBtn = document.createElement('button'); editBtn.className = 'small'; editBtn.textContent = '編輯';
    editBtn.onclick = () => openEditDialog(a);
    tdActions.appendChild(editBtn);
    if (!isSelf(a)) {
      const delBtn = document.createElement('button'); delBtn.className = 'small danger'; delBtn.textContent = '刪除';
      delBtn.onclick = () => onDelete(a);
      tdActions.appendChild(delBtn);
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.innerHTML = ''; wrap.appendChild(table);
}
async function loadAgents() {
  const wrap = document.getElementById('agentsWrap');
  try {
    const res = await apiFetch('/api/agents', { method: 'GET' });
    const data = await res.json();
    if (data.error) return wrap.textContent = `錯誤: ${data.error}`;
    AGENTS = data.agents || [];
    renderAgents();
  } catch (err) { wrap.innerHTML = `<div class="muted">載入失敗</div>`; console.error(err); }
}
function renderProfile() {
  document.getElementById('profileName').value = me.name || '';
  document.getElementById('profileRole').textContent = me.role === 'admin' ? '管理員' : '一般櫃員';
  document.getElementById('profileAccount').textContent = me.account || '-';
  document.getElementById('profileDisplayName').textContent = me.name || '-';
  document.getElementById('profileDisplayCounter').textContent = me.counter || '-';
  document.getElementById('loginStatus').textContent = `已登入為${me.role === 'admin' ? '管理員' : '櫃員'} - ${displayName(me)}`;
}
function openEditDialog(agent) {
  EDITING_AGENT = agent;
  const self = isSelf(agent);
  document.getElementById('editAccount').textContent = agent.account || '';
  document.getElementById('editName').value = agent.name || '';
  document.getElementById('editCounter').value = agent.counter || '';
  document.getElementById('editRole').value = agent.role === 'admin' ? 'admin' : '';
  document.getElementById('editActive').checked = Boolean(agent.active);
  document.getElementById('editPassword').value = '';
  document.getElementById('editRole').disabled = self;
  document.getElementById('editActive').disabled = self;
  document.getElementById('editSelfNote').classList.toggle('hidden', !self);
  document.getElementById('editDialog').showModal();
  document.getElementById('editName').focus();
}
function closeEditDialog() {
  document.getElementById('editPassword').value = '';
  document.getElementById('editDialog').close();
  EDITING_AGENT = null;
}
async function saveEdit() {
  const agent = EDITING_AGENT;
  if (!agent) return;
  const name = document.getElementById('editName').value.trim();
  const counter = document.getElementById('editCounter').value.trim();
  const role = document.getElementById('editRole').value;
  const active = document.getElementById('editActive').checked ? 1 : 0;
  const password = document.getElementById('editPassword').value;
  const body = {};
  if (name !== (agent.name || '')) body.name = name;
  if (counter !== (agent.counter || '')) body.counter = counter;
  if (role !== (agent.role === 'admin' ? 'admin' : '')) body.role = role;
  if (active !== (agent.active ? 1 : 0)) body.active = active;
  if (password) body.password = password;
  if (Object.keys(body).length === 0) return closeEditDialog();
  if (body.active === 0 && !confirm(`停用「${agent.account}」會立即登出該帳號，確定？`)) return;
  const saveBtn = document.getElementById('editSave');
  saveBtn.disabled = true;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF token', true);
    const res = await apiFetch(`/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: {
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return showMsg('修改失敗: ' + data.error, true);
    showMsg(`已更新「${agent.account}」`);
    closeEditDialog();
    loadAgents();
  } catch (err) { showMsg('修改失敗', true); } finally { saveBtn.disabled = false; }
}
async function onDelete(agent) {
  const id = agent.id;
  if (!confirm(`確定刪除帳號「${agent.account}」？此動作無法復原。`)) return;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF token', true);
    const res = await apiFetch(`/api/agents/${id}`, {
      method: 'DELETE',
      headers: {
        'x-csrf-token': csrfToken
      }
    });
    const data = await res.json();
    if (data.error) return showMsg('刪除失敗: ' + data.error, true);
    showMsg('已刪除');
    loadAgents();
  } catch (err) { showMsg('刪除失敗', true); }
}
function initializeAdminInterface() {
  document.getElementById('loginRedirect').classList.add('hidden');
  document.getElementById('mainArea').classList.remove('hidden');
  document.getElementById('adminSection').classList.remove('hidden');
  document.getElementById('profileSection').classList.add('hidden');
  document.getElementById('pageTitle').textContent = '帳號管理（管理員）';
  renderProfile();
  loadAgents();
}
function initializeAgentInterface() {
  document.getElementById('loginRedirect').classList.add('hidden');
  document.getElementById('mainArea').classList.remove('hidden');
  document.getElementById('adminSection').classList.add('hidden');
  document.getElementById('profileSection').classList.remove('hidden');
  document.getElementById('pageTitle').textContent = '個人資料管理';
  renderProfile();
}
async function logout() {
  try {
    const csrfToken = await getCsrfToken();
    await apiFetch('/api/logout', {
      method: 'POST',
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : {}
    });
  } catch (err) {
    console.warn('Logout API error:', err);
  }
  location.href = '/login/index.html';
}
document.getElementById('logout').onclick = logout;
document.getElementById('agentFilter').oninput = renderAgents;
document.getElementById('editForm').onsubmit = (e) => { e.preventDefault(); saveEdit(); };
document.getElementById('editCancel').onclick = closeEditDialog;
document.getElementById('editDialog').oncancel = () => { EDITING_AGENT = null; document.getElementById('editPassword').value = ''; };
document.getElementById('createBtn').onclick = async () => {
  const account = document.getElementById('newAccount').value.trim();
  const name = document.getElementById('newName').value.trim();
  const password = document.getElementById('newPassword').value;
  const counter = document.getElementById('newCounter').value.trim();
  const role = document.getElementById('newRole').value;
  if (!account || !password) return showMsg('account & password required', true);
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF token', true);
    const res = await apiFetch('/api/agents', {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ account, name, password, counter, role })
    });
    const data = await res.json();
    if (data.error) return showMsg('建立失敗: ' + data.error, true);
    showMsg('建立成功');
    document.getElementById('newAccount').value = '';
    document.getElementById('newName').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newCounter').value = '';
    document.getElementById('newRole').value = '';
    loadAgents();
  } catch (err) { showMsg('建立失敗', true); }
};
document.getElementById('updateProfileBtn').onclick = async () => {
  const name = document.getElementById('profileName').value.trim();
  const password = document.getElementById('profilePassword').value;
  const currentPassword = document.getElementById('profileCurrentPassword').value;
  const body = {};
  if (name !== (me.name || '')) body.name = name;
  if (password) {
    if (!currentPassword) return showMsg('變更密碼需輸入目前密碼', true);
    body.password = password;
    body.currentPassword = currentPassword;
  }
  if (Object.keys(body).length === 0) return showMsg('沒有變更', true);
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF token', true);
    const res = await apiFetch('/api/agent/profile', {
      method: 'PUT',
      headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return showMsg('更新失敗: ' + data.error, true);
    showMsg('更新成功');
    document.getElementById('profilePassword').value = '';
    document.getElementById('profileCurrentPassword').value = '';
    me = data.agent;
    renderProfile();
  } catch (err) { showMsg('更新失敗', true); }
};
window.addEventListener('load', init);