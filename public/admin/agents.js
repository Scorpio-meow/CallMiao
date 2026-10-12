let USER_MODE = 'agent';
let CURRENT_AGENT = null;
const urlManager = window.URLManager;
function showMsg(text, err) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.remove('ok', 'error');
  el.classList.add(err ? 'error' : 'ok');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
async function checkLoginAndPermissions() {
  const agentName = sessionStorage.getItem('ui_agent_name');
  const agentRole = sessionStorage.getItem('ui_agent_role');
  const agentAccount = sessionStorage.getItem('ui_agent_account');
  if (!agentName || !agentAccount) {
    console.log('Admin - 未登入，跳轉到登入頁面');
    await urlManager.redirectToLogin();
    return false;
  }
  if (agentRole === 'admin') {
    USER_MODE = 'admin';
    initializeAdminInterface();
  } else {
    USER_MODE = 'agent';
    initializeAgentInterface();
  }
  return true;
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
async function loadAgents() {
  const wrap = document.getElementById('agentsWrap');
  try {
    const res = await apiFetch('/api/agents', { method: 'GET' });
    const data = await res.json();
    if (data.error) return wrap.textContent = `錯誤: ${data.error}`;
    const rows = data.agents || [];
    if (rows.length === 0) return wrap.innerHTML = '<div class="muted">無帳號</div>';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>id</th><th>account</th><th>name</th><th>counter</th><th>role</th><th>active</th><th></th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const a of rows) {
      const tr = document.createElement('tr');
      const tdId = document.createElement('td'); tdId.textContent = String(a.id || ''); tr.appendChild(tdId);
      const tdAccount = document.createElement('td'); tdAccount.textContent = a.account || ''; tr.appendChild(tdAccount);
      const tdName = document.createElement('td'); tdName.textContent = a.name || ''; tr.appendChild(tdName);
      const tdCounter = document.createElement('td'); tdCounter.textContent = a.counter || ''; tr.appendChild(tdCounter);
      const tdRole = document.createElement('td'); tdRole.textContent = a.role || ''; tr.appendChild(tdRole);
      const tdActive = document.createElement('td'); tdActive.textContent = a.active ? 'Y' : 'N'; tr.appendChild(tdActive);
      const tdActions = document.createElement('td');
      const editBtn = document.createElement('button'); editBtn.className = 'edit small'; editBtn.setAttribute('data-id', String(a.id)); editBtn.textContent = '編輯';
      const delBtn = document.createElement('button'); delBtn.className = 'del small danger'; delBtn.setAttribute('data-id', String(a.id)); delBtn.textContent = '刪除';
      tdActions.appendChild(editBtn); tdActions.appendChild(document.createTextNode(' ')); tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.innerHTML = ''; wrap.appendChild(table);
    wrap.querySelectorAll('button.edit').forEach(b => b.onclick = onEdit);
    wrap.querySelectorAll('button.del').forEach(b => b.onclick = onDelete);
  } catch (err) { wrap.innerHTML = `<div class="muted">載入失敗</div>`; console.error(err); }
}
async function loadAgentProfile() {
  try {
    const res = await apiFetch('/api/agent/profile', { method: 'GET' });
    const data = await res.json();
    if (data.error) return showMsg('載入個人資料失敗: ' + data.error, true);
    CURRENT_AGENT = data.agent;
    document.getElementById('profileName').value = data.agent.name || '';
    document.getElementById('profileRole').textContent = data.agent.role === 'admin' ? '管理員' : '一般櫃員';
    document.getElementById('profileAccount').textContent = data.agent.account || '-';
    document.getElementById('profileDisplayName').textContent = data.agent.name || '-';
    document.getElementById('profileDisplayCounter').textContent = data.agent.counter || '-';
    sessionStorage.setItem('ui_agent_name', data.agent.name || '');
    sessionStorage.setItem('ui_agent_counter', data.agent.counter || '');
    sessionStorage.setItem('ui_agent_role', data.agent.role || '');
    sessionStorage.setItem('ui_agent_account', data.agent.account || '');
  } catch (err) {
    console.error(err);
    showMsg('載入個人資料失敗', true);
  }
}
async function onEdit(e) {
  const id = e.currentTarget.getAttribute('data-id');
  const name = prompt('新姓名 (留空不變)');
  const password = prompt('新密碼 (留空不變)');
  const counter = prompt('櫃台 (留空不變)');
  const role = prompt('角色 (admin/留空為一般櫃員)');
  const body = {};
  if (name) body.name = name;
  if (password) body.password = password;
  if (counter) body.counter = counter;
  if (role !== null) body.role = role || '';
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF token', true);
    const res = await apiFetch(`/api/agents/${id}`, {
      method: 'PUT',
      headers: {
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return showMsg('修改失敗: ' + data.error, true);
    showMsg('已修改');
    loadAgents();
  } catch (err) { showMsg('修改失敗', true); }
}
async function onDelete(e) {
  const id = e.currentTarget.getAttribute('data-id');
  if (!confirm('確定刪除？')) return;
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
  document.getElementById('loginStatus').textContent = `已登入為管理員 - ${sessionStorage.getItem('ui_agent_name')}`;
  loadAgents();
}
function initializeAgentInterface() {
  document.getElementById('loginRedirect').classList.add('hidden');
  document.getElementById('mainArea').classList.remove('hidden');
  document.getElementById('adminSection').classList.add('hidden');
  document.getElementById('profileSection').classList.remove('hidden');
  document.getElementById('pageTitle').textContent = '個人資料管理';
  document.getElementById('loginStatus').textContent = `已登入為櫃員 - ${sessionStorage.getItem('ui_agent_name')}`;
  loadAgentProfile();
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
  sessionStorage.removeItem('ui_agent_name');
  sessionStorage.removeItem('ui_agent_account');
  sessionStorage.removeItem('ui_agent_counter');
  sessionStorage.removeItem('ui_agent_role');
  sessionStorage.removeItem('ui_agent_id');
  await urlManager.safeRedirect('/login/index.html');
}
document.getElementById('logout').onclick = logout;
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
  if (name !== (CURRENT_AGENT?.name || '')) body.name = name;
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
    if (body.name) {
      sessionStorage.setItem('ui_agent_name', body.name);
    }
    loadAgentProfile();
  } catch (err) { showMsg('更新失敗', true); }
};
window.addEventListener('load', async () => {
  await checkLoginAndPermissions();
});
