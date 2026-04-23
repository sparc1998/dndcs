#!/usr/bin/env python3
"""D&D character sheet web application."""

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

import yaml
from flask import Flask, Response, jsonify, render_template_string, request


def _str_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


yaml.add_representer(str, _str_representer)

sys.path.insert(0, str(Path(__file__).parent.parent))

_PROJECT_ROOT = Path(__file__).parent.parent

app = Flask(__name__, static_folder=str(_PROJECT_ROOT / "static"))

_char_file: Path
_out_file: Path
_config: dict[str, Any]

TEMPLATE = (_PROJECT_ROOT / "static" / "index.html").read_text()

_DEFAULTS: dict[str, Any] = {
    "main_bg": "#1a1a2e",
    "sidebar_bg": "#16213e",
    "dialog_bg": "#0f3460",
    "card_bg": "#16213e",
    "card_hover_bg": "#1a2a4a",
    "tag_bg": "#0f3460",
    "header_font": "Helvetica Neue, Arial, sans-serif",
    "header_font_size": 14,
    "secondary_font_color": "#e8c96d",
    "button_font_color": "#1a1a2e",
    "button_bg": "#e8c96d",
    "main_font": "Helvetica Neue, Arial, sans-serif",
    "main_font_size": 15,
    "primary_font_color": "#e0d7c6",
    "sep_color": "#16213e",
    "backup_extension": ".bak",
    # Sizing keys — must mirror config.yaml; wired to fields via data-sizing-key in index.html.
    "name_sizing_text": "Firstname Lastname",
    "class_sizing_text": "Fighter / Wizard",
    "subclass_sizing_text": "Champion / Bladesinger",
    "race_line_sizing_text": "Variant Human",
    "physical_measureable_sizing_text": "Medium",
    "physical_description_sizing_text": "Auburn with streaks",
    "hd_sizing_text": "10d10 + 10d8",
    "experience_sizing_text": "000000",
    "level_log_class_sizing_text": "Fighter / Wizard",
    "std_num_sizing_text": "20",
}


def _load_config() -> dict[str, Any]:
    config_path = _PROJECT_ROOT / "config.yaml"
    if not config_path.exists():
        return dict(_DEFAULTS)
    with open(config_path) as f:
        loaded = yaml.safe_load(f) or {}
    return {**_DEFAULTS, **loaded}


@app.route("/")
def index() -> str:
    return render_template_string(TEMPLATE)


@app.route("/api/config", methods=["GET"])
def get_config() -> Response:
    return jsonify(_config)


@app.route("/api/character", methods=["GET"])
def get_character() -> tuple[Response, int] | Response:
    try:
        with open(_char_file) as f:
            data = yaml.safe_load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/character", methods=["PUT"])
def update_character() -> tuple[Response, int] | Response:
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        _write_bak(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/save", methods=["POST"])
def save_character() -> tuple[Response, int] | Response:
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        _write_file(_out_file, data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _write_bak(data: dict[str, Any]) -> None:
    ext = _config.get("backup_extension", ".bak")
    bak_path = _out_file.with_suffix(_out_file.suffix + ext)
    _write_file(bak_path, data)


def _write_file(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        yaml.dump(data, f, allow_unicode=True, sort_keys=False)
    shutil.move(str(tmp), str(path))


def main() -> None:
    global _char_file, _out_file, _config

    parser = argparse.ArgumentParser(description="D&D character sheet web app")
    parser.add_argument("sheet", type=Path, help="Path to the character YAML file")
    parser.add_argument(
        "--out", type=Path, default=None, help="Output file (default: overwrite input)"
    )
    parser.add_argument("--port", type=int, default=9123, help="Port to serve on (default: 9123)")
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help=(
            "Address to bind to (default: 127.0.0.1 for local use only;"
            " use 0.0.0.0 to accept connections from other machines on the network)"
        ),
    )
    args = parser.parse_args()

    _char_file = args.sheet.resolve()
    if not _char_file.exists():
        print(f"Error: file not found: {_char_file}", file=sys.stderr)
        sys.exit(1)

    _out_file = args.out.resolve() if args.out else _char_file
    _config = _load_config()

    print(f"Character sheet: {_char_file}")
    print(f"Output file:     {_out_file}")
    print(f"Serving at:      http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
