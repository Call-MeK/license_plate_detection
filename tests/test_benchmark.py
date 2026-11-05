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
        "median_s": 2.0, "max_s": 3.0, "accuracy": 1 / 3}
