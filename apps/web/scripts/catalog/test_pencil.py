#!/usr/bin/env python3
"""Unit tests for the hand-drawn line pass (pencil.py) inside stroke.normalise, on synthetic drawings.

Run from apps/web: python3 -B -m unittest discover -s scripts/catalog -p 'test_*.py'
"""
import hashlib
import io
import sys
import unittest
from unittest import mock
from pathlib import Path

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
import pencil  # noqa: E402
from generate import normalised_mask  # noqa: E402
from stroke import STROKE_TARGET, stroke_width  # noqa: E402


def png(draw, canvas=(900, 1200)):
    image = Image.new('L', canvas, 255)
    draw(ImageDraw.Draw(image))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    return buffer.getvalue()


def figure(d):
    """A stick figure: a small closed head, a torso that is the bar of two T-junctions, limbs as stems."""
    d.ellipse((380, 80, 520, 230), outline=0, width=10)
    d.line((450, 230, 450, 700), fill=0, width=14)
    d.line((450, 330, 250, 560), fill=0, width=9)
    d.line((450, 330, 650, 560), fill=0, width=9)
    d.line((450, 700, 300, 1100), fill=0, width=12)
    d.line((450, 700, 600, 1100), fill=0, width=12)
    d.rectangle((150, 1100, 750, 1150), outline=0, width=8)


def bar(d):
    """One long horizontal line with free ends, crossed by nothing."""
    d.line((60, 600, 840, 600), fill=0, width=12)


def diagonal(d):
    """A long, shallow diagonal: thinning leaves staircase pixels that must not pinch it."""
    d.line((60, 500, 840, 700), fill=0, width=12)


def tee(d):
    """A T: a long bar and a stem that meets it."""
    d.line((100, 300, 800, 300), fill=0, width=12)
    d.line((450, 300, 450, 1000), fill=0, width=12)


def rings(d):
    """Small closed parts (hands, dumbbell heads) hanging off a line: they must stay closed."""
    d.line((100, 600, 800, 600), fill=0, width=10)
    for x in (200, 450, 700):
        d.line((x, 600, x, 700), fill=0, width=10)
        d.ellipse((x - 45, 700, x + 45, 790), outline=0, width=10)


FIGURE, BAR, DIAGONAL, TEE, RINGS = png(figure), png(bar), png(diagonal), png(tee), png(rings)
# normalised_mask(FIGURE) and normalised_mask(FIGURE, box) before the pass existed (Pillow 12/13 builds agree):
# the licensed path (no line level) must keep producing exactly these bytes.
PLAIN_SHA = '0784aed3c752c0a615465a3e1cd28e35efcc64b10d1ffc9b7e896da2ae119e45'
PLAIN_BOX_SHA = 'f4f738ada55a64c0b5dfe9c92c2b575ab63282eafdd8f8a22b0be3d40230eb4a'


def alpha(webp):
    return Image.open(io.BytesIO(webp)).split()[-1]


def ink(webp):
    a = alpha(webp)
    return [[a.getpixel((x, y)) > 127 for x in range(a.width)] for y in range(a.height)]


def components(grid, paper=False):
    """Connected regions of ink (8-connected) or of paper (4-connected) in a boolean grid."""
    h, w = len(grid), len(grid[0])
    seen = [[False] * w for _ in range(h)]
    steps = [(0, 1), (1, 0), (0, -1), (-1, 0)] + ([] if paper else [(1, 1), (1, -1), (-1, 1), (-1, -1)])
    found = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or grid[y][x] == paper:
                continue
            stack, cells, border = [(y, x)], 0, False
            seen[y][x] = True
            while stack:
                cy, cx = stack.pop()
                cells += 1
                border |= cy in (0, h - 1) or cx in (0, w - 1)
                for dy, dx in steps:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny][nx] and grid[ny][nx] != paper:
                        seen[ny][nx] = True
                        stack.append((ny, nx))
            found.append((cells, border))
    return found


def holes(grid):
    return sum(1 for cells, border in components(grid, paper=True) if not border and cells > 2)


class LicensedDrawingsUntouched(unittest.TestCase):
    def test_without_a_line_level_the_mask_is_byte_identical_to_before(self):
        self.assertEqual(hashlib.sha256(normalised_mask(FIGURE)[0]).hexdigest(), PLAIN_SHA)
        self.assertEqual(hashlib.sha256(normalised_mask(FIGURE, (100, 50, 800, 1180))[0]).hexdigest(),
                         PLAIN_BOX_SHA)

    def test_off_is_the_plain_mask(self):
        self.assertEqual(normalised_mask(FIGURE, line='off'), normalised_mask(FIGURE))

    def test_an_unknown_level_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'unknown line level'):
            normalised_mask(FIGURE, line='heavy')


