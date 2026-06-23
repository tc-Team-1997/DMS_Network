from zordms_ai.classify.doctype_registry import SignalType
from zordms_ai.classify.prescreen import prescreen


def test_detects_bhutan_passport_via_mrz():
    res = prescreen("P<BTNDORJI<<KARMA<<<<<<<<<<<<<<<<<<<<<<<<<<<")
    assert res.proposed_type == "BT_PASSPORT"
    assert res.signals[0].signal_type == SignalType.MRZ


def test_detects_cid_via_11_digit_id():
    res = prescreen("Kingdom of Bhutan  CID 10112345678")
    # both an 11-digit ID-regex and a 'Kingdom of Bhutan' header point to BT_CID_4G
    assert res.proposed_type == "BT_CID_4G"


def test_detects_pan_via_regex():
    res = prescreen("Permanent Account Number ABCDE1234F Income Tax Department")
    assert res.proposed_type == "IN_PAN"


def test_no_match_returns_none():
    res = prescreen("just some unrelated prose with no identifiers")
    assert res.proposed_type is None
    assert res.signals == []


def test_signals_sorted_by_priority():
    res = prescreen("P<BTN... Passport 10112345678")
    priorities = [s.signal_type for s in res.signals]
    assert priorities == sorted(priorities)
