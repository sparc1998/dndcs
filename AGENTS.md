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
- Use config values exactly as provided. Do not derive lighter or darker variants  in the css, html, or javascript. If a color is
needed, it should be specified in `config.yaml`.
- If a color is added, add it explicitly to `config.yaml` and `_DEFAULTS` in `dndcs.py`.
- Whenever a `config.yaml` setting is applied to something new, update the comments in `config.yaml` to reflect all places it applies.

### Adding a new bio field

When adding a new bio field, update all of the following:

1. **`static/index.html`** — add the `<label>`, `<span class="field-display" id="X-display">`, and `<input type="hidden">` with the appropriate data-attributes (see **Data-attributes** below). No JS changes needed for render, save, autosave, or edit-dialog wiring.
2. **`schema/character.yaml`** — add the field as an optional `type: string` property under `bio`.
3. **`config.yaml`** and **`bin/dndcs.py`** — only if the field needs a new sizing key (see **Text box sizing** below).

### Data-attributes

These are the only HTML `data-*` attributes the app recognizes. All wiring runs once at parse time off `querySelectorAll`; adding or removing an attribute in `index.html` is usually the only change needed.

| Attribute | What it does | Notes |
|---|---|---|
| `data-field-key="<key>"` | Links the input to `obj[key]` for load and save. In `#panel-bio` the object is `character.bio` (with autosave on every keystroke). Inside a dialog the object is the entry being edited (persisted on dialog close). | Works in bio **and** dialogs. Any bio input with a paired `<span id="{input-id}-display">` becomes click-to-edit via the edit dialog — no extra opt-in needed. |
| `data-field-render="formatted" \| "formatted-seps" \| "formula"` | Single source of truth for three linked behaviors: (1) how the paired display renders, (2) the syntax hint shown in the edit/note/level-log dialog, (3) whether Cmd+K opens the link dialog on the element. | Required on every bio input and on any dialog input/textarea that should render markdown or run formulas. Values are driven by the `RENDER_MODES` registry in `app.js` — add a new mode there, not ad-hoc. `formatted-seps` parses `---` (three or more dashes) as section separators. |
| `data-layout="2col"` | Controls the visual arrangement of a field's rendered output. | Currently only used alongside `data-field-render="formatted-seps"` to display sections in two columns. Decoupled from render mode so layout can vary independently. |
| `data-sizing-key="<key>"` | Links input to a `config.yaml` sizing key for `fitInput()` width-fitting. | Only for bio header fields; key must exist in `config.yaml` and `_DEFAULTS` in `dndcs.py`. |

**`card-movable`** is a CSS class (not a `data-*` attribute) used by note cards for drag-and-drop. Behavior is wired imperatively in `renderNotes()`; the class only controls styling. Do not use `data-movable` — it has no effect.

**`dialog-hint`** is a CSS class applied to the small hint spans beneath each dialog (`${modKey}+↵ to save …`, syntax reminders). Always use the class rather than per-ID CSS rules, so new hints pick up the shared styling automatically.

### Text box sizing
- All text boxes visible in the bio header row must be sized using their corresponding `*_sizing_text` config value, applied via `data-sizing-key`.
- `fitInput` sets an inline `width` on the paired `<span class="field-display">`. No other sizing (e.g. `min-width`, `width: 100%`) should override this.
- `<span class="field-display">` must remain `display: inline-block` so that inline `width` takes effect.
- To add a new sizing key: add it to `config.yaml` (with a comment describing where it applies), add the same key and default value to `_DEFAULTS` in `dndcs.py`, and add `data-sizing-key="<key>"` to the input in `index.html`.

### Edit dialog
- Any bio input with `data-field-key` and a paired `-display` span is click-to-edit. To make a bio field read-only, omit the display span (or omit `data-field-key`, if it is derived from elsewhere). The readonly `<input>` in the level-log dialog is an example: plain HTML `readonly`, no `data-field-key`, populated manually.

## Key Behaviors

- The app reads a character YAML file on startup
- Changes are auto-saved to a `.bak` file on every edit
- The Save button writes to the configured output file
