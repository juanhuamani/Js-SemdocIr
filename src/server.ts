import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { GenerationService } from './client/generation-service.ts';
import { MockGenerationClient } from './client/mock.ts';
import { createRepresentationJobs, runRepresentationJob } from './orchestrator.ts';
import { buildRepresentationBundle } from './representations.ts';

const pagePath = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const maxRequestBytes = 256 * 1024;

/** Creates the local UI server; exported to support HTTP integration tests. */
export function createAppServer() {
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
    try {
      const page = await readFile(pagePath);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
    } catch {
      sendJson(response, 500, { error: 'No se pudo cargar la interfaz local.' });
    }
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/analyze') {
    sendJson(response, 404, { error: 'Ruta no encontrada.' });
    return;
  }

  try {
    const body = await readBody(request);
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || !('source' in parsed)) {
      sendJson(response, 400, { error: 'Envía el código fuente en el campo "source".' });
      return;
    }
    const source = parsed.source;
    if (typeof source !== 'string' || source.trim().length === 0) {
      sendJson(response, 400, { error: 'Pega una función JavaScript antes de procesar.' });
      return;
    }

    const bundle = buildRepresentationBundle(source);
    const service = new GenerationService(new MockGenerationClient());
    const jobs = createRepresentationJobs(bundle);
    const generations = [];
    for (const job of jobs) generations.push(await runRepresentationJob(job, service));

    sendJson(response, 200, {
      functionId: bundle.functionId,
      sourceHash: bundle.sourceHash,
      representations: bundle.artifacts,
      generations: generations.map((result) =>
        result.status === 'succeeded'
          ? {
              representation: result.representation,
              status: result.status,
              output: result.response.output,
              cacheHit: result.cacheHit,
              attempts: result.attempts,
            }
          : {
              representation: result.representation,
              status: result.status,
              error: result.error.message,
              cacheHit: result.cacheHit,
              attempts: result.attempts,
            },
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxRequestBytes) throw new Error('El código supera el límite de 256 KB.');
    chunks.push(data);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
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
