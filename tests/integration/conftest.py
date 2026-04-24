"""Shared fixtures: session-scoped Flask server and per-test character reset."""

import shutil
import socket
import subprocess
import time
from pathlib import Path

import pytest
import requests

PROJECT_ROOT = Path(__file__).parent.parent.parent
SAMPLE_YAML = PROJECT_ROOT / "testdata" / "test.yaml"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """Start a real Flask server against a temp copy of sample.yaml.

    Yields a dict with keys:
      url      – base URL of the running server
      out_file – Path to the output YAML file (written on save)
      char_file – Path to the source YAML file (read on load)
    """
    tmp = tmp_path_factory.mktemp("server")
    char_file = tmp / "character.yaml"
    out_file = tmp / "output.yaml"
    shutil.copy(SAMPLE_YAML, char_file)
    shutil.copy(SAMPLE_YAML, out_file)

    port = _free_port()
    proc = subprocess.Popen(
        [
            "uv", "run", "python", "bin/dndcs.py",
            str(char_file), "--out", str(out_file), "--port", str(port),
        ],
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            requests.get(f"{base_url}/", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        proc.terminate()
        raise RuntimeError("Server failed to start within 5 seconds")

    yield {"url": base_url, "out_file": out_file, "char_file": char_file}

    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def base_url(server: dict) -> str:
    return server["url"]


@pytest.fixture
def out_file(server: dict) -> Path:
    return server["out_file"]


@pytest.fixture(autouse=True)
def reset_character(server: dict) -> None:
    """Restore the server's character to the sample data before each test."""
    sample = __import__("yaml").safe_load(SAMPLE_YAML.read_text())
    requests.put(
        f"{server['url']}/api/character",
        json=sample,
        timeout=5,
    )
