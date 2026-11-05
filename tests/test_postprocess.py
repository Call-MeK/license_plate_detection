from src.postprocess import clean_lines, clean_plate, format_plate, is_valid


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


def test_old_four_digit_plates_keep_series_letters():
    assert clean_plate("29B-1234") == "29B1234"
    assert clean_plate("51LD-1234") == "51LD1234"
    assert clean_plate("29H1-I234") == "29H11234"


def test_clean_lines_fixes_bottom_line_only_digits():
    assert clean_lines(["5lF", "I23.45"]) == ["51F", "12345"]
    assert clean_lines(["59-X1", "1O2.34"]) == ["59X1", "10234"]
    assert clean_lines(["29AB", ""]) == ["29AB"]


def test_format_by_length_and_type():
    assert format_plate("29A1234") == "29A-1234"
    assert format_plate("59X112345") == "59X1-123.45"
    assert format_plate("29AB12345") == "29AB-123.45"
    assert format_plate("29H11234", "MOTORBIKE") == "29H1-1234"
    assert format_plate("29H11234") == "29H-112.34"


def test_valid_formats():
    for plate in ["51F12345", "29A1234", "59X112345", "29H11234", "29AA12345", "51LD1234"]:
        assert is_valid(plate), plate
    for plate in ["5F12345", "51F123", "51FFF12345", "ABCDEFG"]:
        assert not is_valid(plate), plate
