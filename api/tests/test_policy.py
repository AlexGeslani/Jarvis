import pytest

from jarvis_api.policy import UnsafeIntentError, enforce_safe_intent


@pytest.mark.parametrize(
    "text",
    [
        "Unlock the front door",
        "Open my garage",
        "Disarm the alarm",
        "Turn off the nursery camera",
        "Buy another air filter",
        "Factory reset the thermostat",
    ],
)
def test_high_risk_physical_and_irreversible_intents_are_rejected(text):
    with pytest.raises(UnsafeIntentError):
        enforce_safe_intent(text)


@pytest.mark.parametrize(
    "text",
    [
        "Turn on the kitchen lights",
        "What is the living room temperature?",
        "Set the office fan to low",
        "Is the garage door closed?",
    ],
)
def test_low_risk_and_read_only_intents_are_allowed(text):
    assert enforce_safe_intent(text) == text
