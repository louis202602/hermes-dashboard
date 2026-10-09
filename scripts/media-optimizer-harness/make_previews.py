#!/usr/bin/env python3
"""FIXTURE DE TEST — génère des images JPEG SYNTHÉTIQUES (aucune donnée réelle) pour le harnais
de captures du Media Optimizer. Écrit un JSON { kind: [..] } dans le chemin passé en argument.
Usage : python3 make_previews.py <sortie.json>
"""
import base64
import io
import json
import random
import sys

from PIL import Image, ImageDraw, ImageFilter


def scene(w, h, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):  # ciel dégradé
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(70 + 90 * t), int(130 + 70 * t), int(210 - 20 * t)))
    roof = [(0, int(h * 0.45)), (w, int(h * 0.3)), (w, h), (0, h)]
    d.polygon(roof, fill=(120, 70, 55))
    cols, rows = 6, 3  # panneaux
    pw, ph = w * 0.12, h * 0.14
    for r in range(rows):
        for c in range(cols):
            x0 = w * 0.1 + c * (pw + 6)
            y0 = h * 0.5 + r * (ph + 6) - c * 3
            d.rectangle([x0, y0, x0 + pw, y0 + ph], fill=(18, 30, 70), outline=(190, 200, 220))
            d.line([(x0 + pw / 2, y0), (x0 + pw / 2, y0 + ph)], fill=(80, 100, 150))
    for _ in range(int(w * h / 900)):  # grain
        x, y = rnd.randrange(w), rnd.randrange(h)
        d.point((x, y), fill=(rnd.randrange(255),) * 3)
    d.text((8, 8), "FIXTURE DE TEST", fill=(255, 255, 255))
    return im


def jpeg_b64(im, q):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    return base64.b64encode(buf.getvalue()).decode()


def entry(kind, pos, t, im, q):
    return {"kind": kind, "pos": pos, "t_sec": t, "mime": "image/jpeg", "width": im.width, "height": im.height,
            "data_b64": jpeg_b64(im, q)}


out = []
for pos, t in enumerate([1.0, 12.5, 30.2], start=1):
    base = scene(640, 360, pos)
    opt = base.filter(ImageFilter.GaussianBlur(0.6))
    out.append(entry("orig", pos, t, base, 92))
    out.append(entry("opt", pos, t, opt, 55))
for pos, t in enumerate([1.0, 12.5], start=1):
    base = scene(640, 360, pos)
    box = (int(640 * 0.1), int(360 * 0.45), int(640 * 0.1) + 260, int(360 * 0.45) + 190)
    crop = base.crop(box).resize((390, 285))
    out.append(entry("orig_crop", pos, t, crop, 92))
    out.append(entry("opt_crop", pos, t, crop.filter(ImageFilter.GaussianBlur(0.9)), 45))
for pos, t in enumerate([1.0, 12.5], start=1):
    src = scene(640, 360, pos)
    bg = src.resize((360, 640)).filter(ImageFilter.GaussianBlur(14))
    fg = src.resize((360, 202))
    bg.paste(fg, (0, (640 - 202) // 2))
    out.append(entry("pad916", pos, t, bg, 70))

with open(sys.argv[1], "w") as f:
    json.dump(out, f)
print(len(out), "aperçus synthétiques")
