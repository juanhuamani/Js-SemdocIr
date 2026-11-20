// real-cases.ts - assembles the curated replay view from frozen experiment outputs.
//
// Nothing here calls a model: the section replays results already stored in
// experimento/piloto.jsonl and scores already stored in experimento/metricas/.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CaseMetrics,
  type DatasetRecord,
  metricsFor,
  type OutputRecord,
  type ProtocolFile,
  readJsonl,
  readOptionalText,
  type RepresentationId,
  type ScoreRow,
  scoreKey,
} from './real-cases-files.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface CaseRepresentation {
  readonly id: RepresentationId;
  readonly label: string;
  readonly chars: number;
  readonly content: string;
  readonly metrics: CaseMetrics;
}

export interface RealCase {
  readonly id: string;
  readonly functionName: string;
  readonly repo: string;
  readonly path: string;
  readonly url: string;
  readonly category: 'acierto' | 'dificil' | 'desacierto';
  readonly categoryLabel: string;
  readonly note: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, string | number>>;
  readonly input: string;
  readonly output: string;
  readonly reference: string;
  readonly metrics: CaseMetrics;
  readonly representations: readonly CaseRepresentation[];
}

export interface RealCasesPayload {
  readonly mode: 'demo-replay';
  readonly notice: string;
  readonly run: Readonly<Record<string, string | number>>;
  readonly cases: readonly RealCase[];
}

interface CuratedCase {
  readonly id: string;
  readonly note: string;
}

/** Hand-picked from the full Codex run for hits, a hard case and measured misses. */
const CURATED_CASES: readonly CuratedCase[] = [
  {
    id: 'js-0411',
    note: 'Mejor BERTScore de la corrida completa; la salida reproduce el retorno y el caso indefinido.',
  },
  {
    id: 'js-0437',
    note: 'Mejor combinación BLEU/ROUGE-L; recupera la condición de firma de índice.',
  },
  {
    id: 'js-0442',
    note: 'Acierto en una función de TypeScript con retorno alternativo (unknownSymbol).',
  },
  {
    id: 'js-1740',
    note: 'Acierto con BLEU alto; la referencia pide parchear `node`, pero la representación solo muestra la llamada.',
  },
  {
    id: 'js-0001',
    note: 'Caso canónico del corpus (Axios). Correcto, pero más específico que la referencia.',
  },
  {
    id: 'js-2298',
    note: 'Mayor BLEU de la corrida, pero BERTScore medio: coincidencia léxica sin equivalencia semántica plena.',
  },
  {
    id: 'js-3216',
    note: 'Desacierto: la referencia es una línea separadora del archivo, no una descripción; el sistema describe la función correctamente.',
  },
  {
    id: 'js-0606',
    note: 'Desacierto: referencia de 1108 caracteres con etiquetas; la salida resume solo la inicialización.',
  },
];

const REPRESENTATION_LABELS: Readonly<Record<RepresentationId, string>> = {
  b0: 'B0 · código fuente',
  b1: 'B1 · SBT (árbol estructural)',
  b2: 'B2 · NIT (árbol numerado)',
  p: 'P · JS-SemDocIR',
};

const REPRESENTATIONS: readonly RepresentationId[] = ['b0', 'b1', 'b2', 'p'];

const CATEGORY_LABELS: Readonly<Record<RealCase['category'], string>> = {
  acierto: 'Acierto',
  dificil: 'Caso difícil',
  desacierto: 'Desacierto',
};

function categoryFor(bertscore: number | null): RealCase['category'] {
  if (bertscore === null) return 'dificil';
  if (bertscore >= 0.2) return 'acierto';
  if (bertscore >= 0) return 'dificil';
  return 'desacierto';
}

/**
 * Loads the curated replay cases from the stored experiment outputs.
 *
 * @param rootDir Repository root; overridable for tests.
 * @returns Cases with inputs, parameters, output, reference and metrics.
 * @throws {Error} When the frozen dataset or run files are missing.
 */
