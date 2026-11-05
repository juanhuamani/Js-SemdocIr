"""ROUGE-L (con stemming) por función y por condición.

Métrica descriptiva: no sostiene pruebas de hipótesis (ver enmienda E-2 y guía
de métricas en el plan del experimento).
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from rouge_score import rouge_scorer

from common import load_outputs, load_references, write_jsonl


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=Path("corpus/admitido.jsonl"))
    parser.add_argument("--variant", choices=["raw", "normalized"], default="raw")
    parser.add_argument("--out", type=Path, default=Path("experimento/metricas/rouge.jsonl"))
    args = parser.parse_args()

    references = load_references(args.corpus, args.variant)
    rows = [row for row in load_outputs(args.experiment) if references.get(row["id"])]
    if not rows:
        raise SystemExit("No hay salidas evaluables en el archivo indicado.")

    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    scored = []
    for row in rows:
        score = scorer.score(references[row["id"]], row["output"])["rougeL"]
        scored.append(
            {
                "id": row["id"],
                "representation": row["representation"],
                "precision": score.precision,
                "recall": score.recall,
                "f1": score.fmeasure,
            }
        )
    write_jsonl(args.out, scored)

    by_representation: dict[str, list[float]] = defaultdict(list)
    for item in scored:
        by_representation[item["representation"]].append(item["f1"])

    print(f"variante de referencia: {args.variant}")
    print(f"{'cond.':<5}{'n':>6}{'ROUGE-L':>10}")
    for representation in ["b0", "b1", "b2", "p"]:
        values = by_representation.get(representation, [])
        if values:
            print(f"{representation:<5}{len(values):>6}{sum(values) / len(values):>10.4f}")


if __name__ == "__main__":
    main()
