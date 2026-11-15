"""Hand-drawn line pass for AI-assisted catalog drawings (Pillow and numpy).

Everkinetic's lines vary in width along a stroke, stop short where one line meets another and
taper at free ends; AI drawings have uniform, always-connected lines. `stroke.normalise` redraws
every line from its centre line, so this pass plans the variation on that centre line, once per
drawing, and the redraw paints it inside its width-tuning loop (the 2.1px mean line width is
measured after the pass):

1. Width: each centre pixel's width is scaled by smooth seeded noise (swell and thin along a line).
2. Tapers: a seeded share of free line ends thin towards the tip.
3. Junctions: a line thins a little as it runs into another line; the line it meets is untouched.
4. Gaps: at a T-junction the stem (never the bar that runs through) may stop short of the bar.
   At most one gap per junction, only on long enough lines, and a gap may open a closed shape only
   if that shape is large and not opened already, so hands, plates, pads and shoes stay closed.
5. Edge jitter: fine seeded noise on the width, clipped to 30% of the line's own width so it can
   never cut a line.

`stroke.normalise` also keeps the minimum line width everywhere except inside tapers and never
lets the pass fill paper narrower than `min_paper`. Everything is seeded from the source drawing's
SHA-256, so the same source always gives the same bytes. Licensed drawings never use this pass.
Lengths are in mask pixels (the 240px catalog mask); `unit` is working pixels per mask pixel.
"""
import hashlib

import numpy as np
from PIL import Image

VERSION = 'pencil-v1'
DEFAULT_LEVEL = 'default'
_SHARED = dict(width_sigma=5.0, width_min=0.55, min_width=0.9, jitter_sigma=0.5, taper_len=4.0,
               taper_tip=0.3, junction_len=5.0, gap_min_seg=8.0, gap_min_hole=600.0, gap_tip=0.6,
               fill_width=5.0, min_paper=3.0)
LEVELS = {
    'light': dict(_SHARED, width_amp=0.09, jitter_amp=0.04, taper_share=0.35, junction_tip=0.75,
                  gap_rate=0.20, gap_len=0.9),
    'default': dict(_SHARED, width_amp=0.14, jitter_amp=0.06, taper_share=0.6, junction_tip=0.6,
                    gap_rate=0.35, gap_len=1.1),
    'strong': dict(_SHARED, width_amp=0.19, jitter_amp=0.09, taper_share=0.8, junction_tip=0.45,
                   gap_rate=0.55, gap_len=1.4),
}
OFF = 'off'
_STEPS8 = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]


def seed_of(data):
    """Seed of a source drawing (its encoded bytes)."""
    return int.from_bytes(hashlib.sha256(VERSION.encode() + bytes(data)).digest()[:8], 'little')


def level_params(level):
    if level not in LEVELS:
        raise ValueError(f'unknown line level {level!r}')
    return LEVELS[level]


