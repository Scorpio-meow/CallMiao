const $ = (id) => document.getElementById(id);
const ERROR_TEXT = {
  'account exists': '帳號已存在',
  'account and password required': '請輸入帳號與密碼',
  'name already in use': '姓名已被其他帳號使用',
  'cannot demote or deactivate your own account': '無法變更自己的角色或停用自己',
  'cannot delete your own account': '無法刪除自己的帳號',
  'current password required': '目前密碼不正確',
  'not found': '找不到這個帳號'
};
let me = null;
let AGENTS = [];
let EDITING_AGENT = null;
function displayName(agent) { return agent.name || agent.account; }
function errorText(error) { return ERROR_TEXT[error] || error; }
function showMsg(text, err) { toast(text, err ? 'error' : 'success', 4000); }
function confirmAction({ title, description, confirmText }) {
  const dialog = $('confirmDialog');
  $('confirmTitle').textContent = title;
  $('confirmDesc').textContent = description;
  $('confirmOk').textContent = confirmText;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}
async function apiFetch(url, opts = {}) {
  opts = Object.assign({ headers: {}, credentials: 'include' }, opts);
  if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
  const res = await fetch(url, opts);
  if (res.status === 401) location.href = `/login/index.html?redirect=${encodeURIComponent(location.pathname)}`;
  return res;
}
async function getCsrfToken() {
  try {
    const res = await apiFetch('/api/csrf', { method: 'GET' });
    if (!res.ok) return null;
    return (await res.json()).csrfToken;
  } catch (err) {
    console.error('Failed to get CSRF token:', err);
    return null;
  }
}
function isSelf(agent) { return agent.id === me.id; }
function makeBadge(text, variant) {
  const span = document.createElement('span');
  span.className = variant ? `badge badge-${variant}` : 'badge';
  span.textContent = text;
  return span;
}
function makeButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.onclick = onClick;
  return btn;
}
function renderState(kind, title, actionText, onAction) {
  const wrap = $('agentsWrap');
  wrap.textContent = '';
  const box = document.createElement('div');
  box.className = 'empty-state';
  const strong = document.createElement('strong');
  strong.textContent = title;
  box.appendChild(strong);
  if (actionText) box.appendChild(makeButton(actionText, kind === 'empty' ? 'btn btn-primary' : 'btn', onAction));
  wrap.appendChild(box);
}
function renderAgents() {
  const wrap = $('agentsWrap');
  const rawKeyword = $('agentFilter').value.trim();
  const keyword = rawKeyword.toLowerCase();
  const rows = AGENTS.filter(a => !keyword || [a.account, a.name, a.counter].some(v => (v || '').toLowerCase().includes(keyword)));
  $('agentCount').textContent = keyword ? `${rows.length} / ${AGENTS.length} 個帳號` : `共 ${AGENTS.length} 個帳號`;
  if (AGENTS.length === 0) return renderState('empty', '還沒有任何帳號', '新增帳號', openCreateDialog);
  if (rows.length === 0) {
    return renderState('filter', `沒有符合「${rawKeyword}」的帳號`, '清除搜尋', () => { $('agentFilter').value = ''; renderAgents(); });
  }
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  [['帳號', ''], ['姓名', ''], ['櫃台', ''], ['角色', ''], ['狀態', ''], ['操作', 'actions']].forEach(([text, cls]) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (cls) th.className = cls;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const a of rows) {
    const tr = document.createElement('tr');
    if (!a.active) tr.className = 'inactive';
    tr.ondblclick = () => openEditDialog(a);
    const tdAccount = document.createElement('td');
    const accountCell = document.createElement('span');
    accountCell.className = 'account-cell';
    accountCell.append(a.account || '');
    if (isSelf(a)) accountCell.appendChild(makeBadge('你', 'brand'));
    tdAccount.appendChild(accountCell);
    tr.appendChild(tdAccount);
    const tdName = document.createElement('td'); tdName.textContent = a.name || '-'; tr.appendChild(tdName);
    const tdCounter = document.createElement('td'); tdCounter.textContent = a.counter || '-'; tr.appendChild(tdCounter);
    const tdRole = document.createElement('td');
    tdRole.appendChild(a.role === 'admin' ? makeBadge('管理員', 'info') : makeBadge('一般櫃員'));
    tr.appendChild(tdRole);
    const tdActive = document.createElement('td');
    tdActive.appendChild(a.active ? makeBadge('啟用', 'success') : makeBadge('停用'));
    tr.appendChild(tdActive);
    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    tdActions.appendChild(makeButton('編輯', 'btn btn-ghost btn-sm', () => openEditDialog(a)));
    if (!isSelf(a)) tdActions.appendChild(makeButton('刪除', 'btn btn-ghost btn-sm btn-text-danger', () => onDelete(a)));
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.textContent = '';
  wrap.appendChild(table);
}
async function loadAgents() {
  if (AGENTS.length === 0) renderState('loading', '載入中…');
  try {
    const res = await apiFetch('/api/agents', { method: 'GET' });
    const data = await res.json();
    if (data.error) return renderState('error', `無法載入帳號：${errorText(data.error)}`, '重試', loadAgents);
    AGENTS = data.agents || [];
    renderAgents();
  } catch (err) {
    console.error(err);
    renderState('error', '無法載入帳號，請檢查網路連線', '重試', loadAgents);
  }
}
function roleText(agent) { return agent.role === 'admin' ? '管理員' : '一般櫃員'; }
function renderProfile() {
  $('profileName').value = me.name || '';
  $('profileRole').textContent = roleText(me);
  $('profileAccount').textContent = me.account || '-';
  $('profileDisplayName').textContent = me.name || '-';
  $('profileDisplayCounter').textContent = me.counter || '-';
  $('loginStatus').textContent = displayName(me);
  const badge = $('roleBadge');
  badge.textContent = roleText(me);
  badge.className = me.role === 'admin' ? 'badge badge-info' : 'badge';
}
function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = input.value === value; });
}
function radioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : '';
}
function openCreateDialog() {
  $('createForm').reset();
  $('createDialog').showModal();
  $('newAccount').focus();
}
function closeCreateDialog() {
  $('createForm').reset();
  $('createDialog').close();
}
function openEditDialog(agent) {
  EDITING_AGENT = agent;
  const self = isSelf(agent);
  $('editAccount').textContent = agent.account || '';
  $('editName').value = agent.name || '';
  $('editCounter').value = agent.counter || '';
  setRadio('editRole', agent.role === 'admin' ? 'admin' : '');
  $('editActive').checked = Boolean(agent.active);
  $('editPassword').value = '';
  document.querySelectorAll('input[name="editRole"]').forEach(input => { input.disabled = self; });
  $('editActive').disabled = self;
  $('editSelfNote').classList.toggle('hidden', !self);
  $('editDialog').showModal();
  $('editName').focus();
}
function closeEditDialog() {
  $('editPassword').value = '';
  $('editDialog').close();
  EDITING_AGENT = null;
}
async function saveEdit() {
  const agent = EDITING_AGENT;
  if (!agent) return;
  const name = $('editName').value.trim();
  const counter = $('editCounter').value.trim();
  const role = radioValue('editRole');
  const active = $('editActive').checked ? 1 : 0;
  const password = $('editPassword').value;
  const body = {};
  if (name !== (agent.name || '')) body.name = name;
  if (counter !== (agent.counter || '')) body.counter = counter;
  if (role !== (agent.role === 'admin' ? 'admin' : '')) body.role = role;
  if (active !== (agent.active ? 1 : 0)) body.active = active;
  if (password) body.password = password;
  if (Object.keys(body).length === 0) return closeEditDialog();
  if (body.active === 0) {
    const ok = await confirmAction({
      title: `停用帳號「${agent.account}」`,
      description: '停用後，這個帳號會立即被登出，也無法再登入，直到重新啟用。',
      confirmText: '停用帳號'
    });
    if (!ok) return;
  }
  const saveBtn = $('editSave');
  saveBtn.disabled = true;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF Token，請重新整理頁面', true);
    const res = await apiFetch(`/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return showMsg(`儲存失敗：${errorText(data.error)}`, true);
    showMsg(`已更新「${agent.account}」`);
    closeEditDialog();
    loadAgents();
  } catch (err) {
    showMsg('儲存失敗，請稍後再試', true);
  } finally {
    saveBtn.disabled = false;
  }
}
async function onDelete(agent) {
  const ok = await confirmAction({
    title: `刪除帳號「${agent.account}」`,
    description: '刪除後無法復原，這個帳號將無法再登入。若只是暫時不用，建議改為停用。',
    confirmText: '刪除帳號'
  });
  if (!ok) return;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF Token，請重新整理頁面', true);
    const res = await apiFetch(`/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken }
    });
    const data = await res.json();
    if (data.error) return showMsg(`刪除失敗：${errorText(data.error)}`, true);
    showMsg(`已刪除「${agent.account}」`);
    loadAgents();
  } catch (err) {
    showMsg('刪除失敗，請稍後再試', true);
  }
}
async function createAgent() {
  const account = $('newAccount').value.trim();
  const name = $('newName').value.trim();
  const password = $('newPassword').value;
  const counter = $('newCounter').value.trim();
  const role = radioValue('newRole');
  if (!account || !password) return showMsg('請輸入帳號與密碼', true);
  const btn = $('createBtn');
  btn.disabled = true;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF Token，請重新整理頁面', true);
    const res = await apiFetch('/api/agents', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify({ account, name, password, counter, role })
    });
    const data = await res.json();
    if (data.error) return showMsg(`建立失敗：${errorText(data.error)}`, true);
    showMsg(`已建立「${account}」`);
    closeCreateDialog();
    loadAgents();
  } catch (err) {
    showMsg('建立失敗，請稍後再試', true);
  } finally {
    btn.disabled = false;
  }
}
async function updateProfile() {
  const name = $('profileName').value.trim();
  const password = $('profilePassword').value;
  const currentPassword = $('profileCurrentPassword').value;
  const body = {};
  if (name !== (me.name || '')) body.name = name;
  if (password) {
    if (!currentPassword) return showMsg('變更密碼需輸入目前密碼', true);
    body.password = password;
    body.currentPassword = currentPassword;
  }
  if (Object.keys(body).length === 0) return showMsg('沒有需要儲存的變更', true);
  const btn = $('updateProfileBtn');
  btn.disabled = true;
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return showMsg('無法取得 CSRF Token，請重新整理頁面', true);
    const res = await apiFetch('/api/agent/profile', {
      method: 'PUT',
      headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return showMsg(`儲存失敗：${errorText(data.error)}`, true);
    showMsg('已儲存個人資料');
    $('profilePassword').value = '';
    $('profileCurrentPassword').value = '';
    me = data.agent;
    renderProfile();
  } catch (err) {
    showMsg('儲存失敗，請稍後再試', true);
  } finally {
    btn.disabled = false;
  }
}
function showMain(isAdmin) {
  $('loginRedirect').classList.add('hidden');
  $('mainArea').classList.remove('hidden');
  $('adminSection').classList.toggle('hidden', !isAdmin);
  $('openCreate').classList.toggle('hidden', !isAdmin);
  $('profileSection').classList.toggle('hidden', isAdmin);
  $('pageTitle').textContent = isAdmin ? '帳號管理' : '個人資料';
  document.title = `${$('pageTitle').textContent} - 叫號喵`;
  renderProfile();
  if (isAdmin) loadAgents();
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
async function init() {
  const res = await apiFetch('/api/agent/profile', { method: 'GET' });
  if (res.status === 401) return;
  if (!res.ok) return showMsg('載入個人資料失敗', true);
  me = (await res.json()).agent;
  showMain(me.role === 'admin');
}
$('logout').onclick = logout;
$('openCreate').onclick = openCreateDialog;
$('agentFilter').oninput = renderAgents;
$('createForm').onsubmit = (e) => { e.preventDefault(); createAgent(); };
$('createCancel').onclick = closeCreateDialog;
$('editForm').onsubmit = (e) => { e.preventDefault(); saveEdit(); };
$('editCancel').onclick = closeEditDialog;
$('editDialog').oncancel = () => { EDITING_AGENT = null; $('editPassword').value = ''; };
$('profileForm').onsubmit = (e) => { e.preventDefault(); updateProfile(); };
window.addEventListener('load', init);
