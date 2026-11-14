#!/usr/bin/env python3
"""Unit tests for generated.py's mask step, on synthetic drawings (no QA cache needed).

Run from apps/web: python3 -B -m unittest discover -s scripts/catalog -p 'test_*.py'
"""
import io
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from generate import normalised_mask  # noqa: E402
from generated import pose_masks  # noqa: E402
from stroke import STROKE_TARGET, stroke_width  # noqa: E402

CANVAS = (900, 1200)


def drawing(box, canvas=CANVAS):
    """A white-ground PNG with one outlined rectangle at box = (x0, y0, x1, y1)."""
    image = Image.new('L', canvas, 255)
    ImageDraw.Draw(image).rectangle(box, outline=0, width=12)
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    return buffer.getvalue()


def ink_box(webp):
    return Image.open(io.BytesIO(webp)).split()[-1].point(lambda v: 255 if v > 127 else 0).getbbox()


# A low, wide start (a plank) and a tall, narrow finish (a jump) on one canvas, standing on one floor line.
LOW = drawing((150, 950, 750, 1100))
TALL = drawing((400, 100, 500, 1100))


class PoseMasks(unittest.TestCase):
    def test_a_shared_scale_pair_is_cropped_with_one_box(self):
        (low, low_size), (tall, tall_size) = pose_masks([LOW, TALL], shared_scale=True)
        self.assertEqual(low_size, tall_size)
        # One box: the wide frame keeps its true size next to the tall one and stands on the same floor.
        low_ink, tall_ink = ink_box(low), ink_box(tall)
        low_width, tall_height = low_ink[2] - low_ink[0], tall_ink[3] - tall_ink[1]
        self.assertAlmostEqual(low_width / tall_height, 600 / 1000, delta=0.03)
        self.assertAlmostEqual(low_ink[3], tall_ink[3], delta=2)
        # Lines are tuned at the size the app shows, so both frames keep the catalog line width.
        for mask in (low, tall):
            self.assertAlmostEqual(stroke_width(mask), STROKE_TARGET, delta=0.15)

    def test_each_frame_is_cropped_to_its_own_drawing_by_default(self):
        masks = pose_masks([LOW, TALL])
        self.assertEqual(masks, [normalised_mask(LOW), normalised_mask(TALL)])
        self.assertEqual(max(masks[0][1]), 240)
        self.assertEqual(max(masks[1][1]), 240)

    def test_a_shared_scale_pair_needs_two_frames_on_one_canvas(self):
        with self.assertRaisesRegex(ValueError, 'start/finish pair'):
            pose_masks([LOW], shared_scale=True)
        with self.assertRaisesRegex(ValueError, 'one canvas size'):
            pose_masks([LOW, drawing((400, 100, 500, 1100), canvas=(1000, 1200))], shared_scale=True)


if __name__ == '__main__':
    unittest.main()
