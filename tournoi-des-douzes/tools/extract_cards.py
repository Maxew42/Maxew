#!/usr/bin/env python3
"""Extrait le rectangle de la carte depuis les photos d'écran de assets/.

Les sources sont des photos d'un moniteur : fond noir, mur clair en haut,
bureau en bas. La carte est un rectangle très allongé (~1:2.6) bordé de pierre
claire. On isole la carte, on corrige la perspective, et on écrit un PNG net
dans cards/.

Usage : python3 tools/extract_cards.py [--debug]
"""
import sys
import pathlib
import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
OUT = ROOT / "cards"
DBG = pathlib.Path(
    "/private/tmp/claude-501/-Users-Novatix-Documents-projects-games/"
    "6146b6f1-e560-40d5-a662-081b776e47e8/scratchpad/dbg"
)

# Redressement en pleine résolution, puis export web.
OUT_W, OUT_H = 620, 1600
WEB_W, WEB_H = 465, 1200
WEBP_Q = 86

DEBUG = "--debug" in sys.argv
KEEP_PNG = "--png" in sys.argv


def order_corners(pts):
    """Ordonne 4 points en (haut-gauche, haut-droite, bas-droite, bas-gauche)."""
    pts = np.array(pts, dtype=np.float32).reshape(4, 2)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    # tri horaire en partant du coin haut-gauche (angle ~ -135°)
    idx = np.argsort((ang + 2 * np.pi + np.pi * 0.75) % (2 * np.pi))
    return pts[idx]


def fill_holes(mask):
    """Remplit les cavités closes sans dilater la silhouette.

    Une cavité = composante du fond qui ne touche aucun bord de l'image.
    """
    h, w = mask.shape
    inv = cv2.bitwise_not(mask)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    out = mask.copy()
    for i in range(1, n):
        x, y, cw, ch, _ = stats[i]
        if x <= 0 or y <= 0 or x + cw >= w or y + ch >= h:
            continue  # relié à l'extérieur : ce n'est pas un trou
        out[labels == i] = 255
    return out


def card_mask(bgr, thresh=78):
    """Masque binaire de la carte : clair, non collé aux bords de l'image."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    # Tout ce qui n'est pas le noir du moniteur / de l'écran.
    mask = (gray > thresh).astype(np.uint8) * 255

    # Petite fermeture : soude le liseré de pierre là où le JPEG l'a grignoté,
    # sans franchir le cadre noir du moniteur (~40 px).
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    mask = fill_holes(mask)

    # Supprime les composantes qui touchent un bord (mur, bureau, reflets).
    h, w = mask.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        if x <= 1 or y <= 1 or x + cw >= w - 1 or y + ch >= h - 1:
            continue
        if area < 0.02 * h * w:
            continue
        keep[labels == i] = 255
    # Lisse le contour final (le liseré peut rester dentelé).
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, k2)
    return fill_holes(keep)


def find_quad(mask):
    """Quadrilatère de la carte, ou None."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    best, best_area = None, 0
    for c in cnts:
        area = cv2.contourArea(c)
        if area < best_area:
            continue
        hull = cv2.convexHull(c)
        peri = cv2.arcLength(hull, True)
        quad = None
        # epsilon croissant jusqu'à tomber sur 4 sommets
        for eps in np.arange(0.005, 0.10, 0.002):
            ap = cv2.approxPolyDP(hull, eps * peri, True)
            if len(ap) == 4:
                quad = ap
                break
            if len(ap) < 4:
                break
        if quad is None:
            rect = cv2.minAreaRect(hull)
            quad = cv2.boxPoints(rect).reshape(4, 1, 2)
        pts = order_corners(quad)
        wtop = np.linalg.norm(pts[1] - pts[0])
        wbot = np.linalg.norm(pts[2] - pts[3])
        hl = np.linalg.norm(pts[3] - pts[0])
        hr = np.linalg.norm(pts[2] - pts[1])
        ratio = ((wtop + wbot) / 2) / max((hl + hr) / 2, 1)
        if not (0.28 <= ratio <= 0.52):
            continue
        best, best_area = pts, area
    return best


