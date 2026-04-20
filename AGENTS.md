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

### Text box sizing
- All text boxes visible in the bio header row must be sized using their corresponding `*_sizing_text` config value, applied via `fitInput`.
- `fitInput` sets an inline `width` on both the `<input>` and the paired `<span class="field-display">`. No other sizing (e.g. `min-width`, `width: 100%`) should override this.
- `<span class="field-display">` must remain `display: inline-block` so that inline `width` takes effect.
- When adding a new bio header text box, add a matching `*_sizing_text` key to `config.yaml`, `_DEFAULTS` in `dndcs.py`, and wire it up in `applyConfig` in `index.html`.

### Link behavior
- All new text boxes should have `data-linkable` by default, unless explicitly instructed otherwise.
- `data-linkable` is a plain HTML attribute — to remove cmd-k link support from a box, simply delete the attribute from the element in `index.html`. No JS changes are needed.

### Expandable edit dialog
- All new bio header text boxes (those with a paired `<span class="field-display">`) should have `data-expandable` by default, unless explicitly instructed otherwise.
- `data-expandable` causes clicking the display span to open a centered full-screen edit dialog instead of editing inline. The JS auto-wires any input with this attribute to its paired display (matched by the `{id}-display` naming convention). No JS changes are needed to add or remove this behavior — simply add or delete the attribute in `index.html`.

## Key Behaviors

- The app reads a character YAML file on startup
- Changes are auto-saved to a `.bak` file on every edit
- The Save button writes to the configured output file
