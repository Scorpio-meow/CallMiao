const socket = io();
async function render(){
  const res = await fetch('/api/overview');
  const data = await res.json();
  const calls = data.currentCalls||[];
  const html = calls.slice(0,8).map(c=>`<div class="row"><div class="num">${c.number}</div><div class="ctr">櫃台 ${c.counter||'-'}</div></div>`).join('');
  document.querySelector('#calls').innerHTML = html || '<div class="row empty">暫無叫號</div>';
}
function speak(text){
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    speechSynthesis.speak(u);
  } catch(e) {}
}
socket.on('queue:update', render);
socket.on('call:made', (payload)=>{
  render();
  const t = payload?.ticket;
  if(t){ speak(`請號碼 ${t.number} 到 ${t.counter||'服務櫃台'}`); }
});
render();
