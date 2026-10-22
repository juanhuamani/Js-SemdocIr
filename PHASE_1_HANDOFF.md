# JS-SemDocIR — Traspaso de la Fase 1 a la Fase 2

**Propósito:** conservar el contexto técnico y metodológico necesario para continuar la implementación en la Fase 2 sin reabrir informalmente decisiones de la Fase 1.

**Thesis:** “Diseño y evaluación de JS-SemDocIR: una representación semántica compacta basada en AST para la generación de documentación funcional de funciones JavaScript”.

**Repositorio de implementación:** `jssemdocir/` (este directorio).  
**Referencia técnica rectora:** `../especificacion_propuesta.md`, en especial §§1–8 y 14–16.  
**Plan de fases:** `../plan_implementacion_tres_fases.md`.  
**Decisiones de diseño y estado de aprobación:** `../registro_decisiones.md`.  
**Seguimiento de subfases de Fase 1:** `../fase1_extractor.md`.

> **Supuesto de traspaso:** por indicación del usuario, la Fase 1 se considera terminada para iniciar el trabajo de Fase 2. Este documento también señala un entregable formal de verificación que el seguimiento actual todavía marca pendiente; no debe presentarse como evidencia completada sin resolverlo.

## 1. Resumen ejecutivo

La Fase 1 implementa el pipeline local determinista:

```text
función JavaScript aislada
  → parser Babel congelado
  → filtro de admisibilidad
  → recorrido AST y extracción JS-SemDocIR
  → ensamblador textual canónico
```

La implementación usa TypeScript/ESM y ejecución nativa de TypeScript de Node.js (Node >=24), `@babel/parser@8.0.7` y `@babel/types@8.0.6`. En la última verificación registrada había **76 pruebas de Node aprobadas**, con typecheck, ESLint y Prettier limpios. La Fase 1 verifica software; no equivale a evaluar el corpus ni constituye evidencia experimental.

La implementación local de Fase 2 ya incluye B1/SBT, B2/NIT, contrato común B0/B1/B2/P, protocolo y cliente mock, caché/reintentos y orquestación por función × representación. El adaptador real queda bloqueado hasta aprobar proveedor/modelo D6.1. Este traspaso no autoriza ejecutar el experimento completo, calcular métricas ni aplicar la rúbrica humana.

## 2. Entregables de la Fase 1

### 2.1 Módulos y contratos

