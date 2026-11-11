import pytest

from src.vehicle_type import suggest_vehicle_type


@pytest.mark.parametrize("kwargs,expected", [
    (dict(plate="51F12345", bbox_ratio=4.6), ("CAR", "SERIES")),
    (dict(plate="51F12345", top_line="51F", bbox_ratio=2.0), ("CAR", "SERIES")),
    (dict(plate="59X112345", top_line="59X1", bbox_ratio=1.4), ("MOTORBIKE", "SERIES")),
    (dict(plate="29H11234", top_line="29H1", bbox_ratio=1.4), ("MOTORBIKE", "SERIES")),
    (dict(plate="51LD12345", top_line="51LD", bbox_ratio=2.0), ("CAR", "SERIES_SHAPE")),
    (dict(plate="29AA12345", top_line="29AA", bbox_ratio=1.3), ("MOTORBIKE", "SERIES_SHAPE")),
    (dict(plate="29AA12345", top_line="29AA", bbox_ratio=2.1), (None, None)),
    (dict(plate="59X112345"), ("MOTORBIKE", "SERIES")),
    (dict(plate="29A1234"), ("CAR", "SERIES")),
    (dict(plate="29A11234"), (None, None)),
    (dict(plate="51F12345"), (None, None)),  # nhập tay, không có dòng/bbox -> mơ hồ
    (dict(plate="29A11234", bbox_ratio=1.3), ("MOTORBIKE", "SERIES_SHAPE")),
    (dict(plate="51F12345", record_type="MOTORBIKE"), ("MOTORBIKE", "RECORD")),
    (dict(plate="garbage"), (None, None)),
    # bổ sung ngoài danh sách của brief
    (dict(plate="51F12345", bbox_ratio=1.3), ("MOTORBIKE", "SERIES_SHAPE")),
    (dict(plate="51F12345", bbox_ratio=2.0), ("CAR", "SERIES_SHAPE")),
    (dict(plate="29AA12345"), (None, None)),  # 2 chữ, không có bbox
    (dict(plate="29AA12345", bbox_ratio=1.3), ("MOTORBIKE", "SERIES_SHAPE")),
    (dict(plate="51LD12345", bbox_ratio=2.0), ("CAR", "SERIES_SHAPE")),
    (dict(plate="51LD12345", bbox_ratio=1.3), (None, None)),
    (dict(plate="29AA1234", bbox_ratio=1.3), ("MOTORBIKE", "SERIES_SHAPE")),
    (dict(plate="51F12345", top_line="garbage", bbox_ratio=2.0), ("CAR", "SERIES_SHAPE")),
    (dict(plate="51F12345", top_line="12345", bbox_ratio=2.0), ("CAR", "SERIES_SHAPE")),
    (dict(plate="51F12345", record_type="CAR", bbox_ratio=1.0), ("CAR", "RECORD")),
    (dict(plate="garbage", record_type="CAR"), ("CAR", "RECORD")),
    (dict(plate="garbage", bbox_ratio=4.0), ("CAR", "SERIES")),
])
def test_suggest(kwargs, expected):
    hint = suggest_vehicle_type(**kwargs)
    assert (hint["type"], hint["source"]) == expected


def test_tilted_motorbike_series_wins_over_shape():
    hint = suggest_vehicle_type("59X112345", top_line="59X1", bbox_ratio=1.9)
    assert hint == {"type": "MOTORBIKE", "source": "SERIES"}


def test_shape_boundary_is_inclusive_for_car():
    assert suggest_vehicle_type("29A11234", bbox_ratio=1.7) == {"type": "CAR", "source": "SERIES_SHAPE"}
    assert suggest_vehicle_type("29A11234", bbox_ratio=1.69) == {"type": "MOTORBIKE", "source": "SERIES_SHAPE"}
