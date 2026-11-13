"""Line-width normalisation for catalog drawings (Pillow only).

Every bundled drawing, licensed or app-owned, is redrawn from its full-size source so that its
mean line width in the 240px mask matches the licensed Everkinetic set:

1. Crop to the ink and scale so the long side is WORK pixels (6x the mask), then binarise.
2. Find each line's centre (Zhang-Suen thinning, short spurs pruned) and its half-width there
   (chamfer distance to the paper).
3. Redraw every centre pixel as a disc whose width is the drawn width times one factor per
   drawing, so heavy outlines stay heavier than interior lines. Solid fills (much wider than
   the drawing's typical line) keep their drawn size. Fractional radii are dithered so widths
   are not limited to whole working pixels.
4. Tune the factor (a few rounds) until `stroke_width` of the final mask reads STROKE_TARGET.

The pose and every line stay where they were drawn; only line weight changes.
"""
import io
import math

from PIL import Image, ImageChops, ImageFilter, ImageMorph, ImageOps

# Mean line width (px): the median of the licensed drawings' 240px masks before
# normalisation. tests/catalog.test.ts holds every bundled drawing to their 5th-95th
# percentile band.
STROKE_TARGET = 2.1
WORK = 1440  # working long side: 6 working pixels per mask pixel
MASK_SIDE = 240
INK = 96  # binarisation threshold on 0-255 ink
FILL = 2.5  # past this many typical half-widths a shape is a solid fill: kept, not rescaled
MIN_WIDTH = 1.2  # thinnest redrawn line, in mask pixels
ROUNDS = 4


def _lut(rule):
    """ImageMorph lookup table: bit k of the index is the 3x3 neighbour k in row-major order."""
    return bytearray(rule([(index >> k) & 1 for k in range(9)]) for index in range(512))


def _thinning(step):
    def rule(n):
        if not n[4]:
            return 0
        p = [n[1], n[2], n[5], n[8], n[7], n[6], n[3], n[0]]  # north, then clockwise
        neighbours = sum(p)
        transitions = sum(1 for k in range(8) if not p[k] and p[(k + 1) % 8])
        if not (2 <= neighbours <= 6 and transitions == 1):
            return 1
        if step == 0:
            return 0 if not p[0] * p[2] * p[4] and not p[2] * p[4] * p[6] else 1
        return 0 if not p[0] * p[2] * p[6] and not p[0] * p[4] * p[6] else 1
    return rule


_OPS = {
    'thin0': _thinning(0),
    'thin1': _thinning(1),
    'dilate4': lambda n: int(any(n[k] for k in (1, 3, 4, 5, 7))),
    'dilate8': lambda n: int(any(n)),
    'erode4': lambda n: int(all(n[k] for k in (1, 3, 4, 5, 7))),
    'erode8': lambda n: int(all(n)),
    'unend': lambda n: int(n[4] and sum(n) > 2),  # drop line ends (one neighbour or none)
    'ends': lambda n: int(n[4] and sum(n) == 2),
}
_MORPH = {}


def _morph(name, image):
    if name not in _MORPH:
        _MORPH[name] = ImageMorph.MorphOp(lut=_lut(_OPS[name]))
    return _MORPH[name].apply(image)


def _step(kind, image, i):
    """One octagonal step: alternate 4- and 8-neighbourhoods so repeated steps grow discs."""
    return _morph(f'{kind}{8 if i % 2 else 4}', image)[1]


def _thin(binary):
    while True:
        first, binary = _morph('thin0', binary)
        second, binary = _morph('thin1', binary)
        if not first and not second:
            return binary


def _distance(binary):
    """Chamfer distance of each ink pixel to the paper (1 at the edge)."""
    distance = Image.new('L', binary.size, 0)
    for i in range(255):
        if not binary.getbbox():
            break
        distance = ImageChops.add(distance, binary.point(lambda v: 1 if v else 0))
        binary = _step('erode', binary, i)
    return distance


def _prune(skeleton, length):
    """Remove side branches shorter than `length`, then regrow the true line ends."""
    pruned = skeleton
    for _ in range(length):
        pruned = _morph('unend', pruned)[1]
    ends = _morph('ends', pruned)[1]
    removed = ImageChops.subtract(skeleton, pruned)
    grown = ends
    for _ in range(length):
        grown = ImageChops.lighter(ImageChops.multiply(_morph('dilate8', grown)[1], removed), ends)
    return ImageChops.lighter(pruned, grown)


def _median(histogram):
    total = sum(histogram[1:])
    seen = 0
    for value in range(1, 256):
        seen += histogram[value]
        if 2 * seen >= total:
            return value
    return 0


