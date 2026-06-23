import re

from zordms_ai.classify.doctype_registry import (
    DOCTYPE_REGISTRY,
    SignalType,
    all_doc_type_codes,
)


def test_registry_covers_core_bob_types():
    for code in ["BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION", "IN_PAN", "UNKNOWN"]:
        assert code in DOCTYPE_REGISTRY


def test_passport_has_mrz_signal_with_highest_priority():
    entry = DOCTYPE_REGISTRY["BT_PASSPORT"]
    mrz = [p for (t, p) in entry.regex_signals if t == SignalType.MRZ]
    assert mrz, "expected an MRZ signal"
    assert mrz[0].search("P<BTNDORJI<<KARMA")


def test_pan_has_id_regex_signal():
    entry = DOCTYPE_REGISTRY["IN_PAN"]
    rx = [p for (t, p) in entry.regex_signals if t == SignalType.ID_REGEX]
    assert rx[0].search("ABCDE1234F")
    assert not rx[0].search("abcde1234f")


def test_signal_priority_ordering():
    assert SignalType.MRZ < SignalType.ID_REGEX < SignalType.HEADER < SignalType.FALLBACK


def test_all_codes_returns_registry_keys():
    assert set(all_doc_type_codes()) == set(DOCTYPE_REGISTRY)
