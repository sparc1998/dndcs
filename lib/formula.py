"""Formula validation utilities used at startup to check loaded character data."""

import ast
import re
from typing import Any

# All bio fields that can be referenced by a formula ($bio.<field>).
# KEEP IN SYNC: add any new bio field from index.html here so it is a valid reference target.
_BIO_FIELDS: frozenset[str] = frozenset(
    {
        "player_name",
        "character_name",
        "class",
        "subclass",
        "race",
        "background",
        "alignment",
        "age",
        "height",
        "weight",
        "size_category",
        "eyes",
        "hair",
        "skin",
        "personality_traits",
        "ideals",
        "bonds",
        "traits",
        "background_history",
        "level",
        "hd",
        "experience",
    }
)

# All money fields that can be referenced by a formula ($money.<field>).
_MONEY_FIELDS: frozenset[str] = frozenset({"pp", "gp", "ep", "sp", "cp"})

# Stats fields that are formula fields ($stats.<field>).
_STATS_FORMULA_FIELDS: frozenset[str] = frozenset(
    {
        "proficiency_bonus",
        "save_bonus",
        "str_val",
        "dex_val",
        "con_val",
        "int_val",
        "wis_val",
        "cha_val",
    }
)

# Full set of valid reference targets ("section.field").
ALL_FIELD_IDS: frozenset[str] = frozenset(
    {f"bio.{f}" for f in _BIO_FIELDS}
    | {f"money.{f}" for f in _MONEY_FIELDS}
    | {f"stats.{f}" for f in _STATS_FORMULA_FIELDS}
)

# Formula fields that participate in the dependency graph (can be referenced by other formulas).
# KEEP IN SYNC: add any new field that has data-field-render="formula" in index.html here,
# and also add it to the node_candidates list in validate_all_formulas() below.
FORMULA_NODE_IDS: frozenset[str] = frozenset(
    {"bio.experience", "bio.level"}
    | {f"money.{f}" for f in _MONEY_FIELDS}
    | {f"stats.{f}" for f in _STATS_FORMULA_FIELDS}
)

_REF_RE = re.compile(r"\$([a-z_]+)\.([a-z_]+)")
_COMMENT_RE = re.compile(r"\{[^}]*\}")


def _strip_comments(formula: str) -> str:
    return _COMMENT_RE.sub("", formula)


def _parse_refs(formula: str) -> list[tuple[str, str]]:
    return _REF_RE.findall(formula)


def _valid_syntax(raw: str) -> bool:
    expr = _strip_comments(raw)
    expr = _REF_RE.sub("1", expr).strip()
    if not expr:
        return True
    if not re.fullmatch(r"[\d\s+\-*/().]+", expr):
        return False
    try:
        tree = ast.parse(expr, mode="eval")
        for node in ast.walk(tree):
            if not isinstance(
                node,
                (
                    ast.Expression,
                    ast.BinOp,
                    ast.UnaryOp,
                    ast.Constant,
                    ast.Add,
                    ast.Sub,
                    ast.Mult,
                    ast.Div,
                    ast.FloorDiv,
                    ast.Mod,
                    ast.Pow,
                    ast.UAdd,
                    ast.USub,
                ),
            ):
                return False
        result = eval(compile(tree, "<formula>", "eval"))  # noqa: S307
        return isinstance(result, (int, float)) and result == result  # not NaN
    except Exception:
        return False


def _path_exists(depends_on: dict[str, list[str]], start: str, target: str) -> bool:
    visited: set[str] = set()
    stack = [start]
    while stack:
        curr = stack.pop()
        if curr in visited:
            continue
        visited.add(curr)
        for neighbor in depends_on.get(curr, []):
            if neighbor == target:
                return True
            stack.append(neighbor)
    return False


def validate_all_formulas(character: dict[str, Any]) -> list[str]:
    """Return a list of validation error strings; empty list means all formulas are valid."""
    errors: list[str] = []
    edges: list[tuple[str, str]] = []

    bio = character.get("bio") or {}
    money = character.get("money") or {}
    stats = character.get("stats") or {}

    # Validate formula nodes (bio.level, bio.experience, money.*, and stats formula fields)
    node_candidates: list[tuple[str, str, str]] = (
        [
            ("bio", "level", bio.get("level", "")),
            ("bio", "experience", bio.get("experience", "")),
        ]
        + [("money", f, money.get(f, "")) for f in ("pp", "gp", "ep", "sp", "cp")]
        + [("stats", f, stats.get(f, "")) for f in sorted(_STATS_FORMULA_FIELDS)]
    )

    for section, field, raw in node_candidates:
        if not raw:
            continue
        node_id = f"{section}.{field}"
        if not _valid_syntax(raw):
            errors.append(f"{node_id}: invalid formula syntax: {raw!r}")
            continue
        for s, f2 in _parse_refs(raw):
            ref_id = f"{s}.{f2}"
            if ref_id not in ALL_FIELD_IDS:
                errors.append(f"{node_id}: unknown field reference: ${s}.{f2}")
            elif ref_id not in FORMULA_NODE_IDS:
                errors.append(f"{node_id}: formulas can only reference formula fields: ${s}.{f2}")
            else:
                edges.append((node_id, ref_id))

    # Validate gear item weights (syntax and reference existence only; no cycle check)
    for i, item in enumerate(character.get("gear") or []):
        raw = item.get("weight", "")
        if not raw:
            continue
        if not _valid_syntax(raw):
            errors.append(f"gear[{i}].weight: invalid formula syntax: {raw!r}")
            continue
        for s, f2 in _parse_refs(raw):
            ref_id = f"{s}.{f2}"
            if ref_id not in ALL_FIELD_IDS:
                errors.append(f"gear[{i}].weight: unknown field reference: ${s}.{f2}")
            elif ref_id not in FORMULA_NODE_IDS:
                errors.append(
                    f"gear[{i}].weight: formulas can only reference formula fields: ${s}.{f2}"
                )

    if errors:
        return errors

    # Cycle detection for formula nodes using Kahn-style incremental edge addition
    depends_on: dict[str, list[str]] = {}
    for u, v in edges:
        if u == v:
            errors.append(f"Formula cycle: {u} references itself")
            continue
        if _path_exists(depends_on, v, u):
            errors.append(f"Formula cycle: {u} and {v} form a dependency cycle")
            continue
        depends_on.setdefault(u, []).append(v)

    return errors
