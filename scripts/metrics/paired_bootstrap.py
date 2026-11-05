"""Bootstrap pareado por función entre dos condiciones.

Uso:
    python paired_bootstrap.py --metrics experimento/metricas --against p

Lee bleu.jsonl y bertscore.jsonl del directorio, aparea por id y calcula la
diferencia media con su intervalo del 95 % por remuestreo. La unidad es la
función, no la llamada: cada función aporta un par de valores.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

CONDITIONS = ["b0", "b1", "b2", "p"]


def load(path: Path, field: str) -> dict[str, dict[str, float]]:
    values: dict[str, dict[str, float]] = defaultdict(dict)
    if not path.exists():
        return values
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            values[row["id"]][row["representation"]] = row[field]
    return values


def bootstrap(differences: list[float], resamples: int, confidence: float) -> tuple[float, float]:
    means = sorted(
        sum(random.choice(differences) for _ in differences) / len(differences)
        for _ in range(resamples)
    )
    tail = (1 - confidence) / 2
    return means[int(tail * resamples)], means[int((1 - tail) * resamples)]


def report(name: str, data: dict[str, dict[str, float]], against: str, resamples: int) -> None:
    ids = [key for key, row in data.items() if len(row) == len(CONDITIONS)]
    if not ids:
        print(f"{name}: sin datos evaluables")
        return
    print(f"\n{name} (n = {len(ids)})")
    print(f"{'comparison':<12}{'media':>9}{'IC 95 %':>26}  veredicto")
    for condition in CONDITIONS:
        if condition == against:
            continue
        differences = [data[key][condition] - data[key][against] for key in ids]
        mean = sum(differences) / len(differences)
        low, high = bootstrap(differences, resamples, 0.95)
        verdict = "diferencia" if (low > 0 or high < 0) else "sin diferencia"
        print(f"{condition + ' − ' + against:<12}{mean:>9.4f}   [{low:+.4f}, {high:+.4f}]{'':>6}{verdict}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", type=Path, default=Path("experimento/metricas"))
    parser.add_argument("--variant", default="", help="sufijo del archivo, p. ej. '-normalized'")
    parser.add_argument("--against", default="p", choices=CONDITIONS)
    parser.add_argument("--resamples", type=int, default=10_000)
    args = parser.parse_args()

    random.seed(20261105)
    report("BLEU-4", load(args.metrics / f"bleu{args.variant}.jsonl", "bleu"), args.against, args.resamples)
    report(
        "BERTScore F1",
        load(args.metrics / f"bertscore{args.variant}.jsonl", "f1"),
        args.against,
        args.resamples,
    )


if __name__ == "__main__":
    main()
