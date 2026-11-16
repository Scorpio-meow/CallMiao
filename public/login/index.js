const $ = (s) => document.querySelector(s);
const ERROR_TEXT = {
  'invalid credentials': '帳號或密碼錯誤',
  'captcha mismatch': '驗證碼錯誤，請重新輸入',
  'invalid or expired captcha token': '驗證碼已過期，已換一張新的',
  'captcha required': '請輸入驗證碼',
  'too many login attempts, please try later': '登入嘗試次數過多，請稍後再試'
};
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
function showError(text, focusEl) {
  const el = $('#loginError');
  el.textContent = text;
  el.classList.remove('hidden');
  if (focusEl) focusEl.focus();
}
function clearError() { $('#loginError').classList.add('hidden'); }
async function loadCaptcha() {
  try {
    const res = await fetch('/api/captcha/new');
    const data = await res.json();
    if (!res.ok) { showError(ERROR_TEXT[data.error] || '無法載入驗證碼，請稍後再試'); return; }
    captchaToken = data.token;
    $('#captchaImage').src = `/api/captcha/image/${encodeURIComponent(captchaToken)}?t=${Date.now()}`;
  } catch (err) {
    console.error('captcha load', err);
    showError('無法載入驗證碼，請檢查網路連線');
  }
}
$('#captchaRefresh').addEventListener('click', () => { $('#captchaInput').value = ''; loadCaptcha(); });
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const acct = $('#account').value.trim();
  const pwd = $('#password').value;
  const input = $('#captchaInput').value.trim();
  if (!acct) return showError('請輸入帳號', $('#account'));
  if (!pwd) return showError('請輸入密碼', $('#password'));
  if (!input) return showError('請輸入驗證碼', $('#captchaInput'));
  if (!captchaToken) return showError('驗證碼尚未就緒，請重新整理頁面');
  const btn = $('#loginBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account: acct, password: pwd, captchaToken, captcha: input })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(ERROR_TEXT[data.error] || data.error || '登入失敗', $('#captchaInput'));
      $('#captchaInput').value = '';
      await loadCaptcha();
      return;
    }
    location.href = redirectTo;
  } catch (err) {
    console.error('登入錯誤:', err);
    showError('無法連線到伺服器，請稍後再試');
    await loadCaptcha();
  } finally {
    btn.disabled = false;
  }
});
loadCaptcha();
