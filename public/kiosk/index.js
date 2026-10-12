const $ = (s) => document.querySelector(s);
const socket = io();
const SERVICE_NAMES = { A: '一般保險服務', B: '理賠送件服務', C: '保單借款服務', D: '繳費服務', E: '人生設計所保險諮詢' };
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }
function setActiveService(code) { document.querySelector('#serviceType').value = code; }
async function loadOverview() {
    const res = await fetch('/api/overview');
    const data = await res.json();
    const sum = (data.summary || []).reduce((acc, s) => { acc[s.serviceType] = s; return acc; }, {});
    // update card waits
    ['A', 'B', 'C', 'D', 'E'].forEach(code => {
        const el = document.querySelector(`[data-wait="${code}"]`);
        if (el) el.textContent = sum[code]?.waiting || 0;
    });
    // summary chips with full names (guard if #summary not present)
    const summaryEl = document.querySelector('#summary');
    if (summaryEl) {
        summaryEl.textContent = '';
        (data.summary || []).forEach(s => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.textContent = `${SERVICE_NAMES[s.serviceType] || s.serviceType} 等候 ${s.waiting || 0}`;
            summaryEl.appendChild(chip);
        });
    }
}
// Service cards click -> open modal
let selectedService = 'A';
document.querySelectorAll('.card[data-service]').forEach(c => {
    c.onclick = () => {
        selectedService = c.getAttribute('data-service');
        setActiveService(selectedService);
        $('#modalTitle').textContent = `取號：${SERVICE_NAMES[selectedService] || selectedService}`;
        $('#serviceModal').classList.remove('hidden');
    };
});
$('#cancelModal').onclick = () => $('#serviceModal').classList.add('hidden');
// Confirm create ticket
$('#confirmModal').onclick = async () => {
    const serviceType = $('#serviceType').value;

    const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType })
    });
    const { ticket, error } = await res.json();
    if (error) {
        alert(error);
        return;
    }
    if (ticket) {
        // try to get public origin from server (useful when server is behind a proxy or tunnel)
        let publicOrigin = null;
        try {
            const cfgRes = await fetch('/api/config');
            if (cfgRes.ok) {
                const cfg = await cfgRes.json();
                publicOrigin = cfg.publicOrigin || null;
            }
        } catch (e) { /* ignore */ }
        const base = publicOrigin || location.origin;
        const ticketUrl = `${base}/ticket/index.html?id=${ticket.id}`;
        $('#number').textContent = ticket.number;
        $('#ticketLink').textContent = ticketUrl;
        $('#ticketLink').href = ticketUrl;
        $('#qrcode').src = `/api/qrcode?text=${encodeURIComponent(ticketUrl)}`;
        // 開啟結果彈窗
        $('#serviceModal').classList.add('hidden');
        $('#resultModal').classList.remove('hidden');
        loadOverview();
    }
};
// 關閉結果彈窗
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'closeResult') {
        $('#resultModal').classList.add('hidden');
    }
});
loadOverview();
socket.on('queue:update', loadOverview);
