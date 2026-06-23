from __future__ import annotations

import json
from typing import Any

import httpx


def build_messages(system: str, user_text: str, image_b64: str | None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    if image_b64:
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_text})
    return messages


class VLLMClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_s: float,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._http = http_client

    async def chat_json(
        self,
        *,
        model: str,
        system: str,
        user_text: str,
        image_b64: str | None,
        json_schema: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "model": model,
            "messages": build_messages(system, user_text, image_b64),
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "extraction", "schema": json_schema},
            },
            "extra_body": {"guided_json": json_schema},
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        url = f"{self._base_url}/chat/completions"

        owns_client = self._http is None
        client = self._http or httpx.AsyncClient(timeout=self._timeout_s)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        finally:
            if owns_client:
                await client.aclose()

        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
