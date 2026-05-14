from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Literal

from .models import ArtifactEnvironment

MarketLabEnvironment = Literal["prod", "dev", "test", "ci"]

VALID_ENVIRONMENTS: tuple[MarketLabEnvironment, ...] = ("prod", "dev", "test", "ci")


def normalize_environment(value: str | None) -> MarketLabEnvironment:
    normalized = (value or "").strip().lower()
    if normalized in VALID_ENVIRONMENTS:
        return normalized  # type: ignore[return-value]
    allowed = ", ".join(VALID_ENVIRONMENTS)
    raise ValueError(f"MARKET_LAB_ENV must be one of: {allowed}")


def current_environment(default: MarketLabEnvironment | None = "prod") -> MarketLabEnvironment:
    raw = os.getenv("MARKET_LAB_ENV")
    if raw:
        return normalize_environment(raw)
    if default is None:
        raise ValueError("Set MARKET_LAB_ENV or pass --env prod|dev|test|ci.")
    return default


def source_mode_for_environment(environment: MarketLabEnvironment) -> Literal["live", "fixture", "mock", "mixed"]:
    if environment == "prod":
        return "live"
    if environment == "ci":
        return "fixture"
    return "mixed"


def artifact_environment(environment: MarketLabEnvironment | None = None) -> ArtifactEnvironment:
    resolved = environment or current_environment()
    return ArtifactEnvironment(
        environment=resolved,
        source_mode=source_mode_for_environment(resolved),
        is_test_data=resolved != "prod",
    )


def market_lab_data_root(repo_root: Path) -> Path:
    configured = os.getenv("MARKET_LAB_DATA_ROOT") or os.getenv("MARKET_LAB_CACHE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return repo_root / ".cache" / "market_lab"


def reset_environment_cache(cache_dir: Path, *, environment: MarketLabEnvironment, confirm: str) -> None:
    if environment == "prod" and confirm != "prod-reset":
        raise ValueError("Refusing to reset prod without --confirm prod-reset.")
    if environment != "prod" and confirm != environment:
        raise ValueError(f"Refusing to reset {environment} without --confirm {environment}.")
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
