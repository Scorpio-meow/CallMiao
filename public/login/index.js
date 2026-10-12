const $ = (s) => document.querySelector(s);
let captchaToken = null;
const urlManager = window.URLManager;
const params = new URLSearchParams(location.search);
const redirectTo = params.get('redirect') || '/agent/index.html';
async function loadCaptcha() {
  try {
    const res = await fetch('/api/captcha/new');
    const data = await res.json();
    captchaToken = data.token;
    const img = document.querySelector('#captchaImage');
    img.src = `/api/captcha/image/${encodeURIComponent(captchaToken)}?t=${Date.now()}`;
  } catch (err) { console.error('captcha load', err); }
}
document.querySelector('#captchaImage').addEventListener('click', () => loadCaptcha());
document.querySelector('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const acct = $('#account').value.trim();
  const pwd = $('#password').value.trim();
  const input = $('#captchaInput').value.trim();
  if (!acct) { alert('請輸入帳號'); return; }
  if (!pwd) { alert('請輸入密碼'); return; }
  if (!input) { alert('請輸入驗證碼'); return; }
  if (!captchaToken) { alert('驗證碼尚未就緒，請重新載入頁面'); return; }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account: acct, password: pwd, captchaToken, captcha: input })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || '登入失敗'); await loadCaptcha(); return; }
    try {
      if (data && data.agent) {
        const display = data.agent.name || data.agent.account || acct;
        sessionStorage.setItem('ui_agent_name', display);
        if (data.agent.counter) sessionStorage.setItem('ui_agent_counter', data.agent.counter);
        if (data.agent.account) sessionStorage.setItem('ui_agent_account', data.agent.account);
        if (data.agent.id) sessionStorage.setItem('ui_agent_id', String(data.agent.id));
        if (data.agent.role) sessionStorage.setItem('ui_agent_role', data.agent.role);
      } else {
        if (acct) sessionStorage.setItem('ui_agent_name', acct);
      }
    } catch (e) { console.warn('storage error', e); }
    console.log('登入成功，準備跳轉到:', redirectTo);
    await urlManager.handleLoginRedirect(redirectTo);
  } catch (err) {
    console.error('登入錯誤:', err);
    alert('登入錯誤');
    await loadCaptcha();
  }
});
loadCaptcha();
