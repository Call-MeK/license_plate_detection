from src.voting import decide


def test_three_agreeing_votes_are_stable():
    assert decide([("51F12345", .6)] * 3) == ("51F12345", "STABLE")


def test_two_high_confidence_votes_stop_early():
    assert decide([("51F12345", .85), ("51F12345", .9)]) == ("51F12345", "STABLE")


def test_two_votes_with_one_below_threshold_wait():
    assert decide([("51F12345", .85), ("51F12345", .79)]) == ("51F12345", "UNCERTAIN")


def test_early_stop_needs_seventy_percent_share():
    assert decide([("51F12345", .9), ("51F12345", .9), ("51F12346", .9)])[1] == "UNCERTAIN"


def test_invalid_votes_are_ignored_and_empty_is_uncertain():
    assert decide([("", 0), ("", 0)]) == (None, "UNCERTAIN")
    assert decide([("", 0)] + [("51F12345", .9)] * 3) == ("51F12345", "STABLE")
