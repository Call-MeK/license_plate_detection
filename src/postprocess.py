"""Hậu xử lý biển số: chuẩn hóa theo dòng, sửa nhầm ký tự, định dạng theo loại xe.
Biển mới có 5 số cuối, biển cũ có 4 số cuối (xe máy hoặc ô tô biển cũ). Regex là mẫu, đối chiếu với dữ liệu thật rồi chỉnh."""
import re
from typing import Sequence

TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8"}
SERIES_LIKE_DIGIT = {"O", "Q", "I"}  # ký tự thứ 5 từ cuối của biển 4 số chỉ đổi khi thuộc tập này
PLATE_PATTERNS = [
    re.compile(r"^\d{2}[A-Z]\d{4,5}$"),     # 51F12345, 29A1234
    re.compile(r"^\d{2}[A-Z][1-9]\d{4,5}$"),  # 59A112345, 29H11234
    re.compile(r"^\d{2}[A-Z]{2}\d{4,5}$"),  # 29AA12345, 51LD1234
]


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
    if len(t) == 8:                              # biển 4 số có seri 1 chữ, hoặc 5 số có seri 1 chữ
        fifth = _digits(t[-5]) if t[-5] in SERIES_LIKE_DIGIT else t[-5]
        return head + t[2:-5] + fifth + _digits(t[-4:])
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
    four_digits = len(t) == 7 or (len(t) == 8 and vehicle_type == "MOTORBIKE")
    if four_digits:
        return f"{t[:-4]}-{t[-4:]}"
    return f"{t[:-5]}-{t[-5:-2]}.{t[-2:]}"


def is_valid(t):
    return any(p.match(t) for p in PLATE_PATTERNS)
