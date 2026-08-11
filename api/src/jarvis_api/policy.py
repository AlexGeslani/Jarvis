from __future__ import annotations

import re
import unicodedata


class UnsafeIntentError(ValueError):
    """Raised when a transcript requests a prohibited high-risk effect."""


_MUTATION = re.compile(
    r"\b(?:open|close|lock|unlock|arm|disarm|disable|enable|activate|deactivate|"
    r"turn\s+(?:on|off)|switch\s+(?:on|off)|start|stop|erase|delete|remove|reset)\b"
)
_HIGH_RISK_TARGET = re.compile(
    r"\b(?:locks?|deadbolts?|doors?|entry|entrance|gates?|garage|alarms?|security\s+system|"
    r"cameras?|webcams?|privacy\s+shutters?)\b"
)
_PURCHASE = re.compile(
    r"\b(?:buy|purchase|order|reorder|pay|checkout|subscribe|renew|send\s+money|transfer\s+money)\b"
)
_IRREVERSIBLE = re.compile(
    r"\b(?:factory\s+reset|hard\s+reset|permanently\s+delete|erase\s+all|wipe|format|"
    r"cannot\s+be\s+undone|irreversible)\b"
)
_DIRECT_SECURITY_EFFECT = re.compile(r"\b(?:unlock|disarm)\b")


def enforce_safe_intent(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    normalized = " ".join(normalized.split())
    if (
        _PURCHASE.search(normalized)
        or _IRREVERSIBLE.search(normalized)
        or _DIRECT_SECURITY_EFFECT.search(normalized)
        or (_MUTATION.search(normalized) and _HIGH_RISK_TARGET.search(normalized))
    ):
        raise UnsafeIntentError("high-risk intent is outside the Jarvis capability boundary")
    return text
