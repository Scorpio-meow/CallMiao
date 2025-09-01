(function(){
  const $ = (s)=>document.querySelector(s);
  let captchaToken = null;
  const params = new URLSearchParams(location.search);
  const redirectTo = params.get('redirect') || '/agent/index.html';

  async function loadCaptcha(){
    try{
      const res = await fetch('/api/captcha/new');
      const data = await res.json();
      captchaToken = data.token;
      const img = document.querySelector('#captchaImage');
      img.src = `/api/captcha/image/${encodeURIComponent(captchaToken)}?t=${Date.now()}`;
    }catch(err){ console.error('captcha load', err); }
  }

  document.querySelector('#captchaImage').addEventListener('click', ()=> loadCaptcha());

  document.querySelector('#loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const acct = $('#account').value.trim();
    const pwd = $('#password').value.trim();
    const input = $('#captchaInput').value.trim();
    if(!acct){ alert('請輸入帳號'); return; }
    if(!pwd){ alert('請輸入密碼'); return; }
    if(!input){ alert('請輸入驗證碼'); return; }
    if(!captchaToken){ alert('驗證碼尚未就緒，請重新載入頁面'); return; }
    try{
      const res = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ account: acct, password: pwd, captchaToken, captcha: input }) });
      const data = await res.json();
      if(!res.ok){ alert(data.error || '登入失敗'); await loadCaptcha(); return; }
      // Success: do NOT store any PIN; keep only display info (non-sensitive)
      try{
        if(data && data.agent){
          const display = data.agent.name || data.agent.account || acct;
          sessionStorage.setItem('agent_name', display);
          if(data.agent.counter) sessionStorage.setItem('agent_counter', data.agent.counter);
          if(data.agent.account) sessionStorage.setItem('agent_account', data.agent.account);
          if(data.agent.id) sessionStorage.setItem('agent_id', String(data.agent.id));
          if(data.agent.role) sessionStorage.setItem('agent_role', data.agent.role);
        }
      }catch(e){ /* ignore */ }
      // safe redirect: same-origin only
      try{
        const url = new URL(redirectTo, location.origin);
        if(url.origin === location.origin){ location.href = url.pathname + url.search + url.hash; }
        else { location.href = '/agent/index.html'; }
      }catch(e){ location.href = '/agent/index.html'; }
    }catch(err){ console.error(err); alert('登入錯誤'); }
  });

  loadCaptcha();
})();
