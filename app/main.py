import sys
import tempfile
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))  # để import được src

import cv2
import streamlit as st

from src import config
from src.pipeline import process_frame

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException

from app.auth import router as auth_router, secret
from app.admin import router as admin_router
from app.alerts import router as alerts_router
from app.parking import router as parking_router
from app.recognition import router as recognition_router


@asynccontextmanager
async def lifespan(application):
    secret()
    yield


app = FastAPI(title="License Plate Parking API", version="1.0.0", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(alerts_router)
app.include_router(parking_router)
app.include_router(recognition_router, prefix="/api/v1")


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    codes = {400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "INVALID_REQUEST"}
    error = exc.detail if isinstance(exc.detail, dict) else {"code": codes.get(exc.status_code, "HTTP_ERROR"), "message": str(exc.detail)}
    return JSONResponse({"error": error}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": {"code": "INVALID_REQUEST", "message": "Request data is invalid"}}, status_code=422)


@app.exception_handler(IntegrityError)
async def constraint_error(request: Request, exc: IntegrityError):
    return JSONResponse({"error": {"code": "CONFLICT", "message": "Request conflicts with existing data"}}, status_code=409)


frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


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
