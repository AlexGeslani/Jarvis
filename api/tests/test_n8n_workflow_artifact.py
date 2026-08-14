import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = ROOT / "n8n" / "Jarvis Watch & Web.workflow.json"


def load_workflow():
    return json.loads(ARTIFACT.read_text())


def test_sanitized_workflow_has_one_strict_direct_model_path():
    workflow = load_workflow()
    assert set(workflow) == {"name", "nodes", "connections", "settings"}
    assert workflow["name"] == "Jarvis Watch & Web"
    assert workflow["settings"] == {
        "executionOrder": "v1",
        "saveDataErrorExecution": "none",
        "saveDataSuccessExecution": "none",
        "saveManualExecutions": False,
        "saveExecutionProgress": False,
        "executionTimeout": 20,
    }

    nodes = {node["name"]: node for node in workflow["nodes"]}
    assert set(nodes) == {
        "Jarvis Turn Webhook",
        "Validate Jarvis Turn",
        "Call Local Chat Model",
        "Normalize Jarvis Response",
    }

    webhook = nodes["Jarvis Turn Webhook"]
    assert webhook["type"] == "n8n-nodes-base.webhook"
    assert webhook["typeVersion"] == 2
    assert webhook["parameters"] == {
        "httpMethod": "POST",
        "path": "jarvis-watch-web",
        "authentication": "headerAuth",
        "responseMode": "lastNode",
        "options": {},
    }
    assert webhook["credentials"]["httpHeaderAuth"]["id"] == "__JARVIS_WEBHOOK_CREDENTIAL_ID__"

    model = nodes["Call Local Chat Model"]
    assert model["type"] == "n8n-nodes-base.httpRequest"
    assert model["typeVersion"] == 4.2
    assert model["credentials"]["openAiApi"]["id"] == "__LOCAL_MODEL_CREDENTIAL_ID__"
    assert model["parameters"]["method"] == "POST"
    assert model["parameters"]["url"] == "__LOCAL_OPENAI_CHAT_COMPLETIONS_URL__"
    assert model["parameters"]["authentication"] == "predefinedCredentialType"
    assert model["parameters"]["nodeCredentialType"] == "openAiApi"
    assert model["parameters"]["sendBody"] is True
    assert model["parameters"]["specifyBody"] == "json"
    body = model["parameters"]["jsonBody"]
    assert "__LOCAL_MODEL_ID__" in body
    assert "enable_thinking" in body
    assert "stream: false" in body
    assert "max_tokens: 256" in body

    forbidden_fragments = (
        "n8n-nodes-langchain",
        "homeAssistant",
        "toolWorkflow",
        "memoryPostgresChat",
        "executeCommand",
        "n8n-nodes-base.ssh",
    )
    raw = ARTIFACT.read_text()
    assert not any(fragment in raw for fragment in forbidden_fragments)


def test_sanitized_workflow_connections_are_linear_and_last_node_responds():
    workflow = load_workflow()
    assert workflow["connections"] == {
        "Jarvis Turn Webhook": {
            "main": [[{"node": "Validate Jarvis Turn", "type": "main", "index": 0}]]
        },
        "Validate Jarvis Turn": {
            "main": [[{"node": "Call Local Chat Model", "type": "main", "index": 0}]]
        },
        "Call Local Chat Model": {
            "main": [[{"node": "Normalize Jarvis Response", "type": "main", "index": 0}]]
        },
    }


def test_sanitized_workflow_contains_no_private_or_unresolved_runtime_values():
    raw = ARTIFACT.read_text()
    assert ".lan" not in raw
    assert "192.168." not in raw
    assert "Bearer " not in raw
    assert "api_key" not in raw.lower()
    assert "workflowId" not in raw
    assert "webhookId" not in raw
    assert '"active"' not in raw

    placeholders = {
        "__JARVIS_WEBHOOK_CREDENTIAL_ID__",
        "__JARVIS_WEBHOOK_CREDENTIAL_NAME__",
        "__LOCAL_MODEL_CREDENTIAL_ID__",
        "__LOCAL_MODEL_CREDENTIAL_NAME__",
        "__LOCAL_MODEL_ID__",
        "__LOCAL_OPENAI_CHAT_COMPLETIONS_URL__",
    }
    assert placeholders <= {token for token in placeholders if token in raw}
