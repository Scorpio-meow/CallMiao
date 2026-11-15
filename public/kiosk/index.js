const $ = (s) => document.querySelector(s);
const socket = io();
let selectedService = null;
function renderCards(services) {
    const wrap = $('#cards');
    wrap.textContent = '';
    for (const service of services) {
        const card = document.createElement('button');
        card.className = 'card';
        const title = document.createElement('h3');
        title.textContent = service.name;
        const description = document.createElement('p');
        description.textContent = service.description;
        const wait = document.createElement('span');
        wait.className = 'wait';
        const count = document.createElement('b');
        count.dataset.wait = service.code;
        count.textContent = '0';
        wait.append('等待人數：', count, ' 人');
        card.append(title, description, wait);
        card.onclick = () => {
            selectedService = service;
            $('#modalTitle').textContent = `取號：${service.name}`;
            $('#serviceModal').classList.remove('hidden');
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
$('#cancelModal').onclick = () => $('#serviceModal').classList.add('hidden');
$('#confirmModal').onclick = async () => {
    const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType: selectedService.code })
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (data.error) {
        alert(data.error);
        return;
    }
    $('#number').textContent = data.ticket.number;
    $('#ticketLink').textContent = data.ticketUrl;
    $('#ticketLink').href = data.ticketUrl;
    $('#qrcode').src = `/api/qrcode/${data.ticket.id}`;
    $('#serviceModal').classList.add('hidden');
    $('#resultModal').classList.remove('hidden');
};
$('#closeResult').onclick = () => $('#resultModal').classList.add('hidden');
async function init() {
    const configRes = await fetch('/api/config');
    if (!configRes.ok) return;
    renderCards((await configRes.json()).services);
    const overviewRes = await fetch('/api/overview');
    if (overviewRes.ok) renderOverview(await overviewRes.json());
    socket.on('queue:update', (payload) => renderOverview(payload.overview));
}
init();