"""Đo thời gian đến STABLE và độ chính xác trên video có nhãn (chạy offline, model thật).

Dùng:
    python scripts/benchmark_recognition.py --video demo.mp4 --labels labels.csv
Xem docs/benchmark.md để biết cách quay video và viết file nhãn.
"""
import argparse
import csv
import os
import platform
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # để import được src


@dataclass
class VehicleResult:
    plate_expected: str
    plate_read: str | None
    seconds_to_stable: float | None  # None = không chốt được trong khoảng nhãn
    type_expected: str | None = None
    # gợi ý loại xe tính cho ứng viên lúc STABLE; None = chưa chắc (xe không STABLE cũng là None)
    type_suggested: str | None = None


def summarize(results: list[VehicleResult]) -> dict:
    stable = [r.seconds_to_stable for r in results if r.seconds_to_stable is not None]
    # chỉ xe đã STABLE mới tính là đọc đúng; đoán cuối cùng khi hết giờ không tính
    correct = sum(1 for r in results
                  if r.seconds_to_stable is not None and r.plate_read == r.plate_expected)
    type_correct = sum(1 for r in results
                       if r.type_suggested is not None and r.type_suggested == r.type_expected)
    type_unsure = sum(1 for r in results if r.type_suggested is None)
    return {
        "vehicles": len(results),
        "stable": len(stable),
        "timeouts": len(results) - len(stable),
        "median_s": statistics.median(stable) if stable else None,
        "max_s": max(stable) if stable else None,
        "accuracy": correct / len(results) if results else 0.0,
        "type_correct": type_correct,
        "type_wrong": len(results) - type_correct - type_unsure,
        "type_unsure": type_unsure,
    }


def read_labels(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return [{"start_s": float(row["start_s"]), "end_s": float(row["end_s"]),
                 "plate": row["plate"].strip(), "vehicle_type": row["vehicle_type"].strip()}
                for row in csv.DictReader(handle)]


def shrink(frame, max_edge):
    height, width = frame.shape[:2]
    scale = max_edge / max(height, width)
    if scale >= 1:  # không phóng to
        return frame
    import cv2
    return cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)


def bbox_ratio_of(bbox):
    """Tỉ lệ rộng/cao của bbox (x1, y1, x2, y2); None nếu không hợp lệ."""
    if not bbox:
        return None
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return width / height if height > 0 else None


def suggest_for_candidate(plate, evidence):
    """Gợi ý loại xe cho biển `plate` bằng quan sát có điểm cao nhất của biển đó."""
    from src.vehicle_type import suggest_vehicle_type
    top_line, ratio = evidence.get(plate, (None, None, None))[1:]
    return suggest_vehicle_type(plate, top_line=top_line, bbox_ratio=ratio)["type"]


def run_vehicle(capture, label, max_edge, upload_ms):
    import cv2
    from src.pipeline import process_frame
    from src.postprocess import is_valid
    from src.voting import decide

    clock = label["start_s"]
    votes = []
    evidence = {}  # biển -> (điểm, dòng trên, tỉ lệ bbox) của quan sát tốt nhất
    plate = None
    while clock <= label["end_s"]:
        capture.set(cv2.CAP_PROP_POS_MSEC, clock * 1000)
        ok, frame = capture.read()
        if not ok:
            break
        started = time.perf_counter()
        _, observations = process_frame(shrink(frame, max_edge))
        clock += (time.perf_counter() - started) + upload_ms / 1000
        best = max(observations, key=lambda o: o["ocr_confidence"] * o["detector_confidence"], default=None)
        if best is not None and is_valid(best["plate"]):
            weight = best["ocr_confidence"] * best["detector_confidence"]
            votes.append((best["plate"], weight))
            lines = best.get("lines") or []
            if best["plate"] not in evidence or weight > evidence[best["plate"]][0]:
                evidence[best["plate"]] = (weight, lines[0] if len(lines) == 2 else None,
                                           bbox_ratio_of(best.get("bbox")))
        else:
            votes.append(("", 0))
        plate, status = decide(votes)
        if status == "STABLE":
            return VehicleResult(label["plate"], plate, clock - label["start_s"],
                                 label["vehicle_type"], suggest_for_candidate(plate, evidence))
    return VehicleResult(label["plate"], plate, None, label["vehicle_type"])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Benchmark nhận diện biển số trên video có nhãn.")
    parser.add_argument("--video", required=True, help="đường dẫn video")
    parser.add_argument("--labels", required=True, help="CSV: start_s,end_s,plate,vehicle_type")
    parser.add_argument("--max-edge", type=int, default=1280, help="thu nhỏ khung về cạnh dài này (px)")
    parser.add_argument("--upload-ms", type=float, default=0, help="độ trễ tải ảnh giả lập mỗi khung (ms)")
    args = parser.parse_args(argv)

    import cv2
    from src import config

    labels = read_labels(args.labels)
    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        parser.error(f"không mở được video: {args.video}")
    print(f"CPU: {platform.processor() or platform.machine()} | cores: {os.cpu_count()} | "
          f"USE_STUB: {config.USE_STUB}")
    print(f"PLATE_MODEL: {config.PLATE_MODEL} | OCR_MODEL_DIR: {config.OCR_MODEL_DIR}")
    results = []
    print(f"{'#':>3} {'expected':<12} {'read':<12} {'type':<10} {'suggested':<10} {'seconds':>8}")
    for index, label in enumerate(labels, 1):
        result = run_vehicle(capture, label, args.max_edge, args.upload_ms)
        results.append(result)
        seconds = "-" if result.seconds_to_stable is None else f"{result.seconds_to_stable:.2f}"
        print(f"{index:>3} {result.plate_expected:<12} {result.plate_read or '-':<12} "
              f"{label['vehicle_type']:<10} {result.type_suggested or '?':<10} {seconds:>8}")
    capture.release()
    print(summarize(results))


if __name__ == "__main__":
    main()
