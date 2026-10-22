# Serializer contract and golden fixtures

These fixtures define the concrete encoding used by B1/SBT and B2/NIT. They
are based on the AST produced by the pinned `@babel/parser@8.0.7` and
`@babel/types@8.0.6` packages. Both serializers and their exact fixture tests
are implemented.

## Shared traversal rules

- Serialize the selected function node only. Do not serialize Babel's
  `File`/`Program` wrapper.
- Node names are Babel node `type` names (for example, `FunctionDeclaration`
  and `StringLiteral`), not ESTree aliases.
- Visit structural child nodes in the order declared by Babel's
  `VISITOR_KEYS`; array children retain their array order. Omit null/empty
  child fields. The order is AST visitor order, not necessarily source order
  (notably, `TemplateLiteral` visits `quasis` before `expressions`).
- A node's lexical value is the exact source slice from its Babel `start` to
  `end`, without normalization, for `Identifier`, Babel literal nodes, and
  `TemplateLiteral`. The template literal retains its complete source spelling
  on the `TemplateLiteral` node; its `TemplateElement` children remain
  structural nodes and their `tail` flag is retained as a semantic field.
- Omit parser metadata: `loc`, `start`, `end`, `extra`, comments, and tokens.
- Preserve every other own, enumerable primitive AST field (string, number,
  boolean, or `null`) except `type`, lexical fields (`name`, `value`, `raw`,
  `cooked`), and the parser metadata above. This includes fields such as
  `operator`, declaration `kind`, `async`, and `generator`, including explicit
  `false` values. Sort field names by JavaScript's default string ordering
  before encoding them.
- The node payload is `null` when it has neither a lexical value nor semantic
  fields. Otherwise it is the object `{"source": <string|null>, "fields": <object>}`,
  with `source` first and `fields` second. Empty `fields` is `{}`.

## B1 / SBT encoding

- Emit every node as `<Type ... Type>`: an opening marker, then its optional
  compact-JSON payload and child-node encodings, then the matching closing
  marker.
- Encode a non-null node payload as compact JSON (`JSON.stringify`). Nodes
  without a payload have no payload token.
- Separate adjacent markers/value tokens by exactly one ASCII space. The
  fixture's full SBT output is one line.

## B2 / NIT encoding

- Emit one JSON array per node, in pre-order: `[id, type, value, children]`.
- IDs are zero-based and assigned sequentially in that same pre-order.
- `value` is the shared node payload object, or `null` when the node has no
  payload. JSON escaping is the standard UTF-8 JSON encoding.
- `children` is an array of the direct child node IDs in Babel visitor-key
  order; nodes without children use `[]`.
- Emit one compact JSON tuple per line (JSON Lines), with no wrapper array.

## Fixture format

`golden.json` contains each source function and its exact expected B1 and B2
outputs. The fixtures cover nested nodes, identifiers, a string literal, a
template literal, and semantic scalar fields (`async`, `generator`, `kind`,
`operator`, and `tail`). `test/sbt.test.ts` and `test/nit.test.ts` check each
format against these static expected values; do not regenerate expected values
from the serializer under test.

## Scope note

This is an implementation contract for the serializer fixtures, not an
assertion that the thesis advisor has approved the pending design decisions.
The fixtures freeze the structural traversal, lexical-value behavior, and
semantic scalar-field behavior approved for F2.1.
