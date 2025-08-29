(function(){
  function initQueueWidget(opts){
    const target = typeof opts?.target === 'string' ? document.querySelector(opts.target) : (opts?.target || document.body);
    const url = opts?.src || '/kiosk/index.html';
    const height = opts?.height || '520px';
    const width = opts?.width || '100%';
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = '0';
    iframe.allow = 'clipboard-write;';
    target.appendChild(iframe);
    return iframe;
  }
  window.initQueueWidget = initQueueWidget;
})();
