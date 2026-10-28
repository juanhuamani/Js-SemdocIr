import type { IncomingMessage, ServerResponse } from 'node:http';

export const maxRequestBytes = 256 * 1024;

export async function readBody(request: IncomingMessage): Promise<string> {
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

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  return JSON.parse(await readBody(request)) as unknown;
}
