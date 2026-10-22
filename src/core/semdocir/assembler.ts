// src/assembler.ts — canonical JS-SemDocIR instance assembly (spec §2–3).
//
// The extractor preserves source order in `Record.order`. This module applies
// E2's category order, inserts the bilateral absence markers from §2.3, and
// renders the function header required by the §3.2 grammar.

import {
  CATEGORIES,
  type Category,
  type ExtractorResult,
  type Record as SemDocRecord,
} from './extractor.ts';

/** Categories that have a defined absence marker (§2.3). */
const ABSENCE_CATEGORIES = ['INPUT', 'COND', 'CALL', 'ASYNC', 'ERR', 'RET'] as const;

type AbsenceCategory = (typeof ABSENCE_CATEGORIES)[number];

/**
 * Assembles an extracted function into one canonical JS-SemDocIR instance.
 *
 * Records are grouped by E2 category order and remain source-ordered within
 * each category. `ND` intentionally has no `NONE` marker: §2.3 defines no
 * bilateral absence form for non-determinable facts.
 */
export function assemble(result: ExtractorResult): string {
  const lines = [renderHeader(result)];
  const recordsByCategory = groupRecords(result.records);

  for (const category of CATEGORIES) {
    const records = recordsByCategory.get(category) ?? [];

    if (category === 'ERR') {
      lines.push(...renderErrorLines(records, result));
      continue;
    }

    if (records.length > 0) {
      lines.push(...records.map(renderRecord));
      continue;
    }

    const marker = absenceMarker(category, result);
    if (marker !== null) lines.push(marker);
  }

  return lines.join('\n');
}

/** Renders explicit error records and the required no-catch marker. */
function renderErrorLines(records: readonly SemDocRecord[], result: ExtractorResult): string[] {
  const lines = records.map(renderRecord);
  const hasCatch = records.some((record) => record.content.startsWith('CATCH '));

  if (result.hasThrow && !hasCatch) lines.push('ERR NOCATCH');
  else if (records.length === 0) lines.push('ERR NONE');

  return lines;
}

/** Groups records by category while preserving each category's source order. */
function groupRecords(records: readonly SemDocRecord[]): Map<Category, SemDocRecord[]> {
  const groups = new Map<Category, SemDocRecord[]>();
  for (const record of records) {
    const group = groups.get(record.category);
    if (group === undefined) groups.set(record.category, [record]);
    else group.push(record);
  }

  for (const group of groups.values()) group.sort((left, right) => left.order - right.order);
  return groups;
}

/** Renders one record using its category keyword and content. */
function renderRecord(record: SemDocRecord): string {
  return `${record.category} ${record.content}`;
}

/** Renders the §3.2 function header. */
function renderHeader(result: ExtractorResult): string {
  const asyncPrefix = result.isAsync ? 'async ' : '';
  return `${asyncPrefix}func ${result.name}(${result.params.join(', ')})`;
}

/**
 * Returns the marker for an empty category, or `null` for ND (which has no
 * absence marker). A non-empty ERR record always wins over NOCATCH/NONE.
 */
function absenceMarker(category: Category, result: ExtractorResult): string | null {
  if (!isAbsenceCategory(category)) return null;
  if (category === 'ERR') return result.hasThrow ? 'ERR NOCATCH' : 'ERR NONE';
  return `${category} NONE`;
}

function isAbsenceCategory(category: Category): category is AbsenceCategory {
  return ABSENCE_CATEGORIES.includes(category as AbsenceCategory);
}
