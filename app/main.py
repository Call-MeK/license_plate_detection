import sys
import tempfile
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))  # để import được src

import cv2
import streamlit as st

from src import config
from src.pipeline import process_frame

def display_video(path):
    cap = cv2.VideoCapture(str(path))
    try:
        frame_placeholder = st.empty()
        observations_placeholder = st.empty()
        while cap.isOpened():
            ok, frame = cap.read()
            if not ok:
                break
            annotated_frame, observations = process_frame(frame)
            frame_placeholder.image(annotated_frame, channels="BGR")
            observations_placeholder.dataframe(observations, hide_index=True)
    finally:
        cap.release()


def main():
    st.title("Nhận diện biển số xe")
    if config.USE_STUB:
        st.caption("Đang chạy bản giả (USE_STUB=True trong src/config.py)")

    uploaded = st.file_uploader("Chọn video", type=["mp4", "avi", "mov"])
    if uploaded:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "video.mp4"
            path.write_bytes(uploaded.read())
            display_video(path)


if __name__ == "__main__":
    main()
