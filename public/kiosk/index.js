const $ = (s) => document.querySelector(s);
const socket = io();
const ERROR_TEXT = {
  'too many waiting tickets from this network': '這個網路已有多張等候中的號碼，請先完成服務後再取號',
  'queue is full, please try later': '這項服務目前等候人數已滿，請稍後再試',
  'too many ticket creations, please try later': '取號太頻繁，請稍後再試',
  'invalid serviceType': '服務項目無效，請重新整理頁面'
};
let selectedService = null;
let lockedScrollY = 0;
function lockScroll() {
  if (document.body.style.position === 'fixed') return;
  lockedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
}
function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, lockedScrollY);
}
function openSheet(id) {
  lockScroll();
  $(id).showModal();
}
function closeSheet(id) {
  $(id).close();
}
document.querySelectorAll('.sheet').forEach(sheet => {
  sheet.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) unlockScroll(); });
});
function renderCards(services) {
  const wrap = $('#cards');
  wrap.textContent = '';
  for (const service of services) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'service-card';
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = service.name;
    const description = document.createElement('span');
    description.className = 'desc';
    description.textContent = service.description;
    const wait = document.createElement('span');
    wait.className = 'wait';
    const count = document.createElement('b');
    count.dataset.wait = service.code;
    count.textContent = '0';
    wait.append('目前等候', count, '人');
    card.append(title, description, wait);
    card.onclick = () => {
      selectedService = service;
      $('#modalTitle').textContent = `取號：${service.name}`;
      $('#modalDesc').textContent = service.description;
      $('#modalError').classList.add('hidden');
      openSheet('#serviceModal');
    };
    wrap.appendChild(card);
  }
}
function renderOverview(overview) {
  for (const s of overview.summary) {
    const el = document.querySelector(`[data-wait="${CSS.escape(s.serviceType)}"]`);
    if (el) el.textContent = String(s.waiting);
  }
}
function showModalError(text) {
  const el = $('#modalError');
  el.textContent = text;
  el.classList.remove('hidden');
}
$('#cancelModal').onclick = () => closeSheet('#serviceModal');
$('#confirmModal').onclick = async () => {
  const btn = $('#confirmModal');
  btn.disabled = true;
  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceType: selectedService.code })
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (data.error) {
      showModalError(ERROR_TEXT[data.error] || data.error);
      return;
    }
    $('#number').textContent = data.ticket.number;
    $('#ticketLink').textContent = data.ticketUrl;
    $('#ticketLink').href = data.ticketUrl;
    $('#qrcode').src = `/api/qrcode/${data.ticket.id}`;
    closeSheet('#serviceModal');
    openSheet('#resultModal');
  } catch (err) {
    showModalError('無法連線到伺服器，請稍後再試');
  } finally {
    btn.disabled = false;
  }
};
$('#closeResult').onclick = () => closeSheet('#resultModal');
async function init() {
  const configRes = await fetch('/api/config');
  if (!configRes.ok) return;
  renderCards((await configRes.json()).services);
  const overviewRes = await fetch('/api/overview');
  if (overviewRes.ok) renderOverview(await overviewRes.json());
  socket.on('queue:update', (payload) => renderOverview(payload.overview));
}
init();
