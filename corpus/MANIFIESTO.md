---
title: 'Manifiesto del corpus congelado'
status: draft
updated: 2026-11-04
---

# Manifiesto del corpus congelado

Responde una sola pregunta: **¿qué bytes exactos componen el corpus de la corrida y cómo se comprueba que no cambiaron?**

Procedencia y licencia: `SOURCE.md`. Decisiones que lo fijan: D1.1-D1.3 y D4.1 en `../../docs/10-protocolo/decisiones.md`.

## Artefactos

| Archivo                      |               Filas |      Bytes | sha256                                                             |
| ---------------------------- | ------------------: | ---------: | ------------------------------------------------------------------ |
| `corpus/raw.jsonl`           |               3 291 | 10 352 283 | `abaff6057a9c4c20fb5363b8d9346fc26452e28cf373c354e65a13867ad89440` |
| `corpus/admitido.jsonl`      |               2 056 |  5 902 622 | `e85a9377fa9baee857d1799c7a3c319b9856cb4c4f1e09f43ef287d225f28a49` |
| `corpus/exclusiones.csv`     | 1 235 (+1 cabecera) |    244 758 | `e22b1c5bc5716f8e99cd509a8ba420e24026854cd2329806632953c3ca4de6b0` |
| `corpus/funciones.csv`       | 3 291 (+1 cabecera) |    657 194 | —                                                                  |
| `corpus/caracterizacion.csv` | 2 056 (+1 cabecera) |     81 204 | `56807040714e570656ba7425c8cb1284c86694a8ee34daffd4b3ef418a193e56` |
| `corpus/muestra-rubrica.csv` |   100 (+1 cabecera) |      1 511 | `b6f416fd4df7121bb708baa62066e2d943a3a5f9897795c17e80fbbbdfd59d0d` |
| `corpus/ast/`                |      2 056 archivos |          — | derivado                                                           |
| `corpus/repr/{b0,b1,b2,p}/`  |      8 224 archivos |          — | derivado                                                           |

Fuente: índice sha256 `31ec7508…7c4bf217`; archivo md5 `7649178a02f7b5c8fbccb64abe7946b6`, sha256 `fdc743f5…062936dd`.

## Parámetros congelados

| Parámetro         | Valor                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| Semilla única     | 42                                                                                    |
| Parser            | `@babel/parser` 8.0.7, `sourceType: unambiguous`, sin plugins, `errorRecovery: false` |
| Tokenizador       | pendiente de la ratificación del modelo (longitudes en caracteres y bytes)            |
| Guarda de ventana | inactiva por parámetro; el máximo de B1 es 56 723 caracteres                          |

## Reproducción

```shell
npm run corpus
```

Comprueba digests, descarga lo que falte, extrae, filtra, construye y caracteriza. Dos ejecuciones consecutivas produjeron **los cinco hashes idénticos** (verificado el 04-11-2026). Si un digest difiere, la corrida no es comparable y se registra como desviación.
