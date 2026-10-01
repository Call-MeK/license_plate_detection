from src.postprocess import clean_plate, format_plate, is_valid


def test_clean_basic():
    assert clean_plate("51F-123.45") == "51F12345"


def test_fix_confusables():
    assert clean_plate("5lF-I23.45") == "51F12345"


def test_format():
    assert format_plate("51F12345") == "51F-123.45"
    assert format_plate("59A112345") == "59A1-123.45"


def test_valid():
    assert is_valid("51F12345") and is_valid("59A112345")
    assert not is_valid("ABCDEFG")
