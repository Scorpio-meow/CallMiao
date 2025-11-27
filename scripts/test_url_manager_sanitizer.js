// Simple Node script to test sanitizeRedirectTarget
const URLManager = require('../public/utils/url-manager');

// Provide a simple global.location for the module to use
global.location = {
  href: 'http://localhost:3000/agent/index.html',
  origin: 'http://localhost:3000',
  hostname: 'localhost',
  protocol: 'http:'
};

(async () => {
  const manager = new URLManager();
  // Prevent actual fetch in loadConfig by setting cache
  manager.configCache = { data: { publicOrigin: 'http://localhost:3000' }, timestamp: Date.now(), expiry: 10000 };
  manager.config = manager.configCache.data;
  manager.isConfigLoaded = true;

  const tests = [
    { input: 'https://evil.com/malicious', allowed: [], expected: null },
    { input: 'https://localhost:3000/allowed', allowed: [], expectedOrigin: 'http://localhost:3000' },
    { input: '/agent/index.html', allowed: [], expected: 'http://localhost:3000/agent/index.html' },
    { input: '//evil.com/foo', allowed: [], expected: null },
    { input: 'javascript:alert(1)', allowed: [], expected: null },
    { input: new URL('http://localhost:3000/ok').href, allowed: ['http://localhost:3000'], expectedOrigin: 'http://localhost:3000' },
  ];

  for (const t of tests) {
    const res = await manager.sanitizeRedirectTarget(t.input, t.allowed);
    if (t.expected === null) {
      console.log(t.input, '=>', res === null ? 'REJECTED' : 'ACCEPTED (unexpected)', res);
    } else if (t.expectedOrigin) {
      const origin = res ? new URL(res).origin : null;
      const resultHostname = origin ? new URL(origin).hostname : null;
      const expectedHostname = new URL(t.expectedOrigin).hostname;
      console.log(t.input, '=>', resultHostname === expectedHostname ? 'ACCEPTED' : 'REJECTED', res);
    } else {
      console.log(t.input, '=>', res === t.expected ? 'ACCEPTED' : 'REJECTED', res);
    }
  }
})();