import json

import httpx
import pytest
import respx

from zordms_ai.inference.vllm_client import VLLMClient, build_messages


def test_build_messages_includes_image_data_uri():
    msgs = build_messages("sys", "classify this", image_b64="QUJD")
    assert msgs[0]["role"] == "system"
    user = msgs[1]
    assert user["role"] == "user"
    # multimodal content: text part + image_url part
    kinds = {part["type"] for part in user["content"]}
    assert kinds == {"text", "image_url"}
    img = next(p for p in user["content"] if p["type"] == "image_url")
    assert img["image_url"]["url"].startswith("data:image/png;base64,QUJD")


def test_build_messages_text_only_when_no_image():
    msgs = build_messages("sys", "hello", image_b64=None)
    assert msgs[1]["content"] == "hello"


@pytest.mark.asyncio
@respx.mock
async def test_chat_json_sends_guided_json_and_parses_content():
    schema = {"type": "object", "properties": {"doc_type": {"type": "string"}}}
    route = respx.post("http://vllm.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"doc_type": "BT_CID_4G"})}}
                ]
            },
        )
    )
    client = VLLMClient("http://vllm.test/v1", "EMPTY", timeout_s=8.0)
    out = await client.chat_json(
        model="granite-3.2-vision-2b",
        system="You classify documents.",
        user_text="What type is this?",
        image_b64="QUJD",
        json_schema=schema,
    )
    assert out == {"doc_type": "BT_CID_4G"}
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "granite-3.2-vision-2b"
    assert sent["temperature"] == 0
    assert sent["extra_body"]["guided_json"] == schema
