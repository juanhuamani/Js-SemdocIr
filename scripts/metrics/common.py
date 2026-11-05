"""Utilidades compartidas por los scripts de métricas."""

from __future__ import annotations

import json
from pathlib import Path


def normalize_reference(text: str) -> str:
    """Regla E-2: quita líneas de etiqueta, descarta vacías y colapsa espacios."""
    kept: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("@") or stripped.startswith("*"):
            continue
        kept.append(" ".join(stripped.split()))
    normalized = " ".join(kept).strip()
    return normalized if normalized else " ".join(text.split()).strip()


def load_references(corpus_path: Path, variant: str) -> dict[str, str]:
    """Devuelve id -> referencia cruda o normalizada."""
    references: dict[str, str] = {}
    with corpus_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            raw = (record.get("docstring") or "").strip()
            references[record["id"]] = normalize_reference(raw) if variant == "normalized" else raw
    return references


def load_outputs(experiment_path: Path) -> list[dict]:
    """Devuelve las filas exitosas de la corrida, en orden."""
    rows: list[dict] = []
    with experiment_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("status") == "succeeded" and (row.get("output") or "").strip():
                rows.append(row)
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
