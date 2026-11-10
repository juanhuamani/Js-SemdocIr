"""Bootstrap pareado por función entre dos condiciones.

Uso:
    python paired_bootstrap.py --metrics experimento/metricas --against p

Lee bleu.jsonl, bertscore.jsonl y rouge.jsonl del directorio, aparea por id y
calcula la diferencia media con su intervalo del 95 % por remuestreo. La unidad
es la función, no la llamada: cada función aporta un par de valores.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

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


def bootstrap(
    differences: np.ndarray, resamples: int, confidence: float, rng: np.random.Generator
) -> tuple[float, float]:
    means = np.empty(resamples, dtype=np.float64)
    chunk = 500
    for start in range(0, resamples, chunk):
        size = min(chunk, resamples - start)
        picks = rng.integers(0, differences.size, size=(size, differences.size))
        means[start : start + size] = differences[picks].mean(axis=1)
    means.sort()
    tail = (1 - confidence) / 2
    return float(means[int(tail * resamples)]), float(means[int((1 - tail) * resamples)])


def report(
    name: str,
    data: dict[str, dict[str, float]],
    against: str,
    resamples: int,
    rng: np.random.Generator,
    descriptive: bool = False,
) -> None:
    ids = [key for key, row in data.items() if len(row) == len(CONDITIONS)]
    if not ids:
        print(f"{name}: sin datos evaluables")
        return
    label = f"{name} (n = {len(ids)})"
    if descriptive:
        label += " — descriptivo, sin prueba"
    print(f"\n{label}")
    print(f"{'comparison':<12}{'media':>9}{'IC 95 %':>26}  veredicto")
    for condition in CONDITIONS:
        if condition == against:
            continue
        differences = np.array(
            [data[key][condition] - data[key][against] for key in ids], dtype=np.float64
        )
        mean = float(differences.mean())
        low, high = bootstrap(differences, resamples, 0.95, rng)
        verdict = "diferencia" if (low > 0 or high < 0) else "sin diferencia"
        print(f"{condition + ' − ' + against:<12}{mean:>9.4f}   [{low:+.4f}, {high:+.4f}]  {verdict}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", type=Path, default=Path("experimento/metricas"))
    parser.add_argument("--variant", default="", help="sufijo del archivo, p. ej. '-normalized'")
    parser.add_argument("--against", default="p", choices=CONDITIONS)
    parser.add_argument("--resamples", type=int, default=10_000)
    args = parser.parse_args()

    rng = np.random.default_rng(20261105)
    report("BLEU-4", load(args.metrics / f"bleu{args.variant}.jsonl", "bleu"), args.against, args.resamples, rng)
    report(
        "BERTScore F1",
        load(args.metrics / f"bertscore{args.variant}.jsonl", "f1"),
        args.against,
        args.resamples,
        rng,
    )
    report(
        "ROUGE-L",
        load(args.metrics / f"rouge{args.variant}.jsonl", "f1"),
        args.against,
        args.resamples,
        rng,
        descriptive=True,
    )


if __name__ == "__main__":
    main()
