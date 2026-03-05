"""Tests for FRED API key environment loading and validation behavior."""

import os

from data import _extract_fred_api_key_colon_fallback, _load_fred_api_key_colon_fallback
from data.risk_signals import RiskSignalFetcher


def test_extract_fred_api_key_colon_fallback_parses_value_and_comment():
    text = """
# comment
FRED_API_KEY: abc123 # inline comment
"""
    assert _extract_fred_api_key_colon_fallback(text) == "abc123"


def test_load_fred_api_key_colon_fallback_sets_env_when_missing(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("FRED_API_KEY: from_colon_line\n", encoding="utf-8")
    monkeypatch.delenv("FRED_API_KEY", raising=False)

    _load_fred_api_key_colon_fallback(env_file)

    assert os.getenv("FRED_API_KEY") == "from_colon_line"


def test_load_fred_api_key_colon_fallback_preserves_existing_env(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("FRED_API_KEY: from_file\n", encoding="utf-8")
    monkeypatch.setenv("FRED_API_KEY", "from_env")

    _load_fred_api_key_colon_fallback(env_file)

    assert os.getenv("FRED_API_KEY") == "from_env"


def test_risk_signal_fetcher_warns_when_fred_api_key_missing(caplog, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)

    with caplog.at_level("WARNING"):
        fetcher = RiskSignalFetcher()

    assert fetcher.fred_api_key is None
    assert "FRED_API_KEY is missing" in caplog.text


def test_risk_signal_fetcher_warns_when_fred_api_key_invalid(caplog, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "bad key")

    with caplog.at_level("WARNING"):
        fetcher = RiskSignalFetcher()

    assert fetcher.fred_api_key is None
    assert "FRED_API_KEY is invalid" in caplog.text
