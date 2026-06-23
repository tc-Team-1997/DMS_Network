def test_health_returns_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-idp"
    assert body["mode"] == "cpu_degraded"
