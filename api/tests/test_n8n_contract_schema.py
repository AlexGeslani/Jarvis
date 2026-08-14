import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "n8n" / "v1"


def schema(name):
    document = json.loads((CONTRACT / name).read_text())
    Draft202012Validator.check_schema(document)
    return Draft202012Validator(document)


def test_request_schema_accepts_only_the_minimal_transcript_boundary():
    validator = schema("request.schema.json")
    validator.validate(
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "transcript": "What is the kitchen light state?",
        }
    )

    with pytest.raises(ValidationError):
        validator.validate(
            {
                "schema_version": "1",
                "session_id": "session-12345678",
                "turn_id": "turn-12345678",
                "transcript": "private speech",
                "audio_base64": "must-never-cross-this-boundary",
            }
        )


def test_response_schema_requires_authoritative_allowlisted_tool_receipts():
    validator = schema("response.schema.json")
    validator.validate(
        {
            "schema_version": "1",
            "session_id": "session-12345678",
            "turn_id": "turn-12345678",
            "status": "complete",
            "spoken_text": "The kitchen lights are on.",
            "tool_results": [
                {
                    "tool": "get_home_status",
                    "status": "succeeded",
                    "receipt_id": "receipt-12345678",
                }
            ],
        }
    )

    for invalid_result in (
        {
            "tool": "home_assistant_service",
            "status": "succeeded",
            "receipt_id": "receipt-12345678",
        },
        {
            "tool": "set_room_lights",
            "status": "failed",
            "receipt_id": "receipt-12345678",
        },
        {
            "tool": "set_room_lights",
            "status": "succeeded",
            "receipt_id": "receipt-12345678",
        },
    ):
        with pytest.raises(ValidationError):
            validator.validate(
                {
                    "schema_version": "1",
                    "session_id": "session-12345678",
                    "turn_id": "turn-12345678",
                    "status": "complete",
                    "spoken_text": "Ready.",
                    "tool_results": [invalid_result],
                }
            )