class Determinism(unittest.TestCase):
    def test_same_source_gives_the_same_bytes(self):
        self.assertEqual(normalised_mask(FIGURE, line='default'), normalised_mask(FIGURE, line='default'))

    def test_the_pass_changes_the_drawing_and_the_seed_comes_from_the_source(self):
        plain = normalised_mask(FIGURE)[0]
        passed = normalised_mask(FIGURE, line='default')[0]
        self.assertNotEqual(plain, passed)
        self.assertNotEqual(pencil.seed_of(FIGURE), pencil.seed_of(FIGURE + b'\0'))
        self.assertEqual(pencil.seed_of(FIGURE), pencil.seed_of(bytes(FIGURE)))


class LineWidthBand(unittest.TestCase):
    def test_every_level_is_tuned_to_the_catalog_width_after_the_pass(self):
        for level in ('light', 'default', 'strong'):
            for raw in (FIGURE, RINGS):
                width = stroke_width(normalised_mask(raw, line=level)[0])
                self.assertGreaterEqual(width, 1.7, level)
                self.assertLessEqual(width, 2.7, level)
                self.assertAlmostEqual(width, STROKE_TARGET, delta=0.15, msg=level)


class NoBrokenStrokes(unittest.TestCase):
    def test_a_long_line_never_breaks_or_thins_below_the_minimum_mid_stroke(self):
        for level, raw in [(level, raw) for level in ('light', 'default', 'strong') for raw in (BAR, DIAGONAL)]:
            grid = ink(normalised_mask(raw, line=level)[0])
            self.assertEqual(len(components(grid)), 1, level)
            width = len(grid[0])
            # Away from the free ends (where tapers may thin it), every column keeps ink.
            margin = round(width * pencil.LEVELS[level]['taper_len'] * 2.5 / 240) + 4
            for x in range(margin, width - margin):
                self.assertTrue(any(row[x] for row in grid), (level, x))

    def test_only_the_stem_of_a_t_may_lift_off_never_the_bar(self):
        for level in ('light', 'default', 'strong'):
            grid = ink(normalised_mask(TEE, line=level)[0])
            parts = sorted(cells for cells, _ in components(grid))
            # The bar is one piece; at most the stem has come away from it.
            self.assertLessEqual(len(parts), 2, level)
            bar_rows = [y for y, row in enumerate(grid) if sum(row) > len(row) * 0.6]
            self.assertTrue(bar_rows, level)
            row = grid[bar_rows[len(bar_rows) // 2]]
            first, last = row.index(True), len(row) - 1 - row[::-1].index(True)
            self.assertTrue(all(row[first:last + 1]), level)

    def test_the_bar_of_a_t_is_not_thinned_where_the_stem_meets_it(self):
        planned = {}

        def spy(skeleton, distance, unit, level, seed):
            planned['skeleton'], planned['scale'] = skeleton, plan(skeleton, distance, unit, level, seed)[0]
            return plan(skeleton, distance, unit, level, seed)
        plan = pencil.plan
        # Strong junction thinning without width noise, so only thinning can change the planned width.
        flat = dict(pencil.LEVELS['strong'], width_amp=0.0, jitter_amp=0.0, gap_rate=0.0)
        with mock.patch.dict(pencil.LEVELS, {'flat': flat}), mock.patch.object(pencil, 'plan', spy):
            normalised_mask(TEE, line='flat')
        skeleton, scale = planned['skeleton'], planned['scale']
        ys, xs = skeleton.nonzero()
        bar_y = max(set(ys.tolist()), key=ys.tolist().count)
        stem_x = int(round(float(xs[ys > bar_y + 40].mean())))
        near_bar = skeleton.copy()
        near_bar[:bar_y - 3] = False
        near_bar[bar_y + 4:] = False
        near_bar[:, :stem_x - 60] = False
        near_bar[:, stem_x + 61:] = False
        self.assertGreater(near_bar.sum(), 100)
        self.assertEqual(float(scale[near_bar].min()), 1.0)
        # The stem itself does thin as it runs into the bar.
        stem = skeleton.copy()
        stem[:bar_y + 4] = False
        self.assertLess(float(scale[stem].min()), 1.0)

    def test_small_closed_parts_stay_closed(self):
        before = holes(ink(normalised_mask(RINGS)[0]))
        self.assertGreaterEqual(before, 3)
        for level in ('light', 'default', 'strong'):
            self.assertEqual(holes(ink(normalised_mask(RINGS, line=level)[0])), before, level)


if __name__ == '__main__':
    unittest.main()
