# Agent Instructions

## Project Overview

This is a Python web application for a D&D character sheet. It serves a local web UI via Flask.

## Directory Structure

- `bin/` — main executable script(s)
- `lib/` — shared Python library code
- `schema/` — YAML schemas for data validation
- `testdata/` — sample/test data files
- `static/` — HTML, CSS, and JavaScript for the web UI

## Development Setup

```bash
make setup   # install dependencies into .venv via uv
```

## Common Tasks

```bash
make check   # lint + type-check + format-check
make fix     # auto-format and auto-fix lint issues
make test    # run tests
```

## Code Style

- Python 3.11+, strict mypy typing
- Ruff for linting and formatting (line length 100)
- No unnecessary comments; self-documenting names preferred
- Use standard, commonly used packages (Flask, PyYAML)

## Schema

Character data is stored as YAML and validated against `schema/character.yaml` (JSON Schema format).
Use `check-jsonschema` to validate:

```bash
uv run check-jsonschema --schemafile schema/character.yaml <data_file.yaml>
```

## UI Rules

### Colors
- Use config values exactly as provided. Do not derive lighter or darker variants via `color-mix`, opacity, or any other transformation.
- Do not add a `--muted` or similar computed variable. If a color is needed, add it explicitly to `config.yaml` and `_DEFAULTS` in `dndcs.py`.
- Whenever a `config.yaml` setting is applied to something new, update the comments in `config.yaml` to reflect all places it applies.

### Adding a new bio field

When adding a new bio field, update all of the following:

1. **`static/index.html`** — add the `<label>`, `<span class="field-display" id="X-display">`, and `<input type="hidden">` with the appropriate data-attributes (see **Data-attributes** below). No JS changes needed for render, save, or autosave wiring.
2. **`schema/character.yaml`** — add the field as an optional `type: string` property under `bio`.
3. **`config.yaml`** and **`bin/dndcs.py`** — only if the field needs a new sizing key (see **Text box sizing** below).

### Data-attributes

These HTML `data-*` attributes on `<input>` elements define self-contained behaviors. Adding or removing an attribute in `index.html` is the only change needed — all wiring is driven by `querySelectorAll` at parse time.

| Attribute | What it does | Notes |
|---|---|---|
| `data-field-key="<key>"` | Links input to `character.bio[key]` for load, save, and autosave | Required on all bio fields |
| `data-sizing-key="<key>"` | Links input to a `config.yaml` sizing key for `fitInput()` width-fitting | Only for bio header fields; key must exist in `config.yaml` and `_DEFAULTS` in `dndcs.py` |
| `data-expandable` | Clicking the paired `<span id="X-display">` opens the full-screen edit dialog | Requires a `<span id="{input-id}-display">` sibling |
| `data-formattable` | Enables markdown rendering (links, bold, italic, bullets) and Cmd+K link shortcut | Put on `<input>` or `<textarea>`; update `buildSyntaxHint()` in `app.js` if adding new syntax |
| `data-formula` | Display shows evaluated arithmetic result instead of raw text | Mutually exclusive with `data-formattable` |
| `data-2col` | Display is split at the nearest `--` separator into two columns | `updateDisplay()` auto-toggles `.field-display-2col` on the display span — no CSS class change needed in HTML |

**`card-movable`** is a CSS class (not a `data-*` attribute) used by note cards for drag-and-drop. Behavior is wired imperatively in `renderNotes()`; the class only controls styling. Do not use `data-movable` — it has no effect.

### Text box sizing
- All text boxes visible in the bio header row must be sized using their corresponding `*_sizing_text` config value, applied via `data-sizing-key`.
- `fitInput` sets an inline `width` on the paired `<span class="field-display">`. No other sizing (e.g. `min-width`, `width: 100%`) should override this.
- `<span class="field-display">` must remain `display: inline-block` so that inline `width` takes effect.
- To add a new sizing key: add it to `config.yaml` (with a comment describing where it applies), add the same key and default value to `_DEFAULTS` in `dndcs.py`, and add `data-sizing-key="<key>"` to the input in `index.html`.

### Expandable edit dialog
- All new bio fields with a paired `<span class="field-display">` should have `data-expandable` by default, unless explicitly instructed otherwise.
- To remove the edit dialog from a field, delete `data-expandable` from the input in `index.html`. No JS changes needed.

## Key Behaviors

- The app reads a character YAML file on startup
- Changes are auto-saved to a `.bak` file on every edit
- The Save button writes to the configured output file
