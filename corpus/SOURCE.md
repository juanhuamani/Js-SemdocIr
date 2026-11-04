---
title: 'Procedencia del corpus experimental'
status: draft
updated: 2026-11-04
---

# Procedencia del corpus experimental

Responde una sola pregunta: **¿de dónde sale exactamente `corpus/raw.jsonl` y cómo se reproduce?**

Los datos viven fuera de git (`.gitignore` excluye `corpus/*` salvo este archivo): son de terceros y son grandes. Este documento, en cambio, se versiona porque es la evidencia de procedencia.

## Fuente

| Pieza               | Valor                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset             | CodeXGLUE, tarea Code-Text / code-to-text, partición `test` de JavaScript                                                                    |
| Repositorio         | `microsoft/CodeXGLUE`                                                                                                                        |
| Commit fijado       | `b8590790716d3251a6950e860cd43fd82f5a35a6` (2023-04-24)                                                                                      |
| Índice de URLs      | `Code-Text/code-to-text/dataset.zip` — 12 396 864 bytes, sha256 `31ec750805302ecd71b278a492d23d2ac916269f7ec645bba4f23b6f7c4bf217`           |
| Archivo de datos    | CodeSearchNet JavaScript en Zenodo, registro 7857872 — 1 664 713 350 bytes, md5 `7649178a02f7b5c8fbccb64abe7946b6`                           |
| Funciones esperadas | 3 291 (tabla del README oficial)                                                                                                             |
| Licencia            | CodeXGLUE: MIT. Datos: `Data_LICENCE` del repositorio (CC0 1.0). El código de cada función conserva la licencia de su repositorio de origen. |

CodeXGLUE no publica la partición procesada. La ruta oficial es: `dataset.zip` trae, por lenguaje, un `.txt` con **una URL por línea**; el zip de Zenodo trae CodeSearchNet crudo (todas las particiones); el `preprocess.py` del propio CodeXGLUE cruza ambos por el campo `url`. `scripts/fetch-corpus.mjs` reproduce esa intersección sin ejecutar Python y escribe las filas en el orden del índice.

## Reproducción

```shell
node scripts/fetch-corpus.mjs
```

Descarga los dos archivos a `.cache/corpus-src/`, verifica el tamaño y el digest de cada uno, extrae solo las particiones `javascript/final/jsonl/test/*.jsonl.gz`, cruza por `url` y escribe:

| Artefacto              | Contenido                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `corpus/raw.jsonl`     | 3 291 funciones, una por línea, campos originales de CodeSearchNet (`repo`, `path`, `func_name`, `code`, `docstring`, `url`, …) |
| `corpus/raw.sha256`    | digest del corpus congelado                                                                                                     |
| `corpus/download.json` | URL, commit, tamaños, digests y fecha de descarga                                                                               |

Si el conteo no da 3 291 o falta alguna URL del índice, el script falla y no escribe el corpus.

## Qué no se hace aquí

- No se filtra por admisibilidad: eso es S1 (`scripts/prepare-corpus.mjs`) y su resultado es `corpus/admitido.jsonl` + `corpus/exclusiones.csv`.
- No se muestrea: la semilla única del protocolo es 42 y se aplica en S5 y en la rúbrica (§11.2).
- No se versiona ningún texto del corpus, solo sus digests.
