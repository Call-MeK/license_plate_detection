from decimal import Decimal

import pytest


@pytest.mark.parametrize("minutes,rate,interval,expected", [
    (70, "5000", 30, 7500), (95, "5000", 30, 10000),
    (0, "5000", 30, 0), (1, "100", 1, 2),
    (1441, "5000", 30, 122500),
])
def test_fee_rounds_intervals_then_whole_vnd(minutes, rate, interval, expected):
    from app.parking import calculate_fee
    assert calculate_fee(minutes, Decimal(rate), interval) == expected


@pytest.mark.parametrize("minutes,rate,interval", [
    (-1, "5000", 30), (5, "-1", 30), (5, "NaN", 30), (5, "5000", 0),
])
def test_invalid_fee_inputs_rejected(minutes, rate, interval):
    from app.parking import calculate_fee
    with pytest.raises(ValueError):
        calculate_fee(minutes, Decimal(rate), interval)
