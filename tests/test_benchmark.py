import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "benchmark_recognition.py"


def load():
    spec = importlib.util.spec_from_file_location("benchmark_recognition", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_summarize_reports_median_max_accuracy_and_timeouts():
    bench = load()
    results = [
        bench.VehicleResult("51F12345", "51F12345", 1.0),
        bench.VehicleResult("51F12345", "51F12346", 3.0),
        bench.VehicleResult("51F12345", None, None),
    ]

    assert bench.summarize(results) == {
        "vehicles": 3, "stable": 2, "timeouts": 1,
        "median_s": 2.0, "max_s": 3.0, "accuracy": 1 / 3, "stable_wrong": 1,
        "type_correct": 0, "type_wrong": 0, "type_unsure": 3}


def test_summarize_does_not_count_unstable_guess_as_accurate():
    bench = load()
    results = [
        bench.VehicleResult("51F12345", "51F12345", 1.0),
        bench.VehicleResult("51F12345", "51F12345", None),  # đoán đúng nhưng không STABLE
    ]

    summary = bench.summarize(results)

    assert summary["timeouts"] == 1
    assert summary["accuracy"] == 1 / 2


def test_summarize_reports_vehicle_type_accuracy():
    bench = load()
    results = [
        bench.VehicleResult("51F12345", "51F12345", 1.0, type_expected="CAR", type_suggested="CAR"),
        bench.VehicleResult("59X112345", "59X112345", 1.0, type_expected="MOTORBIKE", type_suggested="CAR"),
        bench.VehicleResult("29A11234", "29A11234", 1.0, type_expected="CAR", type_suggested=None),
        bench.VehicleResult("51F12345", None, None, type_expected="CAR"),  # không STABLE -> chưa chắc
    ]

    summary = bench.summarize(results)

    assert summary["type_correct"] == 1
    assert summary["type_wrong"] == 1
    assert summary["type_unsure"] == 2


def test_summarize_type_counts_default_to_unsure():
    bench = load()
    summary = bench.summarize([bench.VehicleResult("51F12345", "51F12345", 1.0)])

    assert (summary["type_correct"], summary["type_wrong"], summary["type_unsure"]) == (0, 0, 1)


def test_bbox_ratio_of_guards_degenerate_boxes():
    bench = load()

    assert bench.bbox_ratio_of((10, 20, 110, 70)) == 2.0
    assert bench.bbox_ratio_of((10, 20, 110, 20)) is None
    assert bench.bbox_ratio_of(None) is None


def test_suggest_for_candidate_uses_evidence_of_the_stable_plate():
    bench = load()
    evidence = {"59X112345": (0.9, "59X1", 1.9)}

    assert bench.suggest_for_candidate("59X112345", evidence) == "MOTORBIKE"
    assert bench.suggest_for_candidate("51F12345", evidence) is None  # không có dòng/bbox -> mơ hồ


def test_summarize_counts_stable_wrong_plates():
    bench = load()
    results = [
        bench.VehicleResult("51F12345", "51F12345", 1.0),
        bench.VehicleResult("51LD1234", "51L01234", 1.5),   # STABLE nhưng sai biển
        bench.VehicleResult("51F12345", "51F82345", 2.0),   # STABLE nhưng sai biển
        bench.VehicleResult("51F12345", "51F12346", None),  # sai nhưng không STABLE -> không tính
    ]

    assert bench.summarize(results)["stable_wrong"] == 2


def test_plate_vote_cleans_before_validating():
    bench = load()
    observation = {"plate": "51F-I23.45", "ocr_confidence": 0.5, "detector_confidence": 0.8}

    assert bench.plate_vote(observation) == ("51F12345", 0.4)
    assert bench.plate_vote({**observation, "plate": "51FB2345"}) == ("51F82345", 0.4)
    assert bench.plate_vote({**observation, "plate": "ABC"}) == ("", 0)
    assert bench.plate_vote(None) == ("", 0)


def test_read_labels_uppercases_vehicle_type(tmp_path):
    bench = load()
    labels = tmp_path / "labels.csv"
    labels.write_text("start_s,end_s,plate,vehicle_type\n0,4,51F12345, car \n4,8,59X112345,Motorbike\n",
                      encoding="utf-8")

    assert [row["vehicle_type"] for row in bench.read_labels(labels)] == ["CAR", "MOTORBIKE"]
