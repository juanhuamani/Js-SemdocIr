import { VISITOR_KEYS, type Node } from '@babel/types';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { analyzeFunction } from '../../core/ast/analysis.ts';
import { CAUSES } from '../../core/ast/filter.ts';
import { readJson, sendJson } from '../http.ts';

const maxAstInspectionNodes = 1800;
const astMetadataFields = new Set([
  'type',
  'raw',
  'start',
  'end',
  'loc',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'extra',
  'errors',
]);

interface AstInspection {
  rootType: string;
  nodeCount: number;
  truncated: boolean;
  text: string;
}

/** Product/core route: parse once, apply admission, and expose the P result. */
export async function handleAnalyzeRoute(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = await readJson(request);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || !('source' in parsed)) {
    sendJson(response, 400, { error: 'Envía el código fuente en el campo "source".' });
    return;
  }
  const source = parsed.source;
  if (typeof source !== 'string' || source.trim().length === 0) {
    sendJson(response, 400, { error: 'Pega una función JavaScript antes de procesar.' });
    return;
  }

  let analysis;
  try {
    analysis = analyzeFunction(source);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : String(error),
      failedStep: 'parse',
      pipeline: [
        { id: 'parse', status: 'rechazada' },
        { id: 'filter', status: 'no ejecutado' },
        { id: 'extract', status: 'no ejecutado' },
        { id: 'assemble', status: 'no ejecutado' },
      ],
      stages: { ast: null, filter: null, extraction: null, representation: null },
    });
    return;
  }

  const astRoot = analysis.functionNode ?? analysis.ast.program;
  const astInspection = inspectAst(astRoot);
  const filterInspection = inspectFilter(analysis.admission, analysis.unit);
  if (
    !analysis.admission.admitted ||
    analysis.extracted === null ||
    analysis.representation === null
  ) {
    sendJson(response, 422, {
      error: `La función no pertenece al subconjunto admitido: ${analysis.admission.cause ?? 'causa no especificada'}.`,
      detail: analysis.admission.detail ?? null,
      failedStep: 'filter',
      pipeline: [
        { id: 'parse', status: 'completado' },
        { id: 'filter', status: 'rechazada' },
        { id: 'extract', status: 'no ejecutado' },
        { id: 'assemble', status: 'no ejecutado' },
      ],
      stages: {
        ast: astInspection,
        filter: filterInspection,
        extraction: null,
        representation: null,
      },
    });
    return;
  }

  const extracted = analysis.extracted;
  const content = analysis.representation;
  sendJson(response, 200, {
    functionName: extracted.name,
    functionId: `sha256:${analysis.sourceHash}`,
    sourceHash: analysis.sourceHash,
    representation: { id: 'p', name: 'JS-SemDocIR', content },
    pipeline: [
      { id: 'parse', status: 'completado' },
      { id: 'filter', status: 'admitida' },
      { id: 'extract', status: 'completado' },
      { id: 'assemble', status: 'completado' },
    ],
    stages: {
      ast: astInspection,
      filter: filterInspection,
      extraction: extracted,
      representation: content,
    },
    documentation: {
      status: 'not_configured',
      message: 'No hay un modelo de lenguaje configurado; no se genera documentación.',
    },
  });
}

function inspectFilter(
  admission: ReturnType<typeof analyzeFunction>['admission'],
  unit: ReturnType<typeof analyzeFunction>['unit'],
) {
  const isUnit = unit !== null;
  const isNotUnit = admission.cause === CAUSES.NOT_A_UNIT;
  const hasUnsupportedNode = admission.cause !== null && !isNotUnit;
  return {
    admitted: admission.admitted,
    cause: admission.cause,
    detail: admission.detail,
    unitName: unit?.name ?? null,
    checks: [
      {
        name: 'Una unidad de función reconocida',
        status: isUnit ? 'aprobado' : 'rechazado',
        detail: isUnit
          ? 'El fragmento raíz coincide con una forma de función admitida.'
          : (admission.detail ?? 'No se detectó una única función raíz.'),
      },
      {
        name: 'Sintaxis JavaScript válida',
        status: 'aprobado',
        detail: 'Babel pudo construir el AST; no se volvió a parsear para filtrar.',
      },
      {
        name: 'Sin construcciones excluidas',
        status: isNotUnit ? 'no ejecutado' : hasUnsupportedNode ? 'rechazado' : 'aprobado',
        detail: isNotUnit
          ? 'El filtro se detuvo al no reconocer una unidad de función.'
          : hasUnsupportedNode
            ? `${admission.cause}: ${admission.detail ?? 'construcción fuera del subconjunto.'}`
            : 'El recorrido completo del AST no encontró nodos excluidos.',
      },
      {
        name: 'Límite de ventana del modelo',
        status: 'no evaluado',
        detail:
          'La guarda depende de B1 y de un modelo con ventana configurada; ambos están pendientes.',
      },
    ],
  };
}

function inspectAst(root: Node): AstInspection {
  const lines: string[] = [];
  let nodeCount = 0;
  let truncated = false;
  const visit = (node: Node, depth: number): void => {
    if (nodeCount >= maxAstInspectionNodes) {
      truncated = true;
      return;
    }
    nodeCount += 1;
    const fields = Object.entries(node).filter(
      ([key, value]) =>
        !astMetadataFields.has(key) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    );
    const readableFields = Object.fromEntries(
      fields.map(([key, value]) => [
        key,
        typeof value === 'string' && value.length > 120 ? `${value.slice(0, 117)}…` : value,
      ]),
    );
    const description = fields.length === 0 ? '' : ` ${JSON.stringify(readableFields)}`;
    lines.push(`${'  '.repeat(depth)}${node.type}${description}`);
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (isAstNode(entry)) visit(entry, depth + 1);
          if (truncated) return;
        }
      } else if (isAstNode(child)) {
        visit(child, depth + 1);
        if (truncated) return;
      }
    }
  };
  visit(root, 0);
  if (truncated) lines.push(`… Vista truncada después de ${maxAstInspectionNodes} nodos.`);
  return { rootType: root.type, nodeCount, truncated, text: lines.join('\n') };
}

function isAstNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}
