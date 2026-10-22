import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

import { GenerationService } from './client/generation-service.ts';
import { MockGenerationClient } from './client/mock.ts';
import { createRepresentationJobs, runRepresentationJob } from './orchestrator.ts';
import { buildRepresentationBundle } from './representations.ts';

const terminal = createInterface({ input: stdin, output: stdout });

try {
  console.log('\nJS-SemDocIR · prueba local\n');
  console.log('Pega una función JavaScript. Puedes pegar varias líneas.');
  console.log('Cuando termines, escribe :fin en una línea y presiona Enter.');
  console.log('Escribe :ejemplo para cargar un ejemplo o :salir para cancelar.\n');

  const lines: string[] = [];
  stdout.write('> ');
  for await (const line of terminal) {
    if (line.trim() === ':salir') break;
    if (line.trim() === ':ejemplo' && lines.length === 0) {
      lines.push(
        'function calcularPrecioFinal(precioBase, impuesto, descuento) {',
        '  const precioConImpuesto = precioBase * (1 + impuesto / 100);',
        '  const montoDescuento = precioConImpuesto * (descuento / 100);',
        '  const precioFinal = precioConImpuesto - montoDescuento;',
        '  return precioFinal.toFixed(2);',
        '}',
      );
      console.log('\nEjemplo cargado. Escribe :fin para procesarlo.');
      stdout.write('  ');
      continue;
    }
    if (line.trim() === ':fin') break;
    lines.push(line);
    stdout.write('  ');
  }

  const source = lines.join('\n').trim();
  if (!source) {
    console.log('\nNo se ingresó ninguna función.');
    process.exitCode = lines.length === 0 ? 0 : 1;
  } else {
    const bundle = buildRepresentationBundle(source);
    const jobs = createRepresentationJobs(bundle);
    const service = new GenerationService(new MockGenerationClient());

    console.log(`\nFunción identificada: ${bundle.functionId}`);
    console.log(`Huella de origen: ${bundle.sourceHash}`);
    console.log('\nRepresentaciones generadas (mismo AST de entrada):');
    for (const artifact of Object.values(bundle.artifacts)) {
      console.log(`\n${artifact.representation.toUpperCase()} · ${artifact.relativePath}`);
      console.log('─'.repeat(72));
      console.log(artifact.content);
    }

    console.log('\nPrueba local del flujo de generación (cliente mock; sin llamadas a IA):');
    for (const job of jobs) {
      const result = await runRepresentationJob(job, service);
      if (result.status === 'succeeded') {
        console.log(
          `  ${result.representation.toUpperCase()}: ${result.response.output} ` +
            `(intentos: ${result.attempts}, caché: ${result.cacheHit ? 'sí' : 'no'})`,
        );
      } else {
        console.log(`  ${result.representation.toUpperCase()}: error · ${result.error.message}`);
        process.exitCode = 1;
      }
    }
    console.log('\nNota: el cliente mock no redacta documentación.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nNo se pudo procesar la función: ${message}`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
