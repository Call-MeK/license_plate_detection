from src.voting import decide


def test_three_agreeing_votes_are_stable():
    assert decide([("51F12345", .6)] * 3) == ("51F12345", "STABLE")


def test_two_votes_are_not_enough_yet():
    assert decide([("51F12345", .95), ("51F12345", .95)]) == ("51F12345", "UNCERTAIN")


def test_invalid_votes_are_ignored_and_empty_is_uncertain():
    assert decide([("", 0), ("", 0)]) == (None, "UNCERTAIN")
    assert decide([("", 0)] + [("51F12345", .9)] * 3) == ("51F12345", "STABLE")
