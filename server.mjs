// One managed HTTP listener for Hostinger: Nest owns /api/v1, Next owns the UI.
import 'dotenv/config';
import { createServer } from 'node:http';
import next from 'next';

process.env.API_NO_START = 'true';
const { start } = await import('./backend/dist/main.js');
const { db } = await import('./backend/dist/db.js');
const api = await start({ listen: false });
const apiHandler = api.getHttpAdapter().getInstance();
const port = Number(process.env.PORT || 3000);
const frontend = next({ dev: false, port });
await frontend.prepare();
const frontendHandler = frontend.getRequestHandler();
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/api/v1' || path.startsWith('/api/v1/')) apiHandler(req, res);
  else frontendHandler(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(port, '0.0.0.0', () => console.log('Sales application listening'));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  server.close(async () => {
    await frontend.close();
    await api.close();
    await db.$disconnect();
    clearTimeout(deadline);
  });
  server.closeIdleConnections();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
