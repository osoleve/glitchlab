from pathlib import Path

from glitchlab.config import setting, state_directory


def test_setting_uses_glitchlab_prefix(monkeypatch) -> None:
    monkeypatch.setenv("GLITCHLAB_WORKSPACE", "configured")

    assert setting("WORKSPACE") == "configured"


def test_setting_uses_default_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("GLITCHLAB_WORKSPACE", raising=False)

    assert setting("WORKSPACE", "default") == "default"


def test_state_directory_defaults_to_glitchlab(tmp_path: Path) -> None:
    assert state_directory(tmp_path) == tmp_path / ".glitchlab"


def test_state_directory_can_be_overridden(tmp_path: Path, monkeypatch) -> None:
    configured = tmp_path / "state"
    monkeypatch.setenv("GLITCHLAB_STATE_DIR", str(configured))

    assert state_directory(tmp_path) == configured
