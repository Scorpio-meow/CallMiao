(function () {
  const kioskUrl = new URL('/kiosk/index.html', document.currentScript.src).href;
  function initQueueWidget(opts) {
    const target = typeof opts?.target === 'string' ? document.querySelector(opts.target) : (opts?.target || document.body);
    const height = opts?.height || '520px';
    const width = opts?.width || '100%';
    const iframe = document.createElement('iframe');
    iframe.src = kioskUrl;
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = '0';
    iframe.allow = 'clipboard-write;';
    target.appendChild(iframe);
    return iframe;
  }
  window.initQueueWidget = initQueueWidget;
})();