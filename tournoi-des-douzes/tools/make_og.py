#!/usr/bin/env python3
"""Compose l'illustration du jeu pour la page d'accueil (og.png, 5/3).

Trois combattants posés sur la table, dans les tons du plateau.
Usage : python3 tools/make_og.py
"""
import pathlib
import math
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
CARDS = ROOT / "cards"
# La vignette est affichée autour de 400 px de large : 900 px suffisent pour
# les écrans à haute densité sans alourdir la page d'accueil.
W, H = 900, 540

# (fichier, angle en degrés, décalage x, décalage y, échelle)
LAYOUT = [
    ("rosalie", -13, -0.275, 0.055, 0.90),
    ("goliath", 0, 0, -0.026, 1.0),
    ("david", 13, 0.275, 0.055, 0.90),
]

TABLE = (0.62, 0.60)   # demi-axes de la table, en fraction de W et H


def background():
    """Le plateau vu de dessus : bois sombre, lueur centrale, liseré d'or."""
    bg = Image.new("RGB", (W, H), (18, 13, 9))
    surf = Image.new("RGB", (W, H), (18, 13, 9))
    sd = ImageDraw.Draw(surf)
    rx, ry = W * TABLE[0], H * TABLE[1]
    for i in range(80, 0, -1):
        t = i / 80
        sd.ellipse(
            [W / 2 - rx * t, H / 2 - ry * t, W / 2 + rx * t, H / 2 + ry * t],
            fill=(int(26 + 58 * (1 - t)), int(18 + 40 * (1 - t)), int(11 + 21 * (1 - t))),
        )
    bg = surf.filter(ImageFilter.GaussianBlur(26))

    d = ImageDraw.Draw(bg, "RGBA")
    for w, a in ((7, 22), (2, 70)):
        d.ellipse([W / 2 - rx, H / 2 - ry, W / 2 + rx, H / 2 + ry],
                  outline=(232, 189, 82, a), width=w)
    return bg


def shadowed(card):
    """Carte avec son ombre portée, sur un calque transparent."""
    pad = 60
    layer = Image.new("RGBA", (card.width + 2 * pad, card.height + 2 * pad), (0, 0, 0, 0))
    shade = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(shade).rectangle(
        [pad, pad + 16, pad + card.width, pad + card.height + 16], fill=(0, 0, 0, 170))
    layer.alpha_composite(shade.filter(ImageFilter.GaussianBlur(22)))
    layer.alpha_composite(card, (pad, pad))
    return layer


def main():
    img = background().convert("RGBA")
    base_h = int(H * 0.78)
    for name, angle, fx, fy, scale in LAYOUT:
        dx, dy = fx * W, fy * H
        src = Image.open(CARDS / f"{name}.webp").convert("RGBA")
        h = int(base_h * scale)
        w = int(src.width * h / src.height)
        card = src.resize((w, h), Image.LANCZOS)

        # Fin liseré clair pour détacher la carte du fond.
        edged = Image.new("RGBA", (w + 4, h + 4), (238, 226, 196, 210))
        edged.alpha_composite(card, (2, 2))

        piece = shadowed(edged).rotate(angle, resample=Image.BICUBIC, expand=True)
        x = int(W / 2 + dx - piece.width / 2)
        y = int(H / 2 + dy - piece.height / 2)
        img.alpha_composite(piece, (x, y))

    # Vignetage : on ramène l'œil au centre.
    vig = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vig).ellipse([W * 0.02, -H * 0.10, W * 0.98, H * 1.10], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(90))
    dark = Image.new("RGBA", (W, H), (10, 7, 4, 255))
    img = Image.composite(img, Image.alpha_composite(dark, img), vig)

    # Palette réduite : ces illustrations sont en aplats, la vignette de la
    # page d'accueil n'a pas besoin de seize millions de couleurs.
    out = ROOT / "og.png"
    flat = img.convert("RGB")
    flat.quantize(colors=192, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(out, optimize=True)
    print(f"{out} — {W}×{H}, {out.stat().st_size / 1024:.0f} ko")


if __name__ == "__main__":
    main()
