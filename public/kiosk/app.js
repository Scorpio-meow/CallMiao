const $ = (s) => document.querySelector(s);
const socket = io();
const SERVICE_NAMES = { A: '一般保險服務', B: '理賠送件服務', C: '保單借據服務', D: '繳費服務', E: '人生設計所保險諮詢' };

function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }
function setActiveService(code) { document.querySelector('#serviceType').value = code; }

async function loadOverview() {
  const res = await fetch('/api/overview');
  const data = await res.json();
  const sum = (data.summary || []).reduce((acc, s) => { acc[s.serviceType] = s; return acc; }, {});
  ['A', 'B', 'C', 'D', 'E'].forEach(code => {
    const el = document.querySelector(`[data-wait="${code}"]`);
    if (el) el.textContent = sum[code]?.waiting || 0;
  });
  const html = (data.summary || []).map(s =>
    `<div class="chip">${SERVICE_NAMES[s.serviceType] || s.serviceType} 等待 ${s.waiting || 0}</div>`
  ).join('');
  const summaryEl = document.querySelector('#summary');
  if (summaryEl) summaryEl.innerHTML = html;
}

let selectedService = 'A';
document.querySelectorAll('.card[data-service]').forEach(c => {
  c.onclick = () => {
    selectedService = c.getAttribute('data-service');
    setActiveService(selectedService);
    $('#modalTitle').textContent = `取號：${SERVICE_NAMES[selectedService] || selectedService}`;
    $('#phone').value = '';
    $('#phoneModal').classList.remove('hidden');
  };
});

$('#cancelModal').onclick = () => $('#phoneModal').classList.add('hidden');
document.querySelector('#phone').addEventListener('input', (e) => { e.target.value = onlyDigits(e.target.value).slice(0, 15); });

$('#confirmModal').onclick = async () => {
  const serviceType = $('#serviceType').value;
  const rawPhone = $('#phone').value;
  const phone = onlyDigits(rawPhone) || undefined;
  if (!phone || phone.length < 6) { alert('請輸入有效的電話號碼（至少 6 位數）'); return; }
  const res = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceType, phone }) });
  const { ticket, error } = await res.json();
  if (error) { alert(error); return; }
  if (ticket) {
    const ticketUrl = `${location.origin}/ticket/index.html?id=${ticket.id}`;
    $('#number').textContent = ticket.number;
    $('#ticketLink').textContent = ticketUrl;
    $('#ticketLink').href = ticketUrl;
    $('#qrcode').src = `/api/qrcode?text=${encodeURIComponent(ticketUrl)}`;
    $('#phoneModal').classList.add('hidden');
    $('#resultModal').classList.remove('hidden');
    loadOverview();
  }
};

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'closeResult') {
    $('#resultModal').classList.add('hidden');
  }
});

loadOverview();
socket.on('queue:update', loadOverview);
