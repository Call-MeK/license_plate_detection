"""Hậu xử lý biển số: chuẩn hóa theo dòng, sửa nhầm ký tự, định dạng theo loại xe.
Biển mới có 5 số cuối, biển cũ có 4 số cuối (xe máy hoặc ô tô biển cũ). Regex là mẫu, đối chiếu với dữ liệu thật rồi chỉnh."""
import re
from typing import Sequence

TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8"}
# Seri 2 chữ đặc biệt của ô tô (biển 4 số cũ, vd. 51LD1234). src.vehicle_type dùng lại tập này.
CAR_SPECIAL_SERIES = frozenset({"LD", "KT", "HC", "NN", "NG", "QT", "CV"})
PLATE_PATTERNS = [
    re.compile(r"^\d{2}[A-Z]\d{4,5}$"),     # 51F12345, 29A1234
    re.compile(r"^\d{2}[A-Z][1-9]\d{4,5}$"),  # 59A112345, 29H11234
    re.compile(r"^\d{2}[A-Z]{2}\d{5}$"),    # 29AA12345
]
_SPECIAL_FOUR_DIGIT = re.compile(r"^\d{2}(?P<series>[A-Z]{2})\d{4}$")  # 51LD1234


def _norm(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def _digits(s):
    return "".join(TO_DIGIT.get(c, c) for c in s)


def clean_plate(text):
    t = _norm(text)
    if len(t) < 7:
        return t
    head = _digits(t[:2])                        # 2 số tỉnh
    if len(t) >= 9:                              # biển 5 số: ký tự thứ 5 từ cuối luôn là số
        return head + t[2:-5] + _digits(t[-5:])
    if len(t) == 8:                              # biển 5 số seri 1 chữ, 4 số seri chữ+số, hoặc seri đặc biệt
        if t[2:4] in CAR_SPECIAL_SERIES:         # 51LD1234: giữ chữ thứ 5 từ cuối
            return head + t[2:-4] + _digits(t[-4:])
        return head + t[2:-5] + _digits(t[-5:])
    return head + t[2:-4] + _digits(t[-4:])      # len == 7: biển 4 số, seri 1 chữ


def clean_lines(lines: Sequence[str]) -> list[str]:
    if not lines:
        return []
    if len(lines) == 1:
        cleaned = [clean_plate(lines[0])]
    else:
        top = _norm(lines[0])
        bottom = _digits(_norm("".join(lines[1:])))
        top = _digits(top[:2]) + top[2:]
        cleaned = [top, bottom]
    return [line for line in cleaned if line]


def format_plate(t, vehicle_type=None):
    if len(t) < 7:
        return t
    if len(t) == 8:
        # seri 2 chữ không thể có nhóm 5 số; t[-5] là số thì loại xe quyết định
        four_digits = not t[-5].isdigit() or vehicle_type == "MOTORBIKE"
    else:
        four_digits = len(t) == 7
    if four_digits:
        return f"{t[:-4]}-{t[-4:]}"
    return f"{t[:-5]}-{t[-5:-2]}.{t[-2:]}"


def is_valid(t):
    special = _SPECIAL_FOUR_DIGIT.match(t)
    if special:
        return special.group("series") in CAR_SPECIAL_SERIES
    return any(p.match(t) for p in PLATE_PATTERNS)
