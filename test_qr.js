const http = require('http');
const fs = require('fs');
const url = 'http://localhost:3000/api/qrcode?text=' + encodeURIComponent('https://example.com/ticket/index.html?id=1');
http.get(url, (res) => {
  const bufs = [];
  res.on('data', (b) => bufs.push(b));
  res.on('end', () => {
    const buf = Buffer.concat(bufs);
    fs.writeFileSync('qrcode_test.png', buf);
    console.log('wrote qrcode_test.png', buf.length);
  });
}).on('error', (e) => console.error('err', e));
