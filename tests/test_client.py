"""Unit tests for PoolClient — URL building and param injection (no network)."""

import json

import pytest

from eps_pool.client import PoolApiError, PoolClient
from eps_pool.config import Config, ConfigError


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data
        if text:
            body = text
        elif json_data is not None:
            body = json.dumps(json_data)
        else:
            body = ""
        self.text = body
        self.content = body.encode()
        self.ok = 200 <= status_code < 400

    def json(self):
        if self._json is None:
            raise ValueError("no json body")
        return self._json


class RecordingSession:
    """Stand-in for requests.Session that records calls and returns a fixed response."""

    def __init__(self, response):
        self.response = response
        self.calls = []

    def request(self, method, url, params=None, json=None, timeout=None):
        self.calls.append(
            {"method": method, "url": url, "params": params, "json": json}
        )
        return self.response


@pytest.fixture
def config():
    return Config(
        api_key="secret",
        serialnumber="00:14:2D:A8:B1:42",
        base_url="https://api.example.test/publicapi/",
    )


def test_build_url_list(config):
    client = PoolClient(config)
    assert client.build_url("status") == "https://api.example.test/publicapi/status/"


def test_build_url_single(config):
    client = PoolClient(config)
    assert (
        client.build_url("status", pk=7)
        == "https://api.example.test/publicapi/status/7/"
    )


def test_get_injects_serial_and_key(config):
    session = RecordingSession(FakeResponse(json_data={"ok": True}))
    client = PoolClient(config, session=session)

    data = client.get_status()

    assert data == {"ok": True}
    call = session.calls[0]
    assert call["method"] == "GET"
    assert call["url"] == "https://api.example.test/publicapi/status/"
    assert call["params"] == {
        "serialnumber": "00:14:2D:A8:B1:42",
        "api_key": "secret",
    }


def test_get_raw_rejects_unknown_resource(config):
    client = PoolClient(config, session=RecordingSession(FakeResponse()))
    with pytest.raises(PoolApiError):
        client.get_raw("does-not-exist")


def test_http_error_raises(config):
    session = RecordingSession(FakeResponse(status_code=403, text="Forbidden"))
    client = PoolClient(config, session=session)
    with pytest.raises(PoolApiError):
        client.get_status()


def test_non_json_raises(config):
    session = RecordingSession(FakeResponse(status_code=200, text="<html>nope</html>"))
    client = PoolClient(config, session=session)
    with pytest.raises(PoolApiError):
        client.get_status()


def test_preview_url_masks_api_key(config):
    client = PoolClient(config)
    url = client.preview_url("realtimedata")
    assert "secret" not in url
    assert "serialnumber=00" in url
    assert url.startswith("https://api.example.test/publicapi/realtimedata/?")


def test_write_uses_put_with_body(config):
    session = RecordingSession(FakeResponse(json_data={"updated": True}))
    client = PoolClient(config, session=session)

    client.write("status", {"foo": "bar"}, pk=3, method="PUT")

    call = session.calls[0]
    assert call["method"] == "PUT"
    assert call["url"] == "https://api.example.test/publicapi/status/3/"
    assert call["json"] == {"foo": "bar"}


def test_config_from_env_missing(monkeypatch):
    monkeypatch.delenv("EPS_API_KEY", raising=False)
    monkeypatch.delenv("EPS_SERIAL", raising=False)
    with pytest.raises(ConfigError):
        Config.from_env(dotenv_path="/nonexistent/.env")


def test_config_from_env_ok(monkeypatch):
    monkeypatch.setenv("EPS_API_KEY", "k")
    monkeypatch.setenv("EPS_SERIAL", "00:14:2D:A8:B1:42")
    monkeypatch.delenv("EPS_BASE_URL", raising=False)
    cfg = Config.from_env(dotenv_path="/nonexistent/.env")
    assert cfg.api_key == "k"
    assert cfg.serialnumber == "00:14:2D:A8:B1:42"
    assert cfg.base_url.startswith("https://")
