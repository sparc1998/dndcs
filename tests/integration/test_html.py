"""Static checks on index.html structure — no server required."""

from html.parser import HTMLParser
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
HTML_PATH = PROJECT_ROOT / "static" / "index.html"

VALID_RENDER_MODES = {"formatted", "formula", "formatted-multi-value", "calculated"}

KNOWN_SIZING_KEYS = {
    "name_sizing_text",
    "class_sizing_text",
    "subclass_sizing_text",
    "race_line_sizing_text",
    "physical_measureable_sizing_text",
    "physical_description_sizing_text",
    "hd_sizing_text",
    "experience_sizing_text",
    "level_log_class_sizing_text",
    "std_num_sizing_text",
    "money_sizing_text",
    "location_sizing_text",
    "gear_type_sizing_text",
    "roll_formula_sizing_text",
}


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.by_id: dict[str, dict[str, str]] = {}
        self.elements: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        d: dict[str, str] = {"_tag": tag}
        for k, v in attrs:
            d[k] = v or ""
        self.elements.append(d)
        if "id" in d:
            self.by_id[d["id"]] = d


def _parse() -> _Collector:
    c = _Collector()
    c.feed(HTML_PATH.read_text())
    return c


# ── Attribute contract ─────────────────────────────────────────────────────

def test_all_data_field_render_values_are_valid() -> None:
    c = _parse()
    bad = [
        (el.get("id", "?"), el["data-field-render"])
        for el in c.elements
        if "data-field-render" in el and el["data-field-render"] not in VALID_RENDER_MODES
    ]
    assert not bad, f"Unknown data-field-render values: {bad}"


def test_all_data_sizing_key_values_are_known() -> None:
    c = _parse()
    bad = [
        (el.get("id", "?"), el["data-sizing-key"])
        for el in c.elements
        if "data-sizing-key" in el and el["data-sizing-key"] not in KNOWN_SIZING_KEYS
    ]
    assert not bad, f"Unknown data-sizing-key values: {bad}"


# ── Bio fields ─────────────────────────────────────────────────────────────

# (element-id, data-field-key, data-field-render, data-sizing-key or None)
_BIO_FIELDS: list[tuple[str, str, str, str | None]] = [
    ("player-name",        "player_name",       "formatted",      "name_sizing_text"),
    ("character-name",     "character_name",     "formatted",      "name_sizing_text"),
    ("class",              "class",              "formatted",      "class_sizing_text"),
    ("subclass",           "subclass",           "formatted",      "subclass_sizing_text"),
    ("experience",         "experience",         "formula",        "experience_sizing_text"),
    ("level",              "level",              "formula",        "std_num_sizing_text"),
    ("hd",                 "hd",                 "formatted",      "hd_sizing_text"),
    ("race",               "race",               "formatted",      "race_line_sizing_text"),
    ("background",         "background",         "formatted",      "race_line_sizing_text"),
    ("alignment",          "alignment",          "formatted",      "race_line_sizing_text"),
    ("age",                "age",                "formatted",      "physical_measureable_sizing_text"),
    ("height",             "height",             "formatted",      "physical_measureable_sizing_text"),
    ("weight",             "weight",             "formatted",      "physical_measureable_sizing_text"),
    ("size-category",      "size_category",      "formatted",      "physical_measureable_sizing_text"),
    ("eyes",               "eyes",               "formatted",      "physical_description_sizing_text"),
    ("hair",               "hair",               "formatted",      "physical_description_sizing_text"),
    ("skin",               "skin",               "formatted",      "physical_description_sizing_text"),
    ("personality-traits", "personality_traits", "formatted",      None),
    ("ideals",             "ideals",             "formatted",      None),
    ("bonds",              "bonds",              "formatted",      None),
    ("traits",             "traits",             "formatted",      None),
    ("background-history", "background_history", "formatted-multi-value", None),
]


def test_bio_fields_have_correct_attributes() -> None:
    c = _parse()
    for fid, key, render, sizing in _BIO_FIELDS:
        el = c.by_id.get(fid)
        assert el is not None, f"Missing element #{fid}"
        assert el.get("data-field-key") == key, (
            f"#{fid}: data-field-key should be {key!r}, got {el.get('data-field-key')!r}"
        )
        assert el.get("data-field-render") == render, (
            f"#{fid}: data-field-render should be {render!r}, got {el.get('data-field-render')!r}"
        )
        if sizing is not None:
            assert el.get("data-sizing-key") == sizing, (
                f"#{fid}: data-sizing-key should be {sizing!r}, got {el.get('data-sizing-key')!r}"
            )


