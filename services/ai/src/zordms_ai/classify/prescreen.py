from __future__ import annotations

from dataclasses import dataclass

from zordms_ai.classify.doctype_registry import DOCTYPE_REGISTRY, SignalType


@dataclass(frozen=True)
class PrescreenSignal:
    doc_type: str
    signal_type: SignalType
    matched: str


@dataclass(frozen=True)
class PrescreenResult:
    proposed_type: str | None
    signals: list[PrescreenSignal]


def prescreen(text: str) -> PrescreenResult:
    signals: list[PrescreenSignal] = []
    lowered = text.lower()
    for code, entry in DOCTYPE_REGISTRY.items():
        for sig_type, pattern in entry.regex_signals:
            m = pattern.search(text)
            if m:
                signals.append(PrescreenSignal(code, sig_type, m.group(0)))
        for sig_type, keyword in entry.keyword_signals:
            if keyword.lower() in lowered:
                signals.append(PrescreenSignal(code, sig_type, keyword))

    signals.sort(key=lambda s: int(s.signal_type))
    proposed = signals[0].doc_type if signals else None
    return PrescreenResult(proposed_type=proposed, signals=signals)