| Archivo                                                                                         | Responsabilidad / contrato                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/parse.ts`                                                                                  | `parseFunction(source: string): File`; envoltura congelada de Babel; produce `SyntaxError` explícito ante entrada inválida. `PARSER_VERSION` es `8.0.7`; opciones: `sourceType: 'unambiguous'`, `errorRecovery: false` y sin plugins JSX/TypeScript/decoradores.                                                                            |
| `src/ast.ts`                                                                                    | Walker genérico en profundidad para AST Babel. `walk(node, enter, parent?)` admite `false` para detener el descenso en una frontera y `ABORT` para detener todo el recorrido. Omite claves de metadatos, comentarios y tokens.                                                                                                              |
| `src/filter.ts`                                                                                 | `detectUnit`, `findRejectedNode` y `filter`; reconoce una declaración nombrada única, función/flecha asignada a identificador y `module.exports.name = function` admitido; rechaza sintaxis excluida recorriendo el árbol completo y devuelve una causa determinista. La guarda de ventana B1 se difiere porque B1 se implementa en Fase 2. |
| `src/extractor.ts`                                                                              | `extractFunction(source, ast): ExtractorResult`; extrae cabecera/parámetros y registros, respetando fronteras de función y reglas de sitios de operación. Conserva `order` monótono de emisión y `hasThrow`.                                                                                                                                |
| `src/assembler.ts`                                                                              | `assemble(result: ExtractorResult): string`; genera `[async ]func name(params)`, agrupa según categorías E2, preserva orden dentro de cada categoría e inserta marcadores de ausencia/error.                                                                                                                                                |
| `test/parse.test.ts`, `test/filter.test.ts`, `test/extractor.test.ts`, `test/assembler.test.ts` | Pruebas del parser, filtro, extracción y ensamblado exacto.                                                                                                                                                                                                                                                                                 |

### 2.2 Comportamiento de la representación implementado

- El recorrido se detiene en `FunctionDeclaration`, `FunctionExpression` y `ArrowFunctionExpression` anidadas; las llamadas a esas funciones desde el ámbito exterior sí se extraen.
- Los sitios de llamada/new/llamada opcional/plantilla etiquetada de nivel superior generan `CALL`; los sitios dentro de otro sitio quedan verbatim. `await` produce `ASYNC` y puede producir también `CALL` para la operación directamente esperada.
- Los parámetros producen `INPUT`; se representan valores por defecto y parámetros rest. Los cuerpos concisos de flecha producen un `RET` implícito.
- Condiciones, negación de `else`, `else if` anidado, casos switch y cabeceras de bucle se representan como `COND`; los efectos directos con guarda usan `COND <guarda> -> <efecto>`.
- Return, throw, try/catch/finally, destinos de asignación y llamadas en operandos de bucle siguen las reglas implementadas y probadas.
- Los fragmentos verbatim son cortes del fuente con comentarios blanqueados (preservando offsets) y espacios normalizados a uno.
- Casos `ND` implementados: receptor `this`, callee calculado, destino de asignación desestructurante y `typeof`/`delete` dinámico. No existe marcador `ND NONE`.
- Orden del ensamblador: `INPUT`, `COND`, `CALL`, `ASYNC`, `ERR`, `RET`, `ND`.
- Formas de ausencia: `INPUT NONE`, `COND NONE`, `CALL NONE`, `ASYNC NONE`, `RET NONE`, `ERR NONE` y, cuando corresponde, `ERR NOCATCH`. Un error capturado se representa como `ERR CATCH ...`; un throw explícito sin catch mantiene `ERR THROW ...` y agrega `ERR NOCATCH`.

### 2.3 Ejemplos congelados y decisiones de interpretación

`parseList` está fijado por una prueba de salida ensamblada exacta. `getUser` está fijado por el contenido esperado en la especificación, aunque el orden ensamblado sigue la agrupación normativa E2. El fuente está en `../Cap1.tex` e incluye `throw new Error("id is required")`.

La implementación contiene estas interpretaciones intencionales, registradas en `../fase1_extractor.md`; requieren validación del asesor/responsable del diseño antes de considerarse cambios aprobados a la especificación:

1. **El texto de `NewExpression` omite `new`.** Así se reproduce el texto congelado de `getUser`, `THROW Error("id is required")`, a partir del fuente `throw new Error(...)`, aunque E3 describe contenido verbatim del fuente. Es una regla global de representación del extractor, no una transformación exclusiva de throw.
2. **La agrupación E2 prevalece sobre el orden mostrado para `getUser`.** El orden impreso en §3.3 intercala categorías y contradice E2; `parseList` sí sigue E2. `assembler.ts` implementa E2. El test de `getUser` verifica contenido exacto en orden E2 y registra la discrepancia.
3. **La descomposición de throw/return es asimétrica.** Los argumentos de throw no generan registros `CALL` separados, conforme a la instancia congelada de `getUser`. Los argumentos de return sí se descomponen, incluso en retornos con guarda, para conservar cobertura de llamadas y la relación E4/E7.
4. **La semántica de imports externos se difiere.** `ND external semantics: <ident>` requiere resolver bindings entre módulos, algo que el extractor de fragmentos aislados de Fase 1 no puede hacer. Implementarlo requiere que el contrato de archivos/módulos de Fase 2 lo vuelva determinable y que se apruebe el comportamiento.
5. `catch {}` se representa como `ERR CATCH () -> ...`, ya que la gramática v1.0 no especifica el binding opcional. Confirmar o ajustar si este código entra en el subconjunto.

No “corregir” estas reglas silenciosamente durante la Fase 2. Obtener una decisión, registrarla en `../registro_decisiones.md` y actualizar la especificación técnica y las pruebas si corresponde.

## 3. Verificación y salvedad de cierre de la Fase 1

Resultado registrado: `npm test` **76/76 aprobadas**; `npm run typecheck`, `npm run lint` y `npm run format:check` limpios. Las pruebas incluyen salidas exactas para ambos ejemplos canónicos, marcadores y casos enfocados de extracción.

**Salvedad de aceptación formal:** `../fase1_extractor.md` todavía marca SF1.6 pendiente y especifica una suite dorada separada, escrita a mano, de al menos 40 casos de instancia completa, comando/reporte reproducible y comparación exacta de cadena completa (spec §5). El número de 76 pruebas no demuestra por sí solo que ese entregable distinto esté completo. Se puede continuar con Fase 2 bajo el supuesto de traspaso del usuario; antes de declarar aceptación formal G1/Fase 1, conciliar el seguimiento y producir la suite/reporte especificados o documentar un cambio aprobado del criterio. No modificar casos esperados congelados solo para hacer pasar las pruebas.

## 4. Objetivo y alcance de la Fase 2

Según “Fase 2” de `../plan_implementacion_tres_fases.md` y §§6–8, 14.1–14.2 de la especificación, la Fase 2 implementa la capa de representaciones y generación manteniendo un AST de origen y una identidad coherente por función.

### Incluido

- **B0:** código JavaScript original, sin transformación.
- **B1:** serialización SBT: emisión recursiva de marcadores de apertura y cierre (`<Type ... Type>`); incluir valores de hojas con valor (identificadores, literales y plantillas).
- **B2:** serialización NIT: tuplas planas y secuenciales de campos por nodo `(id, type, value, children)`, sin marcadores de cierre; conservar valores de identificadores/literales.
- Derivar B1 y B2 del **mismo AST** ya parseado para P; no volver a parsear la función por representación.
- Esquema común de entrada/salida para B0/B1/B2/P con ID estable de función, representación identificada y artefactos reproducibles en `repr/{b0,b1,b2,p}/` (o equivalente aprobado).
- Una consigna compartida, una representación por solicitud; proveedor/modelo configurable; carga segura de credenciales; metadatos de solicitud/respuesta.
- Caché cuya clave incluya al menos ID de función, representación y versión congelada del modelo; máximo 3 intentos totales con backoff; errores registrados y reanudables.
- Orquestador que procese una función × una representación por trabajo y permita uso posterior a escala de corpus, sin ejecutar esa evaluación ahora.
- `protocol.json` versionado (o equivalente aprobado) para guardar configuración técnica congelada; nunca incluir secretos.

### Fuera de alcance explícito de este traspaso

No ejecutar el corpus CodeXGLUE completo, hacer llamadas masivas a la API, calcular métricas de tesis, realizar anotación/rúbrica humana, probar hipótesis estadísticas ni redactar resultados experimentales. Una llamada pequeña de integración/piloto requiere autorización explícita y proveedor/modelo aprobado; no debe describirse como evidencia experimental.

## 5. Secuencia de trabajo de Fase 2 (F2.1–F2.8)

| Tarea | Entregable                                      | Criterio principal de aceptación                                                                                     |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F2.1  | Contrato SBT/NIT y fixtures doradas             | Contrato versionado y salidas doradas para anidamiento, hojas, literales/plantillas y campos semánticos.             |
| F2.2  | `src/serializers/sbt.ts`                        | Serialización SBT exacta y determinista según §6, desde el AST seleccionado; fixtures.                               |
| F2.3  | `src/serializers/nit.ts`                        | Tuplas NIT deterministas; IDs secuenciales en preorden y referencias a hijos; fixtures.                              |
| F2.4  | Contrato común de representación/trabajo/salida | B0/B1/B2/P identificadas; ID estable; B1/B2/P derivadas del mismo parse; B0 intacta y rutas de artefactos trazables. |
| F2.5  | Protocolo, solicitud e interfaz de cliente mock | Consigna y parámetros explícitos; sin secretos; API/proveedor real desactivado hasta D6.1.                           |
| F2.6  | Caché, reintentos, errores y metadatos          | Clave de solicitud completa; máximo 3 intentos totales; errores/metadatos persistidos; reanudación segura.           |
| F2.7  | Orquestador                                     | Un trabajo por función × representación; entrada/salida trazables; sin ejecución masiva por defecto.                 |
| F2.8  | Prueba de integración local y documentación     | Flujo B0/B1/B2/P con cliente mock, caché reutilizable y comandos reproducibles; ninguna llamada real por defecto.    |

Orden aplicado: F2.1, F2.2–F2.3, F2.4–F2.7 y F2.8. Mantener convenciones del repositorio: TypeScript, nombres de código/archivos en inglés, TSDoc, Node test runner, ESLint y Prettier. Estado de cierre y compuertas pendientes: `../plan_implementacion_tres_fases.md`, sección Fase 2; documentación operativa: `docs/phase2.md`.

## 6. Detalles de protocolo fijados y compuertas pendientes

### Fijados por la propuesta actual (sujetos a validación del asesor)

- Cuatro representaciones: B0 código, B1 SBT, B2 NIT, P JS-SemDocIR. Preorden no es condición experimental; P+ y una condición experimental CodeT5 se difieren/excluyen.
- La consigna inglesa exacta de §7 se comparte entre representaciones:

  > You are given a JavaScript function represented in a structured textual format. Write a concise documentation comment (2 to 4 sentences) for the function: state what it does with its inputs, the main conditions it checks, the operations it performs, how it handles errors, and what it returns. Do not speculate about behavior that is not represented in the input. Output only the comment text.

- Decodificación propuesta: temperatura `0`, documentar `top_p` por defecto del proveedor, `max_tokens: 128`, una generación por función/representación, registrar semilla del proveedor si existe.
- Política de reintento: máximo 3 intentos totales con backoff. Registrar fallos persistentes y, en un experimento futuro, tratarlos simétricamente en las cuatro condiciones (§14.6).
- La clave de caché incluye ID de función, representación y versión del modelo. Guardar prompt/configuración/versión, fecha, uso de tokens, latencia, respuesta y errores disponibles.
- El filtro de ventana usa la representación más larga B1; no está activo en `filter.ts` y depende de la ventana del modelo y de implementar B1.

### Mantener configurable o bloqueado hasta resolver

- **Validación del asesor:** `../registro_decisiones.md` marca D1–D7, E1–E9, Δ=0.5 y D6.1/congelamiento del modelo pendientes. No considerar la propuesta v1.0 aprobada por el asesor solo porque exista código.
- **Proveedor y versión fechada exacta:** elegir considerando ventana suficiente para el B1 admitido más largo, soporte de temperatura, identificador versionable/congelable, precio y presupuesto. Registrar proveedor, versión exacta, fecha de congelamiento y fecha de corte de API. Aquí no se elige modelo final.
- **Piloto y gasto de API:** la especificación propone un piloto de 30–50 funciones para validar respuestas válidas/no vacías y repetibilidad, seguido del congelamiento D6.1. El piloto y cualquier uso de API externa requieren autorización explícita. No introducir secretos ni solicitudes pagadas implícitamente.
- **Dataset y ejecución experimental:** versión/fecha CodeXGLUE, semillas y conteos de exclusión por corpus/ventana se resuelven en configuración posterior; este documento no autoriza descargar ni procesar el corpus completo.
- **Conflictos de especificación:** resolver los puntos interpretativos de §2.3 antes de afirmar conformidad total. Los cambios requieren registro trazable y actualización correspondiente de especificación/Cap4/pruebas.

## 7. Estructura de repositorio sugerida para Fase 2

Adaptar nombres si hace falta, preservando contratos y documentando la decisión:

```text
src/
  serializers/
    sbt.ts
    nit.ts
  representations.ts       # common representation identifiers/contracts
  request.ts               # prompt + representation payload assembly
  client/                   # provider adapter, auth/config, cache, retries
  orchestrator.ts           # one function × one representation
