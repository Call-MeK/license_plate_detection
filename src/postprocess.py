"""P4 phụ trách. Hậu xử lý v0: chuẩn hóa, sửa nhầm ký tự theo vị trí, kiểm tra định dạng.
Giả định 5 số cuối (biển 4 số cũ cần xử lý thêm). Regex là mẫu, đối chiếu với dữ liệu thật rồi chỉnh."""
import re

CAR = re.compile(r"^\d{2}[A-Z]{1,2}\d{5}$")        # 51F12345
MOTO = re.compile(r"^\d{2}[A-Z][A-Z0-9]\d{5}$")    # 59A112345
TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8"}


def clean_plate(text):
    t = re.sub(r"[^A-Z0-9]", "", text.upper())
    if len(t) < 7:
        return t
    fix = lambda s: "".join(TO_DIGIT.get(c, c) for c in s)
    return fix(t[:2]) + t[2:-5] + fix(t[-5:])      # 2 số tỉnh + series + 5 số cuối


def format_plate(t):
    return f"{t[:-5]}-{t[-5:-2]}.{t[-2:]}" if len(t) >= 7 else t


def is_valid(t):
    return bool(CAR.match(t) or MOTO.match(t))
