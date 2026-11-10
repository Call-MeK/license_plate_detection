"""Adjust the brightness of an 8-bit image."""
import numpy as np


def adjust_brightness(image, amount):
    """Return a brighter or darker copy; amount is a signed pixel offset."""
    return np.clip(image.astype(np.float64) + amount, 0, 255).astype(np.uint8)
