"""Unit tests for the formula validation module."""

from lib.formula import validate_all_formulas


def _char(bio=None, money=None, gear=None, stats=None):
    return {
        "bio": bio or {},
        "money": money or {},
        "gear": gear or [],
        "stats": stats or {},
    }


# ── Valid formulas ─────────────────────────────────────────────────────────


def test_valid_plain_numbers():
    assert validate_all_formulas(_char(bio={"experience": "23000"}, money={"gp": "47"})) == []


def test_valid_arithmetic():
    assert validate_all_formulas(_char(bio={"experience": "100 + 200 * 3"})) == []


def test_valid_formula_with_comment():
    assert validate_all_formulas(_char(money={"gp": "10 {starting gold} + 5"})) == []


def test_empty_fields_are_skipped():
    assert validate_all_formulas(_char(bio={"experience": ""}, money={"gp": ""})) == []


def test_valid_cross_reference_bio_to_bio():
    char = _char(bio={"experience": "23000", "level": "7"})
    # experience references level (level is not a formula node, just a raw field)
    assert validate_all_formulas(char) == []


def test_valid_cross_reference_money_to_bio():
    char = _char(bio={"level": "7"}, money={"gp": "$bio.level * 100"})
    assert validate_all_formulas(char) == []


def test_valid_cross_reference_formula_to_formula():
    char = _char(money={"pp": "10", "gp": "$money.pp + 5"})
    assert validate_all_formulas(char) == []


def test_valid_gear_weight_formula():
    gear = [{"gear_type": "General", "description": "Sword", "location": "belt", "weight": "3 + 2"}]
    assert validate_all_formulas(_char(gear=gear)) == []


def test_valid_gear_weight_cross_reference():
    gear = [{"gear_type": "General", "description": "Sword", "location": "belt", "weight": "$bio.level * 2"}]
    char = _char(bio={"level": "7"}, gear=gear)
    assert validate_all_formulas(char) == []


def test_valid_bio_level_formula():
    assert validate_all_formulas(_char(bio={"level": "5 + 2"})) == []


def test_valid_experience_references_level_formula_node():
    char = _char(bio={"level": "7", "experience": "$bio.level * 1000"})
    assert validate_all_formulas(char) == []


def test_bio_level_self_reference_cycle():
    errors = validate_all_formulas(_char(bio={"level": "$bio.level + 1"}))
    assert any("cycle" in e.lower() for e in errors)


def test_bio_level_and_experience_cycle():
    char = _char(bio={"level": "$bio.experience + 1", "experience": "$bio.level * 1000"})
    errors = validate_all_formulas(char)
    assert any("cycle" in e.lower() for e in errors)


# ── Syntax errors ──────────────────────────────────────────────────────────


def test_invalid_syntax_letters():
    errors = validate_all_formulas(_char(bio={"experience": "abc"}))
    assert any("syntax" in e for e in errors)


def test_invalid_syntax_bio_level():
    errors = validate_all_formulas(_char(bio={"level": "abc"}))
    assert any("syntax" in e for e in errors)


def test_invalid_syntax_incomplete_expression():
    errors = validate_all_formulas(_char(bio={"experience": "10 +"}))
    assert any("syntax" in e for e in errors)


def test_invalid_syntax_gear_weight():
    gear = [{"gear_type": "General", "description": "X", "location": "bag", "weight": "??"}]
    errors = validate_all_formulas(_char(gear=gear))
    assert any("syntax" in e for e in errors)


# ── Unknown reference errors ───────────────────────────────────────────────


def test_unknown_bio_reference():
    errors = validate_all_formulas(_char(bio={"experience": "$bio.nonexistent + 1"}))
    assert any("nonexistent" in e for e in errors)


def test_non_formula_field_reference_in_bio():
    errors = validate_all_formulas(_char(bio={"experience": "$bio.race + 1"}))
    assert any("formula fields" in e for e in errors)


