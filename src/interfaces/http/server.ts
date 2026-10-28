import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { handleAnalyzeRoute, handleCompareRoute } from './routes/index.ts';
import { sendJson } from './http.ts';

const pagePath = fileURLToPath(new URL('../../../ui/index.html', import.meta.url));

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

interface Route {
  readonly method: 'GET' | 'POST';
  readonly handle: Handler;
}

const routes = new Map<string, Route>([
  ['/', { method: 'GET', handle: servePage }],
  ['/index.html', { method: 'GET', handle: servePage }],
  ['/api/analyze', { method: 'POST', handle: handleAnalyzeRoute }],
  ['/api/compare', { method: 'POST', handle: handleCompareRoute }],
]);

/** Creates the local UI server; exported to support HTTP integration tests. */
export function createAppServer() {
  return createServer((request, response) => {
    void routeRequest(request, response).catch((error: unknown) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

async function servePage(_request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const page = await readFile(pagePath);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  } catch {
    sendJson(response, 500, { error: 'No se pudo cargar la interfaz local.' });
  }
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const route = routes.get(pathname);
  if (route === undefined) {
    sendJson(response, 404, { error: 'Ruta no encontrada.' });
    return;
  }
  if (request.method !== route.method) {
    response.setHeader('allow', route.method);
    sendJson(response, 405, {
      error: `Método no permitido en ${pathname}; usa ${route.method}.`,
    });
    return;
  }
  await route.handle(request, response);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4173);
  const server = createAppServer();
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`El puerto ${port} ya está ocupado.`);
      console.error(`Si JS-SemDocIR ya está abierta, úsala en http://127.0.0.1:${port}.`);
      console.error('Para usar otro puerto en PowerShell: $env:PORT=4174; npm run app');
      process.exitCode = 1;
      return;
    }
    console.error(`No se pudo iniciar el servidor local: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`JS-SemDocIR listo en http://127.0.0.1:${port}`);
    console.log('Servidor local · cliente mock · sin llamadas externas');
  });
}