def _dither(size):
    """Tiled 4x4 Bayer thresholds (8..248)."""
    tile = Image.new('L', (4, 4))
    tile.putdata([v * 16 + 8 for v in (0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)])
    row = Image.new('L', (size[0], 4))
    for x in range(0, size[0], 4):
        row.paste(tile, (x, 0))
    thresholds = Image.new('L', size)
    for y in range(0, size[1], 4):
        thresholds.paste(row, (0, y))
    return thresholds


def stroke_width(mask_webp):
    """Mean line width (px) of a line_mask WebP: 2 x ink area / outline length. The outline is
    measured with Crofton's formula over four directions, so diagonal lines count like straight
    ones. Ink is alpha above half. Same measure as `strokeWidth` in tests/catalog.test.ts."""
    alpha = Image.open(io.BytesIO(mask_webp)).split()[-1]
    ink = ImageOps.expand(alpha.point(lambda v: 255 if v > 127 else 0), 1, 0)
    width, height = ink.size

    def crossings(a, b):
        return ImageChops.difference(ink.crop(a), ink.crop(b)).histogram()[255]

    area = ink.histogram()[255]
    across = crossings((0, 0, width - 1, height), (1, 0, width, height))
    down = crossings((0, 0, width, height - 1), (0, 1, width, height))
    diagonal = crossings((0, 0, width - 1, height - 1), (1, 1, width, height))
    antidiagonal = crossings((1, 0, width, height - 1), (0, 1, width - 1, height))
    outline = math.pi / 8 * (across + down + (diagonal + antidiagonal) / math.sqrt(2))
    return 2 * area / outline if outline else 0


def normalise(image, measure):
    """Redraw a white-ground drawing (PIL image or encoded bytes) with STROKE_TARGET-wide lines.

    `measure(png_bytes)` returns the mask line width of a candidate (stroke_width of its
    line_mask). Returns the redrawn drawing as white-ground greyscale PNG bytes.
    """
    if isinstance(image, (bytes, bytearray)):
        image = Image.open(io.BytesIO(image))
    if image.mode != 'L':
        image = image.convert('RGBA')
        image = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image).convert('L')
    ink = ImageOps.invert(image)
    box = ink.point(lambda v: 255 if v >= 24 else 0).getbbox()
    if not box:
        raise ValueError('drawing has no ink')
    ink = ink.crop(box)
    scale = WORK / max(ink.size)
    ink = ink.resize((max(1, round(ink.width * scale)), max(1, round(ink.height * scale))),
                     Image.LANCZOS)
    ink = ImageOps.expand(ink, WORK // 20, 0)
    binary = ink.point(lambda v: 255 if v >= INK else 0)
    distance = _distance(binary)
    skeleton = _thin(binary)
    typical = _median(ImageChops.multiply(distance, skeleton).histogram())
    skeleton = _prune(skeleton, typical)
    radii = ImageChops.multiply(distance, skeleton)
    centre = skeleton.point(lambda v: 1 if v else 0)
    thresholds = _dither(binary.size)
    unit = WORK / MASK_SIDE

    def draw(factor):
        def line(d):
            return max(1.0, (max(MIN_WIDTH * unit, (2 * d - 1) * factor) + 1) / 2)

        whole, fraction = [0], [0]
        fill = FILL * typical
        for d in range(1, 256):
            # Past the fill threshold the shape keeps its drawn extent beyond the rescaled
            # line, so a stroke widening into a fill stays continuous.
            radius = line(d) if d <= fill else line(fill) + d - fill
            whole.append(int(radius))
            fraction.append(min(255, round((radius - int(radius)) * 256)))
        bump = ImageChops.subtract(radii.point(fraction), thresholds).point(lambda v: 1 if v else 0)
        target = ImageChops.add(radii.point(whole), ImageChops.multiply(bump, centre.point(lambda v: 255 * v)))
        target = target.point(lambda v: min(v, 255))
        present = [r for r, count in enumerate(target.histogram()) if count and r]
        lines = Image.new('L', binary.size, 0)
        for r in range(max(present, default=0), 0, -1):
            lines = ImageChops.lighter(lines, target.point(lambda v, r=r: 255 if v == r else 0))
            if r > 1:
                lines = _step('dilate', lines, r)
        lines = lines.filter(ImageFilter.GaussianBlur(unit / 4))
        buffer = io.BytesIO()
        ImageOps.invert(lines).save(buffer, 'PNG')
        return buffer.getvalue()

    factor = STROKE_TARGET * unit / (2 * typical - 1)
    best = None
    for _ in range(ROUNDS):
        png = draw(factor)
        width = measure(png)
        if width <= 0:
            raise ValueError('normalised drawing has no opaque line work')
        if best is None or abs(width - STROKE_TARGET) < abs(best[0] - STROKE_TARGET):
            best = (width, png)
        if abs(width - STROKE_TARGET) < 0.03:
            break
        factor *= STROKE_TARGET / width
    return best[1]