def process(path):
    bgr = cv2.imread(str(path))
    if bgr is None:
        raise SystemExit(f"lecture impossible : {path}")
    quad = mask = None
    for thresh in (78, 60, 95, 110, 45):
        mask = card_mask(bgr, thresh)
        quad = find_quad(mask)
        if quad is not None:
            break
    if quad is None:
        raise SystemExit(f"carte introuvable : {path.name}")

    dst = np.array(
        [[0, 0], [OUT_W - 1, 0], [OUT_W - 1, OUT_H - 1], [0, OUT_H - 1]],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    warp = cv2.warpPerspective(
        bgr, M, (OUT_W, OUT_H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )

    if DEBUG:
        DBG.mkdir(parents=True, exist_ok=True)
        vis = bgr.copy()
        cv2.polylines(vis, [quad.astype(np.int32)], True, (0, 255, 0), 6)
        for i, p in enumerate(quad.astype(int)):
            cv2.circle(vis, tuple(p), 18, (0, 0, 255), -1)
            cv2.putText(vis, str(i), tuple(p), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 4)
        cv2.imwrite(str(DBG / f"quad-{path.stem}.jpg"), vis)
        cv2.imwrite(str(DBG / f"mask-{path.stem}.jpg"), mask)

    return warp, quad


# La photo du Père Pair a été prise pendant une lecture vidéo : la barre de
# contrôle translucide recouvre le liseré de pierre du bas. On la remplace par
# le même liseré pris sur une autre carte (même canevas 620×1600 après
# redressement), en recalant la teinte sur celle de la photo cible.
PATCH_BOTTOM = {"le-pere-pair": ("jeanne", 1556)}


def patch_bottom(name, warp, cards):
    """Recolle le liseré du bas depuis une carte donneuse (barre vidéo parasite)."""
    donor_name, y0 = PATCH_BOTTOM[name]
    donor = cards[donor_name]

    # Référence de teinte : colonne de pierre gauche, hors zone parasitée.
    ref_t = warp[1150:1500, 4:32].reshape(-1, 3).mean(axis=0)
    ref_d = donor[1150:1500, 4:32].reshape(-1, 3).mean(axis=0)
    gain = np.clip(ref_t / np.maximum(ref_d, 1), 0.6, 1.6)

    band = np.clip(donor[y0:].astype(np.float32) * gain, 0, 255).astype(np.uint8)
    out = warp.copy()
    out[y0:] = band
    # Fondu sur 6 px pour masquer la jonction.
    for i in range(6):
        a = (i + 1) / 7
        y = y0 + i
        out[y] = (warp[y].astype(np.float32) * (1 - a) + band[i].astype(np.float32) * a).astype(np.uint8)
    return out


def finish(warp):
    """Nettoyage léger : les sources sont des photos de dalle LCD (moiré, franges).

    Débruitage bilatéral pour effacer le tramage sans manger les lettrines
    gothiques, léger accentuage, puis saturation un peu relevée.
    """
    img = cv2.bilateralFilter(warp, 7, 42, 9)
    small = cv2.resize(img, (WEB_W, WEB_H), interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(small, (0, 0), 1.1)
    sharp = cv2.addWeighted(small, 1.45, blur, -0.45, 0)
    hsv = cv2.cvtColor(sharp, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.10, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def make_icons(back):
    """Icônes PWA taillées dans le dos de carte (le calice)."""
    # Le calice est centré autour de 45 % de la hauteur.
    cx, cy = OUT_W // 2, int(OUT_H * 0.44)
    half = OUT_W // 2
    crop = back[cy - half : cy + half, cx - half : cx + half]
    for size in (180, 192, 512):
        icon = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(ROOT / f"icon-{size}.png"), icon, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"icônes PWA écrites (180/192/512)")


def main():
    OUT.mkdir(exist_ok=True)
    cards, quads = {}, {}
    for path in sorted(SRC.glob("*.jpeg")):
        warp, quad = process(path)
        cards[path.stem] = warp
        quads[path.stem] = quad

    for name in PATCH_BOTTOM:
        if name in cards:
            cards[name] = patch_bottom(name, cards[name], cards)

    for name, warp in cards.items():
        web = finish(warp)
        out = OUT / f"{name}.webp"
        cv2.imwrite(str(out), web, [cv2.IMWRITE_WEBP_QUALITY, WEBP_Q])
        if KEEP_PNG:
            cv2.imwrite(str(OUT / f"{name}.png"), warp, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        kb = out.stat().st_size / 1024
        print(f"{name:18s} -> {out.name:22s} {WEB_W}x{WEB_H}  {kb:5.1f} ko")

    make_icons(cards["background"])


if __name__ == "__main__":
    main()
