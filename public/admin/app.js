// Admin page JS (externalized) using cookie-based auth + CSRF token
function escapeHTML(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
aSyncInit();

async function aSyncInit(){
  const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r=>r.ok?r.json():Promise.reject()).catch(()=>null);
  if(!me || !me.user || me.user.role !== 'admin'){
    const redirect = encodeURIComponent('/admin/agents.html');
    window.location.href = `/login/index.html?redirect=${redirect}`;
    return;
  }
  await ensureCsrf();
  bind();
  loadAgents();
}

async function ensureCsrf(){
  try{
    const r = await fetch('/api/admin/csrf', { method: 'POST', credentials: 'same-origin' });
    const j = await r.json();
    if(!r.ok || !j.csrfToken) throw new Error('csrf');
    sessionStorage.setItem('admin_csrf', j.csrfToken);
  }catch(e){
    alert('CSRF 初始化失敗，請重試');
  }
}

function csrfHeader(){
  const t = sessionStorage.getItem('admin_csrf');
  return t ? { 'x-csrf-token': t } : {};
}

function showMsg(text, err){
  const el = document.getElementById('msg');
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.background = err ? '#fff1f2' : '#ecfdf5';
  el.style.color = err ? '#991b1b' : '#065f46';
  setTimeout(()=>el.classList.add('hidden'), 4000);
}

async function apiFetch(url, opts={}){
  opts = Object.assign({ headers: {} }, opts);
  opts.headers = Object.assign({}, opts.headers, csrfHeader());
  if(!opts.headers['Content-Type'] && (!opts.body || typeof opts.body === 'object')) opts.headers['Content-Type'] = 'application/json';
  opts.credentials = 'same-origin';
  const res = await fetch(url, opts);
  if(res.status === 401){
    const redirect = encodeURIComponent('/admin/agents.html');
    window.location.href = `/login/index.html?redirect=${redirect}`;
  }
  return res;
}

async function loadAgents(){
  const wrap = document.getElementById('agentsWrap');
  try{
    const res = await apiFetch('/api/agents', { method: 'GET' });
    const data = await res.json();
    if(data.error) return wrap.innerHTML = `<div class="muted">錯誤: ${escapeHTML(data.error)}</div>`;
    const rows = data.agents || [];
    if(rows.length === 0) return wrap.innerHTML = '<div class="muted">無帳號</div>';
    const html = ['<table><thead><tr><th>id</th><th>account</th><th>name</th><th>counter</th><th>role</th><th>active</th><th></th></tr></thead><tbody>'];
    for(const a of rows){
      html.push(`<tr><td>${a.id}</td><td>${escapeHTML(a.account)}</td><td>${escapeHTML(a.name||'')}</td><td>${escapeHTML(a.counter||'')}</td><td>${escapeHTML(a.role||'')}</td><td>${a.active? 'Y':'N'}</td><td><button data-id="${a.id}" class="edit small">編輯</button> <button data-id="${a.id}" class="del small danger">刪除</button></td></tr>`);
    }
    html.push('</tbody></table>');
    wrap.innerHTML = html.join('');
    document.querySelectorAll('button.edit').forEach(b=>b.onclick = onEdit);
    document.querySelectorAll('button.del').forEach(b=>b.onclick = onDelete);
  }catch(err){ wrap.innerHTML = `<div class="muted">載入失敗</div>`; console.error(err); }
}

async function onEdit(e){
  const id = e.currentTarget.getAttribute('data-id');
  const name = prompt('新姓名 (留空不變)');
  const password = prompt('新密碼 (留空不變)');
  const counter = prompt('櫃台 (留空不變)');
  const body = {};
  if(name) body.name = name;
  if(password) body.password = password;
  if(counter) body.counter = counter;
  try{
    const res = await apiFetch(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    if(data.error) return showMsg('修改失敗: '+data.error, true);
    showMsg('已修改');
    loadAgents();
  }catch(err){ showMsg('修改失敗', true); }
}

async function onDelete(e){
  const id = e.currentTarget.getAttribute('data-id');
  if(!confirm('確定刪除？')) return;
  try{
    const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if(data.error) return showMsg('刪除失敗: '+data.error, true);
    showMsg('已刪除'); loadAgents();
  }catch(err){ showMsg('刪除失敗', true); }
}

function bind(){
  document.getElementById('logout').onclick = async ()=>{
    try{ await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' }); }catch(e){}
    window.location.href = '/login/index.html';
  };
  document.getElementById('createBtn').onclick = async ()=>{
    const account = document.getElementById('newAccount').value.trim();
    const name = document.getElementById('newName').value.trim();
    const password = document.getElementById('newPassword').value;
    const counter = document.getElementById('newCounter').value.trim();
    if(!account || !password) return showMsg('account & password required', true);
    try{
      const res = await apiFetch('/api/agents', { method: 'POST', body: JSON.stringify({ account, name, password, counter }) });
      const data = await res.json();
      if(data.error) return showMsg('建立失敗: '+data.error, true);
      showMsg('建立成功');
      document.getElementById('newAccount').value=''; document.getElementById('newName').value=''; document.getElementById('newPassword').value=''; document.getElementById('newCounter').value='';
      loadAgents();
    }catch(err){ showMsg('建立失敗', true); }
  };
}