export async function loadRealCases(rootDir: string = repositoryRoot): Promise<RealCasesPayload> {
  const [records, outputs, bleuRows, rougeRows, bertRows, protocol] = await Promise.all([
    readJsonl<DatasetRecord>(path.join(rootDir, 'corpus/admitido.jsonl')),
    readJsonl<OutputRecord>(path.join(rootDir, 'experimento/salidas-codex.jsonl')),
    readJsonl<ScoreRow>(path.join(rootDir, 'experimento/metricas-codex-full/bleu.jsonl')),
    readJsonl<ScoreRow>(path.join(rootDir, 'experimento/metricas-codex-full/rouge.jsonl')),
    readJsonl<ScoreRow>(path.join(rootDir, 'experimento/metricas-codex-full/bertscore.jsonl')),
    readFile(path.join(rootDir, 'protocol.json'), 'utf8').then(
      (text) => JSON.parse(text) as ProtocolFile,
    ),
  ]);

  const dataset = new Map(records.map((record) => [record.id, record]));
  const bleu = new Map(
    bleuRows.map((row) => [scoreKey(row.id, row.representation), row.bleu ?? null]),
  );
  const rouge = new Map(
    rougeRows.map((row) => [scoreKey(row.id, row.representation), row.f1 ?? null]),
  );
  const bert = new Map(
    bertRows.map((row) => [scoreKey(row.id, row.representation), row.f1 ?? null]),
  );
  const outputsById = new Map<string, Map<RepresentationId, OutputRecord>>();
  for (const output of outputs) {
    const perCase = outputsById.get(output.id) ?? new Map<RepresentationId, OutputRecord>();
    perCase.set(output.representation, output);
    outputsById.set(output.id, perCase);
  }

  const cases: RealCase[] = [];
  for (const curated of CURATED_CASES) {
    const record = dataset.get(curated.id);
    const perCase = outputsById.get(curated.id);
    const primary = perCase?.get('p');
    if (!record || !perCase || !primary) continue;

    const representations: CaseRepresentation[] = [];
    for (const representation of REPRESENTATIONS) {
      const content = await readOptionalText(
        path.join(rootDir, `corpus/repr/${representation}/${curated.id}.txt`),
      );
      if (content === null) continue;
      representations.push({
        id: representation,
        label: REPRESENTATION_LABELS[representation],
        chars: content.length,
        content,
        metrics: metricsFor(representation, perCase.get(representation), bleu, rouge, bert),
      });
    }

    const metrics = metricsFor('p', primary, bleu, rouge, bert);
    const category = categoryFor(metrics.bertscore);
    cases.push({
      id: curated.id,
      functionName: record.func_name,
      repo: record.repo,
      path: record.path,
      url: record.url,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      note: curated.note,
      prompt: protocol.prompt,
      parameters: {
        model: primary.model,
        provider: 'OpenAI Responses',
        representation: 'P (JS-SemDocIR)',
        temperature: 0,
        maxOutputTokens: 128,
        reasoningEffort: 'none',
        topP: 'no enviado',
        seed: 'no enviado',
        protocolVersion: protocol.protocolVersion,
        parser: protocol.corpus.parserVersion,
        corpusSeed: protocol.corpus.seed,
      },
      input: representations.find((item) => item.id === 'p')?.content ?? '',
      output: primary.output,
      reference: record.docstring,
      metrics,
      representations,
    });
  }

  if (cases.length === 0) {
    throw new Error(
      'No se encontraron casos: revisa experimento/piloto.jsonl y corpus/admitido.jsonl.',
    );
  }

  return {
    mode: 'demo-replay',
    notice:
      'Modo demo: resultados precalculados del dataset. Reproducción local; no se llama al modelo ni a APIs externas.',
    run: {
      source: 'experimento/salidas-codex.jsonl',
      metrics: 'experimento/metricas-codex-full/*.jsonl',
      dataset: protocol.corpus.dataset,
      commit: protocol.corpus.sourceCommit,
      model: outputs[0]?.model ?? 'desconocido',
      functions: 2056,
      calls: 8224,
      representation: '4 por función (B0/B1/B2/P)',
    },
    cases,
  };
}