repr/
  b0/
  b1/
  b2/
  p/
protocol.json               # approved, non-secret frozen protocol
```

No crear todos estos archivos por anticipado sin una tarea concreta. Mantener fuera del control de versiones las salidas de corpus, credenciales, cachés y datos experimentales grandes, salvo que el protocolo aprobado exija versionarlos.

## 8. Comandos y convenciones actuales

Desde este directorio:

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run format:check
```

`package.json` pins Node `>=24`, `@babel/parser@8.0.7`, TypeScript `5.9.3`, and the current lint/format toolchain. Use exact dependency versions for protocol-sensitive parser/model components. Existing pipeline usage is:

```ts
const ast = parseFunction(source);
const admission = filter(ast);
if (admission.admitted) {
  const p = assemble(extractFunction(source, ast));
}
```

El filtro está separado de `extractFunction`; no extraer unidades rechazadas. B1/B2 deben consumir la misma instancia `ast` aceptada, sin volver a parsear el fuente.

## 9. Repositorio y procedencia

Procedencia registrada al terminar la Fase 1: remoto GitHub `https://github.com/juanhuamani/Js-SemdocIr`, rama `main`; último commit registrado `7d49cd8` (`Document project pipeline`), con `README.md` e `images/pipeline.png`. Volver a comprobar `git status` y la rama remota antes de modificar para Fase 2: este traspaso refleja el último estado conocido, no una garantía en tiempo real.

