const $ = (s) => document.querySelector(s);
let captchaToken = null;
function safeRedirectTarget(value) {
  try {
    const target = new URL(value, location.origin);
    if (target.origin === location.origin) return `${target.pathname}${target.search}${target.hash}`;
  } catch (err) {
    console.warn('invalid redirect target', err);
  }
  return '/agent/index.html';
}
const redirectTo = safeRedirectTarget(new URLSearchParams(location.search).get('redirect') || '/agent/index.html');
async function loadCaptcha() {
  try {
    const res = await fetch('/api/captcha/new');
    const data = await res.json();
    captchaToken = data.token;
    $('#captchaImage').src = `/api/captcha/image/${encodeURIComponent(captchaToken)}?t=${Date.now()}`;
  } catch (err) { console.error('captcha load', err); }
}
$('#captchaImage').addEventListener('click', () => loadCaptcha());
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const acct = $('#account').value.trim();
  const pwd = $('#password').value;
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
    location.href = redirectTo;
  } catch (err) {
    console.error('登入錯誤:', err);
    alert('登入錯誤');
    await loadCaptcha();
  }
});
loadCaptcha();