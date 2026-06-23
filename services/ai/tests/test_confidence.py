import pytest

from zordms_ai.routing.confidence import RouteAction, route_by_confidence


@pytest.mark.parametrize(
    "conf,action,proceed,sla,catalog",
    [
        (0.95, RouteAction.AUTO_APPROVE, True, None, "full"),
        (0.92, RouteAction.AUTO_APPROVE, True, None, "full"),
        (0.88, RouteAction.AUTO_VERIFIED, True, None, "full"),
        (0.85, RouteAction.AUTO_VERIFIED, True, None, "full"),
        (0.80, RouteAction.SUPERVISOR_REVIEW, True, 48, "tentative"),
        (0.70, RouteAction.SUPERVISOR_REVIEW, True, 48, "tentative"),
        (0.60, RouteAction.HUMAN_REVIEW, False, 24, "pending"),
        (0.50, RouteAction.HUMAN_REVIEW, False, 24, "pending"),
        (0.40, RouteAction.REJECT, False, 0, "none"),
    ],
)
def test_bands(conf, action, proceed, sla, catalog):
    d = route_by_confidence(conf)
    assert d.action == action
    assert d.proceed_to_extract == proceed
    assert d.sla_hours == sla
    assert d.catalog_assignment == catalog


def test_auto_verified_band_is_sampled():
    assert route_by_confidence(0.88).sampled_review is True
    assert route_by_confidence(0.95).sampled_review is False


def test_review_required_flags():
    assert route_by_confidence(0.95).review_required is False
    assert route_by_confidence(0.80).review_required is True
    assert route_by_confidence(0.40).review_required is True