def test_non_formula_field_reference_in_gear_weight():
    gear = [{"gear_type": "General", "description": "X", "location": "bag", "weight": "$bio.race + 1"}]
    errors = validate_all_formulas(_char(gear=gear))
    assert any("formula fields" in e for e in errors)


def test_unknown_section_reference():
    errors = validate_all_formulas(_char(money={"gp": "$items.sword_count"}))
    assert any("items" in e for e in errors)


def test_unknown_reference_in_gear_weight():
    gear = [{"gear_type": "General", "description": "X", "location": "bag", "weight": "$bio.badfield"}]
    errors = validate_all_formulas(_char(gear=gear))
    assert any("badfield" in e for e in errors)


# ── Cycle detection ────────────────────────────────────────────────────────


def test_self_reference_cycle():
    errors = validate_all_formulas(_char(money={"gp": "$money.gp + 1"}))
    assert any("cycle" in e.lower() for e in errors)


def test_direct_cycle_two_nodes():
    char = _char(money={"gp": "$money.ep + 1", "ep": "$money.gp + 1"})
    errors = validate_all_formulas(char)
    assert any("cycle" in e.lower() for e in errors)


def test_indirect_cycle_three_nodes():
    char = _char(money={"pp": "$money.gp + 1", "gp": "$money.ep + 1", "ep": "$money.pp + 1"})
    errors = validate_all_formulas(char)
    assert any("cycle" in e.lower() for e in errors)


def test_no_cycle_linear_chain():
    char = _char(money={"pp": "10", "gp": "$money.pp + 5", "ep": "$money.gp + 3"})
    assert validate_all_formulas(char) == []


# ── Stats formula fields ───────────────────────────────────────────────────


def test_valid_stats_plain_number():
    assert validate_all_formulas(_char(stats={"proficiency_bonus": "3"})) == []


def test_valid_stats_cross_reference():
    assert validate_all_formulas(_char(stats={
        "proficiency_bonus": "3",
        "save_bonus": "$stats.proficiency_bonus + 2",
    })) == []


def test_invalid_stats_formula_syntax():
    errors = validate_all_formulas(_char(stats={"proficiency_bonus": "abc"}))
    assert any("syntax" in e for e in errors)


def test_stats_formula_self_reference_cycle():
    errors = validate_all_formulas(_char(stats={"proficiency_bonus": "$stats.proficiency_bonus + 1"}))
    assert any("cycle" in e.lower() for e in errors)


def test_stats_unknown_reference():
    errors = validate_all_formulas(_char(stats={"proficiency_bonus": "$stats.nonexistent + 1"}))
    assert any("nonexistent" in e for e in errors)


def test_stats_non_formula_reference_rejected():
    errors = validate_all_formulas(_char(stats={"proficiency_bonus": "$bio.race + 1"}))
    assert any("formula fields" in e for e in errors)


# ── Ability val formula fields ────────────────────────────────────────────


def test_valid_attr_val_plain_numbers():
    assert validate_all_formulas(_char(stats={
        "str": "16", "dex": "14", "con": "15",
        "int": "10", "wis": "12", "cha": "8",
    })) == []


def test_valid_attr_val_formula():
    assert validate_all_formulas(_char(stats={"str": "10 + 6"})) == []


def test_invalid_attr_val_syntax():
    errors = validate_all_formulas(_char(stats={"dex": "abc"}))
    assert any("syntax" in e for e in errors)


def test_attr_val_self_reference_cycle():
    errors = validate_all_formulas(_char(stats={"con": "$stats.con + 1"}))
    assert any("cycle" in e.lower() for e in errors)


def test_attr_val_cross_reference_to_proficiency():
    assert validate_all_formulas(_char(stats={
        "proficiency_bonus": "3",
        "str": "$stats.proficiency_bonus * 2",
    })) == []


# ── Startup validation via server fixture ──────────────────────────────────


def test_server_starts_with_valid_formulas(base_url: str) -> None:
    """The test server starts successfully (meaning no formula errors in test.yaml)."""
    import requests

    r = requests.get(f"{base_url}/api/character", timeout=5)
    assert r.status_code == 200