def _noise(rng, shape, spacing):
    """Smooth unit-variance noise: a seeded coarse grid, bicubic-upsampled to `shape`."""
    height, width = shape
    grid = rng.standard_normal((height // spacing + 4, width // spacing + 4)).astype(np.float32)
    image = Image.fromarray(grid).resize((grid.shape[1] * spacing, grid.shape[0] * spacing),
                                               Image.BICUBIC)
    field = np.asarray(image, np.float32)[spacing:spacing + height, spacing:spacing + width]
    return field / (field.std() or 1)


def _neighbours(mask):
    padded = np.pad(mask.astype(np.uint8), 1)
    h, w = mask.shape
    return sum(padded[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy, dx in _STEPS8)


def _arclen(points):
    if len(points) < 2:
        return np.zeros(len(points))
    steps = np.hypot(*np.diff(points, axis=0).T)
    return np.concatenate([[0.0], np.cumsum(steps)])


def _segments(skeleton):
    """Split a centre line into segments between free ends and junctions, in a fixed order.
    Returns [(points (n, 2) in walk order, (kind at start, kind at end))], kind 'end', 'junc',
    'open' or 'loop', plus the junction pixels."""
    count = _neighbours(skeleton) * skeleton
    ends = skeleton & (count == 1)
    junctions = skeleton & (count >= 3)
    near_junction = _neighbours(junctions) > 0
    body = {(int(y), int(x)) for y, x in np.argwhere(skeleton & ~junctions)}
    segments = []
    for start in sorted(body):
        if start not in body:
            continue
        stack, pixels = [start], {start}
        body.discard(start)
        while stack:
            y, x = stack.pop()
            for dy, dx in _STEPS8:
                q = (y + dy, x + dx)
                if q in body:
                    body.discard(q)
                    pixels.add(q)
                    stack.append(q)

        def around(p):
            return [(p[0] + dy, p[1] + dx) for dy, dx in _STEPS8 if (p[0] + dy, p[1] + dx) in pixels]
        tips = sorted(p for p in pixels if len(around(p)) <= 1)
        current = tips[0] if tips else min(pixels)
        order, seen = [current], {current}
        while True:
            nxt = sorted((abs(q[0] - current[0]) + abs(q[1] - current[1]), q)
                         for q in around(current) if q not in seen)
            if not nxt:
                break
            current = nxt[0][1]
            seen.add(current)
            order.append(current)

        def kind(p):
            return 'end' if ends[p] else 'junc' if near_junction[p] else 'open'
        kinds = (kind(order[0]), kind(order[-1])) if tips else ('loop', 'loop')
        segments.append((np.array(order), kinds))
    segments.sort(key=lambda s: (int(s[0][0, 0]), int(s[0][0, 1]), len(s[0])))
    return segments, junctions


def _junction_clusters(junctions):
    """Group junction pixels lying within 4 px of each other (one crossing drawn as a few pixels)."""
    pixels = sorted((int(y), int(x)) for y, x in np.argwhere(junctions))
    left, cluster = set(pixels), {}
    for start in pixels:
        if start not in left:
            continue
        left.discard(start)
        stack = [start]
        while stack:
            y, x = stack.pop()
            cluster[(y, x)] = start
            for q in [p for p in left if abs(p[0] - y) <= 4 and abs(p[1] - x) <= 4]:
                left.discard(q)
                stack.append(q)
    return cluster


class _Paper:
    """Paper regions (4-connected) of the centre-line image with a union-find, so a planned cut
    can tell whether it would open a closed shape and how large that shape is."""

    def __init__(self, skeleton):
        h, w = skeleton.shape
        self.label = np.full(skeleton.shape, -1, np.int32)
        parent, area, border = [], [], []

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        previous = []
        for y in range(h):
            row = np.concatenate([[True], skeleton[y], [True]])
            edges = np.flatnonzero(np.diff(row.astype(np.int8)))
            runs = list(zip(edges[::2].tolist(), edges[1::2].tolist()))  # paper [x0, x1)
            current = []
            j = 0
            for x0, x1 in runs:
                index = len(parent)
                parent.append(index)
                area.append(x1 - x0)
                border.append(y in (0, h - 1) or x0 == 0 or x1 == w)
                while j < len(previous) and previous[j][1] <= x0:
                    j += 1
                k = j
                while k < len(previous) and previous[k][0] < x1:
                    a, b = root(previous[k][2]), root(index)
                    if a != b:
                        parent[b] = a
                        area[a] += area[b]
                        border[a] = border[a] or border[b]
                    k += 1
                current.append((x0, x1, index))
            for x0, x1, index in current:
                self.label[y, x0:x1] = index
            previous = current
        self.parent, self.area, self.border, self._root = parent, area, border, root

    def regions_around(self, ys, xs):
        h, w = self.label.shape
        found = set()
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            yy, xx = np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)
            found.update(self._root(int(i)) for i in self.label[yy, xx] if i >= 0)
        return found

    def merge(self, roots):
        roots = sorted(roots)
        for other in roots[1:]:
            a, b = self._root(roots[0]), self._root(other)
            if a != b:
                self.parent[b] = a
                self.area[a] += self.area[b]
                self.border[a] = self.border[a] or self.border[b]


def plan(skeleton, distance, unit, level, seed):
    """Plan the pass on a drawing's centre line.

    skeleton: bool array (centre pixels); distance: each centre pixel's half-width in working px.
    Returns (width scale, floor, jitter, cut, min_paper): per-pixel arrays the redraw applies to
    each centre pixel (width scale multiplies the line width; floor is the minimum width in working
    px, lower only inside tapers; jitter in working px is added to the radius; cut pixels are not
    drawn) and the narrowest paper (working px) the pass may not fill.
    """
    p = level_params(level)
    rng = np.random.default_rng(seed)
    shape = skeleton.shape
    # Every random field is drawn first, in a fixed order, so draws never depend on the drawing.
    width_noise = _noise(rng, shape, max(2, round(2 * p['width_sigma'] * unit)))
    jitter_noise = _noise(rng, shape, max(2, round(2 * p['jitter_sigma'] * unit)))
    segments, junctions = _segments(skeleton)
    draws = np.random.default_rng(rng.integers(2 ** 63)).random((len(segments), 6))
    cluster = _junction_clusters(junctions)

    def cluster_of(point):
        y, x = int(point[0]), int(point[1])
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if (y + dy, x + dx) in cluster:
                    return cluster[(y + dy, x + dx)]
        return None

    # Each junction end's outward direction, about 3 mask px along its segment.
    ends_at, end_cluster = {}, {}
    for k, (points, kinds) in enumerate(segments):
        s = _arclen(points)
        for side, kind in enumerate(kinds):
            if kind != 'junc':
                continue
            tip = points[0] if side == 0 else points[-1]
            along = s if side == 0 else s[-1] - s
            far = points[np.argmin(np.abs(along - min(3 * unit, s[-1])))]
            v = np.array([far[0] - tip[0], far[1] - tip[1]], float)
            v /= np.hypot(*v) or 1
            c = cluster_of(tip)
            if c is not None:
                end_cluster[(k, side)] = c
                ends_at.setdefault(c, []).append((k, side, v))

    def runs_through(k, side):
        """True when another line leaves the junction straight opposite: this end is part of a bar."""
        c = end_cluster[(k, side)]
        (v,) = [w for kk, ss, w in ends_at[c] if (kk, ss) == (k, side)]
        return any(np.dot(v, w) < -0.82 for kk, ss, w in ends_at[c] if (kk, ss) != (k, side))

    taper = np.ones(shape, np.float32)
    thin = np.ones(shape, np.float32)
    cut = np.zeros(shape, bool)
    paper = _Paper(skeleton)
    opened, cut_clusters = set(), set()
    min_hole = p['gap_min_hole'] * unit ** 2
    for k, (points, kinds) in enumerate(segments):
        s = _arclen(points)
        length = s[-1]
        ys, xs = points[:, 0], points[:, 1]
        radius = distance[ys, xs].astype(np.float64)
        if 2 * np.median(radius) / unit > p['fill_width']:
            continue  # a solid fill keeps its drawn shape
        for side, kind in enumerate(kinds):
            along = s if side == 0 else length - s
            if kind == 'end' and length > 2 * p['taper_len'] * unit and draws[k, side] < p['taper_share']:
                span = p['taper_len'] * unit * (0.7 + 0.6 * draws[k, 2])
                t = p['taper_tip'] + (1 - p['taper_tip']) * np.sqrt(np.clip(along / span, 0, 1))
                taper[ys, xs] = np.minimum(taper[ys, xs], t)
            # only a line that ends at another one thins; a line running through (the bar of a T,
            # the arms of a crossing, a staircase pixel mid-line) keeps its width
            if (kind == 'junc' and p['junction_tip'] < 1 and length >= 3 * unit
                    and (k, side) in end_cluster and not runs_through(k, side)):
                tip = points[0] if side == 0 else points[-1]
                host = distance[max(0, tip[0] - 3):tip[0] + 4, max(0, tip[1] - 3):tip[1] + 4].max()
                span = min(length / 2, p['junction_len'] * unit)
                f = np.clip((along - host) / span, 0, 1)
                t = p['junction_tip'] + (1 - p['junction_tip']) * np.sin(f * np.pi / 2)
                t[along <= host] = 1.0  # inside the line it meets: that line stays as drawn
                thin[ys, xs] = np.minimum(thin[ys, xs], t)
        stems = [side for side, kind in enumerate(kinds) if kind == 'junc' and (k, side) in end_cluster
                 and not runs_through(k, side) and end_cluster[(k, side)] not in cut_clusters]
        if not stems or length < p['gap_min_seg'] * unit or draws[k, 3] >= p['gap_rate']:
            continue
        side = stems[int(draws[k, 4] * len(stems))]
        along = s if side == 0 else length - s
        tip = points[0] if side == 0 else points[-1]
        host = distance[max(0, tip[0] - 3):tip[0] + 4, max(0, tip[1] - 3):tip[1] + 4].max()
        # paper between the host line's edge and this line's rounded end
        reach = host + np.median(radius) + p['gap_len'] * unit * (0.8 + 0.4 * draws[k, 5])
        lifted = along <= reach
        if lifted.all():
            continue
        regions = paper.regions_around(ys[lifted], xs[lifted])
        enclosed = {r for r in regions if not paper.border[r]}
        if len(regions) >= 2 and enclosed:
            # the gap would open a closed shape: only a large one, and only once
            if any(paper.area[r] < min_hole for r in enclosed) or enclosed & opened:
                continue
            opened |= enclosed
        paper.merge(regions)
        opened = {paper._root(r) for r in opened}
        cut[ys[lifted], xs[lifted]] = True
        cut_clusters.add(end_cluster[(k, side)])
        # the pencil lifts off: the cut end tapers a little
        t = p['gap_tip'] + (1 - p['gap_tip']) * np.sqrt(np.clip((along - reach) / (p['taper_len'] * unit), 0, 1))
        taper[ys, xs] = np.minimum(taper[ys, xs], t)
    scale = np.clip(1 + p['width_amp'] * width_noise, p['width_min'], 1 + 3 * p['width_amp']) * taper * thin
    floor = np.where(taper < 1, taper, 1.0).astype(np.float32) * p['min_width'] * unit
    jitter = p['jitter_amp'] * unit * np.clip(jitter_noise, -2.5, 2.5)
    return scale, floor, jitter, cut, p['min_paper'] * unit
