"""BERTScore (roberta-large, recalibrado) por función y por condición."""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path

import torch
from bert_score import score as bert_score

from common import load_outputs, load_references, write_jsonl


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=Path("corpus/admitido.jsonl"))
    parser.add_argument("--variant", choices=["raw", "normalized"], default="raw")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--out", type=Path, default=Path("experimento/metricas/bertscore.jsonl"))
    args = parser.parse_args()

    references = load_references(args.corpus, args.variant)
    rows = [row for row in load_outputs(args.experiment) if references.get(row["id"])]
    if not rows:
        raise SystemExit("No hay salidas evaluables en el archivo indicado.")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"calculando BERTScore en {device} sobre {len(rows)} salidas…")

    precision, recall, f1 = bert_score(
        [row["output"] for row in rows],
        [references[row["id"]] for row in rows],
        lang="en",
        model_type="roberta-large",
        rescale_with_baseline=True,
        batch_size=args.batch_size,
        device=device,
        verbose=False,
    )

    scored = [
        {
            "id": row["id"],
            "representation": row["representation"],
            "precision": float(precision[index]),
            "recall": float(recall[index]),
            "f1": float(f1[index]),
        }
        for index, row in enumerate(rows)
    ]
    write_jsonl(args.out, scored)

    by_representation: dict[str, list[float]] = defaultdict(list)
    for item in scored:
        by_representation[item["representation"]].append(item["f1"])

    print(f"variante de referencia: {args.variant}")
    print(f"{'cond.':<5}{'n':>6}{'F1 medio':>11}")
    for representation in ["b0", "b1", "b2", "p"]:
        values = by_representation.get(representation, [])
        if values:
            print(f"{representation:<5}{len(values):>6}{sum(values) / len(values):>11.4f}")

    # torch 2.15 cierra con código 1 en Windows después de liberar el modelo;
    # el cálculo ya terminó y el archivo está escrito.
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
