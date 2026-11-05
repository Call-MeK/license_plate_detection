import numpy as np

from src.brightness import adjust_brightness


def test_adjust_brightness_clips_without_changing_input():
    image = np.array([0, 100, 250], dtype=np.uint8)
    np.testing.assert_array_equal(adjust_brightness(image, 20), [20, 120, 255])
    np.testing.assert_array_equal(adjust_brightness(image, -20), [0, 80, 230])
    np.testing.assert_array_equal(image, [0, 100, 250])
