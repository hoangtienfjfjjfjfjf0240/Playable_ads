const http = require('http');
const net = require('net');

const targetHost = '127.0.0.1';
const targetPort = 3001;
const listenPort = 3000;

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain;charset=utf-8' });
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries(req.headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`Proxy listening on http://127.0.0.1:${listenPort} -> http://${targetHost}:${targetPort}`);
});
