import sys
import tempfile
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))  # để import được src

import cv2
import streamlit as st

from src import config
from src.pipeline import process_frame

st.title("Nhận diện biển số xe")
if config.USE_STUB:
    st.caption("Đang chạy bản giả (USE_STUB=True trong src/config.py)")

uploaded = st.file_uploader("Chọn video", type=["mp4", "avi", "mov"])
if uploaded:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f:
        f.write(uploaded.read())
    cap = cv2.VideoCapture(f.name)
    placeholder = st.empty()
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        frame, _ = process_frame(frame)
        placeholder.image(frame, channels="BGR")
    cap.release()
