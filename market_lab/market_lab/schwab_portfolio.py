from __future__ import annotations

import json
import os
import time
from base64 import b64encode
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

import requests

from .models import PortfolioAccount, PortfolioContext, PortfolioPosition
from .storage import default_cache_dir, repo_root


def _resolve_token_path(path: Path | str) -> Path:
    token_path = Path(path).expanduser()
    if token_path.is_absolute():
        return token_path.resolve()
    return (repo_root() / token_path).resolve()


class SchwabPortfolioClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        token_path: Path | str | None = None,
        access_token: str | None = None,
        request_get: Callable[..., requests.Response] | None = None,
        request_post: Callable[..., requests.Response] | None = None,
        timeout_seconds: float | None = None,
    ):
        self.base_url = (base_url or os.getenv("SCHWAB_TRADER_API_BASE_URL") or "https://api.schwabapi.com/trader/v1").rstrip("/")
        self.token_paths = self._token_paths(token_path)
        self.token_path = self.token_paths[0]
        self.access_token = access_token or os.getenv("SCHWAB_ACCESS_TOKEN")
        self.request_get = request_get or requests.get
        self.request_post = request_post or requests.post
        self.timeout_seconds = timeout_seconds or float(os.getenv("MARKET_LAB_SCHWAB_TIMEOUT_SECONDS", "4.0"))

    def fetch_context(self) -> PortfolioContext:
        token = self._access_token()
        if not token:
            return PortfolioContext(
                status="unavailable",
                source="schwab",
                generated_at=datetime.now(UTC),
                message="Schwab Accounts and Trading access token is unavailable.",
            )
        try:
            account_numbers = self._get("/accounts/accountNumbers", token)
            accounts_payload = self._get("/accounts", token, params={"fields": "positions"})
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code in {401, 403}:
                return PortfolioContext(
                    status="reauth_required",
                    source="schwab",
                    generated_at=datetime.now(UTC),
                    message="Schwab account endpoints returned 401/403; reauth or Trader API account-access approval may be required.",
                )
            return PortfolioContext(status="error", source="schwab", generated_at=datetime.now(UTC), message=str(exc))
        except Exception as exc:
            return PortfolioContext(status="error", source="schwab", generated_at=datetime.now(UTC), message=str(exc))

        return normalize_schwab_portfolio(account_numbers, accounts_payload)

    def _get(self, path: str, token: str, *, params: dict[str, str] | None = None) -> Any:
        response = self.request_get(
            f"{self.base_url}{path}",
            params=params,
            timeout=self.timeout_seconds,
            headers={"authorization": f"Bearer {token}", "accept": "application/json"},
        )
        response.raise_for_status()
        return response.json()

    def _access_token(self) -> str | None:
        if self.access_token:
            return self.access_token
        for token_path in self.token_paths:
            token = self._read_access_token(token_path)
            if token:
                return token
        return None

    def _read_access_token(self, token_path: Path) -> str | None:
        try:
            payload = json.loads(token_path.read_text(encoding="utf-8"))
        except Exception:
            return None
        expires_at = payload.get("expiresAt")
        token = payload.get("accessToken") or payload.get("access_token")
        if token and not _is_expired(expires_at):
            return str(token).strip()

        refreshed = self._refresh_access_token(token_path, payload)
        if refreshed:
            return refreshed
        return None

    def _refresh_access_token(self, token_path: Path, payload: dict[str, Any]) -> str | None:
        refresh_token = str(payload.get("refreshToken") or payload.get("refresh_token") or "").strip()
        if not refresh_token:
            return None
        client_id, client_secret = self._client_credentials_for_token_path(token_path)
        if not client_id or not client_secret:
            return None
        auth = b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
        response = self.request_post(
            _env_value("SCHWAB_TOKEN_URL", "https://api.schwabapi.com/v1/oauth/token"),
            timeout=self.timeout_seconds,
            headers={
                "authorization": f"Basic {auth}",
                "content-type": "application/x-www-form-urlencoded",
                "accept": "application/json",
            },
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
        response.raise_for_status()
        body = response.json()
        access_token = str(body.get("access_token") or "").strip()
        if not access_token:
            return None
        expires_in = _number(body.get("expires_in")) or 1800
        next_payload = {
            "accessToken": access_token,
            "expiresAt": int((time.time() + max(expires_in - 60, 60)) * 1000),
            "refreshToken": str(body.get("refresh_token") or refresh_token).strip(),
            "refreshTokenIssuedAt": payload.get("refreshTokenIssuedAt") or datetime.now(UTC).isoformat(),
            "lastAuthorizationCodeAt": payload.get("lastAuthorizationCodeAt"),
        }
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(json.dumps(next_payload, indent=2), encoding="utf-8")
        return access_token

    def _client_credentials_for_token_path(self, token_path: Path) -> tuple[str, str]:
        streamer_path = _resolve_token_path(_env_value("SCHWAB_STREAMER_TOKEN_PATH", ".cache/market_data/schwab-streamer-token.json"))
        if token_path.resolve() == streamer_path or "streamer" in token_path.name:
            return (
                _env_value("SCHWAB_CLIENT_STREAMER_ID") or _env_value("SCHWAB_CLIENT_ID"),
                _env_value("SCHWAB_CLIENT_STREAMER_SECRET") or _env_value("SCHWAB_CLIENT_SECRET"),
            )
        return (_env_value("SCHWAB_CLIENT_ID"), _env_value("SCHWAB_CLIENT_SECRET"))

    def _token_paths(self, token_path: Path | str | None) -> list[Path]:
        candidates: list[Path] = []
        if token_path:
            candidates.append(_resolve_token_path(token_path))
        for env_name in ("MARKET_LAB_SCHWAB_PORTFOLIO_TOKEN_PATH", "SCHWAB_STREAMER_TOKEN_PATH"):
            value = os.getenv(env_name)
            if value:
                candidates.append(_resolve_token_path(value))
        candidates.extend(
            [
                repo_root() / ".cache" / "market_data" / "schwab-streamer-token.json",
                repo_root() / ".cache" / "market_data" / "schwab-token.json",
            ]
        )
        seen: set[Path] = set()
        unique: list[Path] = []
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved not in seen:
                unique.append(resolved)
                seen.add(resolved)
        return unique


def normalize_schwab_portfolio(account_numbers_payload: Any, accounts_payload: Any) -> PortfolioContext:
    account_labels = _account_labels(account_numbers_payload)
    account_hashes = _account_hashes(account_numbers_payload)
    accounts: list[PortfolioAccount] = []
    positions: list[PortfolioPosition] = []
    account_rows = accounts_payload if isinstance(accounts_payload, list) else [accounts_payload]
    total_value = 0.0

    for row in account_rows:
        securities_account = row.get("securitiesAccount") if isinstance(row, dict) else None
        if not isinstance(securities_account, dict):
            continue
        account_key = str(
            securities_account.get("hashValue")
            or securities_account.get("encryptedAccountNumber")
            or securities_account.get("accountNumber")
            or "unknown"
        ).strip()
        account_hash = account_hashes.get(account_key, account_key)
        balances = securities_account.get("currentBalances") if isinstance(securities_account.get("currentBalances"), dict) else {}
        liquidation = _number(balances.get("liquidationValue"))
        cash = _number(balances.get("cashBalance") or balances.get("cashAvailableForTrading"))
        if liquidation:
            total_value += liquidation
        accounts.append(
            PortfolioAccount(
                account_hash=account_hash,
                display_name=account_labels.get(account_hash),
                account_type=str(securities_account.get("type") or "") or None,
                cash_value=cash,
                liquidation_value=liquidation,
            )
        )
        for position in securities_account.get("positions") or []:
            if not isinstance(position, dict):
                continue
            instrument = position.get("instrument") if isinstance(position.get("instrument"), dict) else {}
            symbol = str(instrument.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            quantity = _number(position.get("longQuantity") or position.get("shortQuantity"))
            market_value = _number(position.get("marketValue"))
            current_price = _number(position.get("currentPrice"))
            if current_price is None and market_value is not None and quantity:
                current_price = market_value / quantity
            positions.append(
                PortfolioPosition(
                    account_hash=account_hash,
                    symbol=symbol,
                    asset_type=str(instrument.get("assetType") or "") or None,
                    quantity=quantity,
                    average_price=_number(position.get("averagePrice")),
                    current_price=current_price,
                    cost_basis=_number(position.get("averageLongPrice")),
                    unrealized_pnl=_number(position.get("longOpenProfitLoss")),
                    market_value=market_value,
                )
            )

    positions = [
        item.model_copy(update={"weight_pct": (item.market_value / total_value * 100) if total_value and item.market_value else None})
        for item in positions
    ]
    return PortfolioContext(
        status="available" if accounts or positions else "unavailable",
        source="schwab",
        generated_at=datetime.now(UTC),
        accounts=accounts,
        positions=positions,
        message=None if accounts or positions else "Schwab returned no account positions.",
    )


def _account_labels(payload: Any) -> dict[str, str]:
    labels: dict[str, str] = {}
    rows = payload if isinstance(payload, list) else payload.get("accounts", []) if isinstance(payload, dict) else []
    for item in rows:
        if not isinstance(item, dict):
            continue
        hash_value = str(item.get("hashValue") or item.get("accountNumber") or "").strip()
        if not hash_value:
            continue
        last_four = str(item.get("accountNumber") or "")[-4:]
        labels[hash_value] = f"Schwab account {last_four}" if last_four else "Schwab account"
    return labels


def _account_hashes(payload: Any) -> dict[str, str]:
    hashes: dict[str, str] = {}
    rows = payload if isinstance(payload, list) else payload.get("accounts", []) if isinstance(payload, dict) else []
    for item in rows:
        if not isinstance(item, dict):
            continue
        hash_value = str(item.get("hashValue") or "").strip()
        account_number = str(item.get("accountNumber") or "").strip()
        if hash_value:
            hashes[hash_value] = hash_value
        if hash_value and account_number:
            hashes[account_number] = hash_value
    return hashes


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _is_expired(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return value < datetime.now(UTC).timestamp() * 1000 + 60_000
    if isinstance(value, str) and value.strip():
        try:
            expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return expires_at.timestamp() * 1000 < datetime.now(UTC).timestamp() * 1000 + 60_000
    return False


def _env_value(key: str, default: str = "") -> str:
    value = os.getenv(key)
    if value is not None:
        return value.strip()
    env_path = repo_root() / ".env"
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, raw = stripped.split("=", 1)
            if name.strip() == key:
                return raw.strip().strip("\"'").strip()
    except OSError:
        return default
    return default