## 10. Criterios de cierre de Fase 2

La Fase 2 se considera completa solo cuando:

1. B1 y B2 sean serializadores deterministas y probados sobre el mismo AST, y todos los artefactos B0/B1/B2/P puedan identificarse consistentemente.
2. Prompt/configuración y proveedor/versión estén explícitos, o el cliente real permanezca desactivado de forma segura hasta aprobar D6.1.
3. Caché, reintentos acotados, tratamiento de errores y metadatos de solicitud/respuesta permitan reproducibilidad y reanudación segura.
4. El orquestador procese una función × representación y las pruebas de integración pasen sin exponer secretos.
5. Comandos, configuración, esquema de artefactos, limitaciones y desviaciones de la propuesta estén documentados.
6. No se afirme que la ejecución del corpus experimental, métricas, rúbrica o análisis de hipótesis formen parte de la implementación de Fase 2.

## 11. Primeros pasos de la siguiente sesión de implementación

- Releer §§6–8 y 14 de `../especificacion_propuesta.md` y las decisiones no resueltas en `../registro_decisiones.md`.
- Confirmar si el asesor resolvió las decisiones pendientes; si no, mantener contratos deterministas de serializadores, pero no elegir un modelo pagado ni realizar llamadas reales a API.
- Inspeccionar el estado Git y ejecutar los cuatro comandos de §8 antes de cambiar código.
- Empezar con un conjunto pequeño de fixtures AST escritos a mano para SBT/NIT, definiendo salida exacta y convenciones estables de nodos/hijos antes de construir serializadores.
- Decidir y registrar contrato de IDs de función y rutas de artefactos antes de introducir caché/orquestación.
- Mantener visible la salvedad formal SF1.6/G1 de Fase 1; cerrarla con suite/reporte reproducible de ≥40 instancias completas o enmendar formalmente el criterio de aceptación.

---

**Estado del traspaso:** por indicación del usuario, la Fase 1 se asume completa para continuar con la Fase 2. La aprobación de especificación, el congelamiento del modelo exacto, la autorización de piloto/API y la salvedad formal de evidencia SF1.6 siguen siendo compuertas explícitas. Este estado no implica aprobación de decisiones de tesis pendientes ni autorización para ejecutar el experimento.