def test_bio_fields_have_display_spans() -> None:
    c = _parse()
    for fid, *_ in _BIO_FIELDS:
        assert f"{fid}-display" in c.by_id, f"Missing display span #{fid}-display"


def test_background_history_has_2col_layout() -> None:
    c = _parse()
    el = c.by_id["background-history"]
    assert el.get("data-layout") == "2col"


# ── Money fields ───────────────────────────────────────────────────────────

_MONEY_FIELDS: list[tuple[str, str]] = [
    ("money-pp", "pp"),
    ("money-gp", "gp"),
    ("money-ep", "ep"),
    ("money-sp", "sp"),
    ("money-cp", "cp"),
]


def test_money_fields_have_correct_attributes() -> None:
    c = _parse()
    for fid, key in _MONEY_FIELDS:
        el = c.by_id.get(fid)
        assert el is not None, f"Missing element #{fid}"
        assert el.get("data-field-key") == key, f"#{fid}: data-field-key should be {key!r}"
        assert el.get("data-field-render") == "formula", f"#{fid}: data-field-render should be 'formula'"
        assert el.get("data-sizing-key") == "money_sizing_text", (
            f"#{fid}: data-sizing-key should be 'money_sizing_text'"
        )
        assert f"{fid}-display" in c.by_id, f"Missing display span #{fid}-display"


# ── Dialog structure ───────────────────────────────────────────────────────

def test_edit_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "edit-dialog", "edit-dialog-box", "edit-dialog-hint",
        "edit-dialog-field-type", "edit-dialog-error", "edit-dialog-done-btn",
        "edit-dialog-textarea",
    ):
        assert eid in c.by_id, f"Missing #{eid}"


def test_link_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "link-dialog", "link-dialog-box", "link-dialog-hint",
        "link-url", "link-ok-btn", "link-remove-btn",
    ):
        assert eid in c.by_id, f"Missing #{eid}"


def test_feat_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "feat-dialog", "feat-dialog-box", "feat-dialog-hint",
        "feat-dialog-done-btn", "feat-dialog-text",
    ):
        assert eid in c.by_id, f"Missing #{eid}"
    assert c.by_id["feat-dialog-text"].get("data-field-render") == "formatted"


def test_note_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "note-dialog", "note-dialog-box", "note-dialog-hint",
        "note-dialog-done-btn",
        "note-dialog-tags", "note-dialog-text",
    ):
        assert eid in c.by_id, f"Missing #{eid}"
    ta = c.by_id["note-dialog-text"]
    assert ta.get("data-field-render") == "formatted"
    assert ta.get("data-field-key") == "text"


def test_gear_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "gear-dialog", "gear-dialog-box", "gear-dialog-hint",
        "gear-dialog-field-type", "gear-dialog-error", "gear-dialog-done-btn",
        "gear-dialog-delete-btn", "gear-dialog-type", "gear-dialog-location",
        "gear-dialog-weight", "gear-dialog-description",
    ):
        assert eid in c.by_id, f"Missing #{eid}"
    assert c.by_id["gear-dialog-description"].get("data-field-render") == "formatted"
    assert c.by_id["gear-dialog-weight"].get("data-field-render") == "formula"


def test_level_log_dialog_structure() -> None:
    c = _parse()
    for eid in (
        "level-log-dialog", "level-log-dialog-box", "level-log-dialog-hint",
        "level-log-dialog-done-btn",
        "level-log-dialog-level", "level-log-dialog-class", "level-log-dialog-details",
    ):
        assert eid in c.by_id, f"Missing #{eid}"
    cls = c.by_id["level-log-dialog-class"]
    assert cls.get("data-field-render") == "formatted"
    assert cls.get("data-field-key") == "class"
    details = c.by_id["level-log-dialog-details"]
    assert details.get("data-field-render") == "formatted"
    assert details.get("data-field-key") == "details"


# ── Stats fields ──────────────────────────────────────────────────────────

_STATS_FORMULA_FIELDS: list[tuple[str, str, str | None]] = [
    ("stats-proficiency-bonus", "proficiency_bonus", "std_num_sizing_text"),
    ("stats-save-bonus",        "save_bonus",        "std_num_sizing_text"),
]


