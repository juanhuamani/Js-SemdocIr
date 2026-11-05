"""BLEU-4 suavizado, por corpus y por función, contra la referencia elegida."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import sacrebleu

from common import load_outputs, load_references, write_jsonl


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=Path("corpus/admitido.jsonl"))
    parser.add_argument("--variant", choices=["raw", "normalized"], default="raw")
    parser.add_argument("--out", type=Path, default=Path("experimento/metricas/bleu.jsonl"))
    args = parser.parse_args()

    references = load_references(args.corpus, args.variant)
    rows = load_outputs(args.experiment)

    by_representation: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        reference = references.get(row["id"])
        if not reference:
            continue
        sentence = sacrebleu.sentence_bleu(
            row["output"], [reference], smooth_method="exp", tokenize="13a"
        )
        by_representation[row["representation"]].append(
            {"id": row["id"], "representation": row["representation"], "bleu": sentence.score}
        )

    scored = [item for group in by_representation.values() for item in group]
    write_jsonl(args.out, scored)

    print(f"variante de referencia: {args.variant}")
    print(f"{'cond.':<5}{'n':>6}{'BLEU corpus':>14}{'BLEU medio':>13}")
    for representation in ["b0", "b1", "b2", "p"]:
        group = by_representation.get(representation, [])
        if not group:
            continue
        hypotheses = [row["output"] for row in rows if row["representation"] == representation]
        refs = [references[row["id"]] for row in rows if row["representation"] == representation]
        corpus_score = sacrebleu.corpus_bleu(
            hypotheses, [refs], smooth_method="exp", tokenize="13a"
        ).score
        mean = sum(item["bleu"] for item in group) / len(group)
        print(f"{representation:<5}{len(group):>6}{corpus_score:>14.2f}{mean:>13.2f}")


if __name__ == "__main__":
    main()
