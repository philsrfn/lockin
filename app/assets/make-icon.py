"""
The lockin app icon: a padlock whose keyhole is a dumbbell.

Two readings in one silhouette — the name, and what the app is for. Kept as a
script rather than a binary because every size the app needs (iOS, the two
Android adaptive layers, the monochrome layer, the splash, the favicon) is the
same geometry at a different scale, and because an icon nobody can edit is an
icon nobody will edit.

    python3 assets/make-icon.py

Geometry is defined against a 1024 canvas and scaled from there. Everything is
drawn at 4x and resampled down, which is what keeps the arcs clean.
"""

from PIL import Image, ImageDraw, ImageFilter

# The app's own ink, on a ground a shade above its background. Pure #0B0B0C
# reads as a hole punched in the home screen; lifting it slightly lets the
# tile keep an edge against a dark wallpaper.
GROUND = (0x16, 0x18, 0x1A)
BONE = (0xED, 0xEA, 0xE3)

SS = 4  # supersampling factor

# --- geometry, against a 1024 canvas ----------------------------------------
BODY_W, BODY_H, BODY_R = 430, 350, 78
SHACKLE_W = 240          # narrower than the body, so its shoulders stay visible
SHACKLE_THICK = 58
# Taller than a padlock usually is. At 20pt the housing is just a blob and the
# shackle is the only thing still saying "lock", so it gets the extra height.
SHACKLE_H = 240

# Plates thick enough to read as weight. Slimmer ones and a longer bar turn the
# keyhole into a letter H, which is the failure mode this shape has.
PLATE_W, PLATE_H, PLATE_R = 76, 132, 20
DUMBBELL_W = 232         # outer edge to outer edge
BAR_H, BAR_R = 44, 14


def mark_mask(size: int, coverage: float = 0.60) -> Image.Image:
    """
    The lock as a single-channel mask: 255 is bone, 0 is ground. Built once and
    reused for every output, so the keyhole is a real hole rather than a shape
    painted in the background colour — which is what lets the Android and
    splash layers be transparent.

    `coverage` is the mark's height as a fraction of the canvas. iOS crops the
    corners with a squircle and Android crops harder still, so each caller asks
    for the room its platform leaves.
    """
    canvas = size * SS
    mask = Image.new('L', (canvas, canvas), 0)
    draw = ImageDraw.Draw(mask)

    total_h = SHACKLE_H + BODY_H
    scale = (canvas * coverage) / total_h
    s = lambda v: v * scale  # noqa: E731 — reads better than a def here

    cx = canvas / 2
    top = (canvas - s(total_h)) / 2 - canvas * 0.012

    # --- shackle: an annulus with its lower half replaced by straight legs ---
    outer_r = s(SHACKLE_W) / 2
    inner_r = outer_r - s(SHACKLE_THICK)
    arc_cy = top + outer_r

    draw.ellipse([cx - outer_r, arc_cy - outer_r, cx + outer_r, arc_cy + outer_r], fill=255)
    draw.ellipse([cx - inner_r, arc_cy - inner_r, cx + inner_r, arc_cy + inner_r], fill=0)
    # Everything below the arc's centre belongs to the legs, not the ring.
    draw.rectangle([cx - outer_r, arc_cy, cx + outer_r, canvas], fill=0)

    body_top = top + s(SHACKLE_H)
    leg_bottom = body_top + s(BODY_R) / 2  # tuck behind the housing's shoulder
    for sign in (-1, 1):
        near, far = inner_r * sign, outer_r * sign
        draw.rectangle([cx + min(near, far), arc_cy, cx + max(near, far), leg_bottom], fill=255)

    # --- housing --------------------------------------------------------
    body_w, body_h = s(BODY_W), s(BODY_H)
    draw.rounded_rectangle(
        [cx - body_w / 2, body_top, cx + body_w / 2, body_top + body_h],
        radius=s(BODY_R),
        fill=255,
    )

    # --- the keyhole, which is a dumbbell --------------------------------
    key_cy = body_top + body_h / 2
    plate_w, plate_h = s(PLATE_W), s(PLATE_H)
    half = s(DUMBBELL_W) / 2
    bar_h = s(BAR_H)

    # The bar runs into the plates rather than butting against them, so the
    # three shapes resolve as one object.
    draw.rounded_rectangle(
        [cx - half + plate_w * 0.6, key_cy - bar_h / 2,
         cx + half - plate_w * 0.6, key_cy + bar_h / 2],
        radius=s(BAR_R),
        fill=0,
    )
    for sign in (-1, 1):
        outer, inner = cx + sign * half, cx + sign * (half - plate_w)
        draw.rounded_rectangle(
            [min(outer, inner), key_cy - plate_h / 2,
             max(outer, inner), key_cy + plate_h / 2],
            radius=s(PLATE_R),
            fill=0,
        )

    return mask.resize((size, size), Image.LANCZOS)


def glass_ground(size: int) -> Image.Image:
    """
    A restrained vertical lift, and a soft glow behind the mark. Enough that the
    tile has depth on a home screen; not so much that it stops matching an app
    whose whole design is flat ink on paper.
    """
    tile = Image.new('RGB', (size, size), GROUND)
    gradient = Image.new('L', (1, size))
    for y in range(size):
        gradient.putpixel((0, y), int(26 * (1 - y / size) ** 1.6))
    tile = Image.composite(
        Image.new('RGB', (size, size), (0x2A, 0x2D, 0x31)),
        tile,
        gradient.resize((size, size)),
    )

    halo = Image.new('L', (size, size), 0)
    ImageDraw.Draw(halo).ellipse(
        [size * 0.16, size * 0.10, size * 0.84, size * 0.78], fill=30
    )
    halo = halo.filter(ImageFilter.GaussianBlur(size * 0.13))
    return Image.composite(Image.new('RGB', (size, size), (0x33, 0x37, 0x3C)), tile, halo)


def opaque(size: int, coverage: float = 0.60) -> Image.Image:
    """iOS wants a full-bleed square with no alpha — it applies its own mask."""
    tile = glass_ground(size)
    tile.paste(Image.new('RGB', (size, size), BONE), (0, 0), mark_mask(size, coverage))
    return tile


def cutout(size: int, colour=BONE, coverage: float = 0.60) -> Image.Image:
    """The mark alone, on nothing."""
    layer = Image.new('RGBA', (size, size), colour + (0,))
    layer.putalpha(mark_mask(size, coverage))
    return layer


if __name__ == '__main__':
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    out = lambda name: os.path.join(here, name)  # noqa: E731

    opaque(1024).save(out('icon.png'))
    # Android crops an adaptive icon to a circle at worst, so the mark gets
    # markedly less room than on iOS.
    cutout(512, coverage=0.44).save(out('android-icon-foreground.png'))
    Image.new('RGB', (512, 512), GROUND).save(out('android-icon-background.png'))
    cutout(432, colour=(255, 255, 255), coverage=0.44).save(out('android-icon-monochrome.png'))
    cutout(1024, coverage=0.50).save(out('splash-icon.png'))
    opaque(48, coverage=0.60).save(out('favicon.png'))

    print('wrote icon, splash, favicon and the three Android layers')