def test_stats_formula_fields_have_correct_attributes() -> None:
    c = _parse()
    for fid, key, sizing in _STATS_FORMULA_FIELDS:
        el = c.by_id.get(fid)
        assert el is not None, f"Missing element #{fid}"
        assert el.get("data-field-key") == key, (
            f"#{fid}: data-field-key should be {key!r}, got {el.get('data-field-key')!r}"
        )
        assert el.get("data-field-render") == "formula", (
            f"#{fid}: data-field-render should be 'formula', got {el.get('data-field-render')!r}"
        )
        if sizing is not None:
            assert el.get("data-sizing-key") == sizing, (
                f"#{fid}: data-sizing-key should be {sizing!r}, got {el.get('data-sizing-key')!r}"
            )


def test_stats_formula_fields_have_display_spans() -> None:
    c = _parse()
    for fid, *_ in _STATS_FORMULA_FIELDS:
        assert f"{fid}-display" in c.by_id, f"Missing display span #{fid}-display"


def test_stats_jack_of_all_trades_is_checkbox() -> None:
    c = _parse()
    el = c.by_id.get("stats-jack-of-all-trades")
    assert el is not None, "Missing element #stats-jack-of-all-trades"
    assert el.get("_tag") == "input", "stats-jack-of-all-trades should be an input element"
    assert el.get("type") == "checkbox", "stats-jack-of-all-trades should be type='checkbox'"
    assert el.get("data-field-key") == "jack_of_all_trades"


# ── Level log table header sizing ──────────────────────────────────────────

def test_level_log_table_headers_have_sizing_keys() -> None:
    c = _parse()
    level_th = c.by_id.get("level-log-level-th")
    assert level_th is not None, "Missing #level-log-level-th"
    assert level_th.get("data-sizing-key") == "std_num_sizing_text"
    class_th = c.by_id.get("level-log-class-th")
    assert class_th is not None, "Missing #level-log-class-th"
    assert class_th.get("data-sizing-key") == "level_log_class_sizing_text"


# ── Attribute table ────────────────────────────────────────────────────────

_ATTR_NAMES = ["str", "dex", "con", "int", "wis", "cha"]


def test_attrs_table_val_fields() -> None:
    c = _parse()
    for attr in _ATTR_NAMES:
        fid = f"stats-{attr}-val"
        el = c.by_id.get(fid)
        assert el is not None, f"Missing #{fid}"
        assert el.get("data-field-render") == "formula", f"#{fid} should have data-field-render='formula'"
        assert el.get("data-field-key") == f"{attr}_val", f"#{fid} bad data-field-key"
        assert el.get("data-sizing-key") == "std_num_sizing_text", f"#{fid} bad data-sizing-key"
        assert f"{fid}-display" in c.by_id, f"Missing #{fid}-display"


def test_attrs_table_save_prof_checkboxes() -> None:
    c = _parse()
    for attr in _ATTR_NAMES:
        fid = f"stats-{attr}-save-prof"
        el = c.by_id.get(fid)
        assert el is not None, f"Missing #{fid}"
        assert el.get("type") == "checkbox", f"#{fid} should be type='checkbox'"
        assert el.get("data-field-key") == f"{attr}_save_prof", f"#{fid} bad data-field-key"


def test_attrs_table_calc_fields() -> None:
    c = _parse()
    for attr in _ATTR_NAMES:
        for suffix in ["mod", "ability-check", "save"]:
            fid = f"stats-{attr}-{suffix}"
            el = c.by_id.get(fid)
            assert el is not None, f"Missing #{fid}"
            assert el.get("data-field-render") == "calculated", (
                f"#{fid} should have data-field-render='calculated'"
            )


# ── Help panel ────────────────────────────────────────────────────────────────

def test_help_panel_exists() -> None:
    c = _parse()
    assert "panel-help" in c.by_id, "Missing #panel-help"


def test_help_tab_button_exists() -> None:
    c = _parse()
    tab_btns = [el for el in c.elements if el.get("class") == "tab-btn" and el.get("data-tab") == "help"]
    assert tab_btns, "Missing Help tab button (data-tab='help')"


def test_no_syntax_hint_spans_in_dialogs() -> None:
    c = _parse()
    for did in ("edit", "feat", "note", "gear", "level-log"):
        assert f"{did}-dialog-syntax-hint" not in c.by_id, (
            f"Unexpected syntax-hint span #{did}-dialog-syntax-hint — syntax hints belong in the Help tab"
        )
