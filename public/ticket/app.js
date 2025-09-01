const params = new URLSearchParams(location.search);
const id = params.get('id');
const socket = io();

const STATUS_LABEL = {
  waiting: '等待',
  called: '已叫號',
  serving: '服務中',
  finished: '已完成',
  canceled: '已取消',
  cancelled: '已取消'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s || '-'); }

async function load(){
  const res = await fetch(`/api/ticket/${id}`);
  if(res.status!==200){
    document.querySelector('#info').textContent = '票券不存在';
    return;
  }
  const { ticket } = await res.json();
  const html = `
    <p>號碼：<strong>${ticket.number}</strong></p>
    <p>狀態：${statusLabel(ticket.status)}</p>
    <p>櫃台：${ticket.counter || '-'}</p>
    <p>建立：${new Date(ticket.createdAt).toLocaleString()}</p>
  `;
  document.querySelector('#info').innerHTML = html;
}

socket.on('queue:update', load);
socket.on('call:made', load);
load();
