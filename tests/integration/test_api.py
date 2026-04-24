"""HTTP API tests — no browser required."""

import yaml
import requests


def test_get_character_on_cold_start(cold_base_url: str) -> None:
    """GET /api/character must work on first request with no prior PUT."""
    r = requests.get(f"{cold_base_url}/api/character", timeout=5)
    assert r.status_code == 200
    data = r.json()
    assert data["bio"]["character_name"] == "Ser Aldric Vane"


def test_get_character_returns_sample(base_url: str) -> None:
    r = requests.get(f"{base_url}/api/character", timeout=5)
    assert r.status_code == 200
    data = r.json()
    assert data["bio"]["character_name"] == "Ser Aldric Vane"
    assert data["bio"]["player_name"] == "Ryan"


def test_get_character_includes_all_top_level_keys(base_url: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    for key in ("bio", "money", "gear", "campaign_notes", "level_log", "feats_features"):
        assert key in data, f"Missing key: {key}"
    assert len(data["feats_features"]) == 7
    assert len(data["campaign_notes"]) == 5
    assert len(data["level_log"]) == 7
    assert len(data["gear"]) == 18


def test_get_config_returns_defaults(base_url: str) -> None:
    r = requests.get(f"{base_url}/api/config", timeout=5)
    assert r.status_code == 200
    cfg = r.json()
    assert "primary_font_color" in cfg
    assert "button_bg" in cfg


def test_autosave_persists_change(base_url: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    data["bio"]["character_name"] = "Test Hero"
    r = requests.put(f"{base_url}/api/character", json=data, timeout=5)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Re-fetch and verify the change is live in server memory.
    fetched = requests.get(f"{base_url}/api/character", timeout=5).json()
    assert fetched["bio"]["character_name"] == "Test Hero"


def test_autosave_writes_bak_file(base_url: str, out_file: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    requests.put(f"{base_url}/api/character", json=data, timeout=5)

    import os
    bak = str(out_file) + ".bak"
    assert os.path.exists(bak), ".bak file not created"


def test_save_writes_output_file(base_url: str, out_file: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    data["bio"]["character_name"] = "Saved Hero"
    r = requests.post(f"{base_url}/api/save", json=data, timeout=5)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    saved = yaml.safe_load(out_file.read_text())
    assert saved["bio"]["character_name"] == "Saved Hero"


def test_save_preserves_feats_features(base_url: str, out_file: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    original_count = len(data.get("feats_features", []))
    requests.post(f"{base_url}/api/save", json=data, timeout=5)

    saved = yaml.safe_load(out_file.read_text())
    assert len(saved.get("feats_features", [])) == original_count


def test_save_preserves_note_order(base_url: str, out_file: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    data["campaign_notes"] = list(reversed(data["campaign_notes"]))
    requests.post(f"{base_url}/api/save", json=data, timeout=5)

    saved = yaml.safe_load(out_file.read_text())
    assert saved["campaign_notes"][0]["tags"] == data["campaign_notes"][0]["tags"]


def test_save_preserves_feat_order(base_url: str, out_file: str) -> None:
    data = requests.get(f"{base_url}/api/character", timeout=5).json()
    data["feats_features"] = list(reversed(data["feats_features"]))
    first_desc = data["feats_features"][0]["description"]
    requests.post(f"{base_url}/api/save", json=data, timeout=5)

    saved = yaml.safe_load(out_file.read_text())
    assert saved["feats_features"][0]["description"] == first_desc


def test_put_with_invalid_json_returns_400(base_url: str) -> None:
    r = requests.put(
        f"{base_url}/api/character",
        data="not json",
        headers={"Content-Type": "application/json"},
        timeout=5,
    )
    assert r.status_code == 400


def test_save_with_invalid_json_returns_400(base_url: str) -> None:
    r = requests.post(
        f"{base_url}/api/save",
        data="not json",
        headers={"Content-Type": "application/json"},
        timeout=5,
    )
    assert r.status_code == 400
