#!/usr/bin/env python3
"""Watermark + copyright metadata for the pictures that exist only in the downloadable PDFs' source (downloads/src/img).

    python3 scripts/watermark-downloads.py

The website's own photographs (site/img/projects, products, pages) are watermarked by scripts/watermark-images.py, and
scripts/build-downloads.js converts those marked files for the PDFs, so they need nothing here. Four groups of pictures are not
covered by that script, and this one gives them the SAME look (it imports stamp() and XMP from scripts/watermark-images.py):

  ispsc-01.jpg       the homepage hero photograph. The website copy is NO_STAMP (text sits over it), but a page of a PDF has no text over
                     it, so it is built here from the master (private/img-masters/projects/ispsc/01.webp, or the public file when the master
                     is missing), 1400 px wide, with the mark lower-centre.
  restaurant-*.jpg   four photographs of the restaurant kitchen in the portfolio, extracted once from the owner's portfolio PDF (2026-10-10);
                     shown cropped (object-fit: cover), so the mark sits lower-centre. They are small, so the mark is the smallest stamp() draws.
  own-*.jpg          pictures extracted once from the owner's catalogue PDF (the president's portrait; hoods, fan, gas tank farm, valves and
                     the fire suppression diagram). Shown whole on a white ground, so a mark goes bottom-right, on the ones of 600 px or more
                     (the same rule as the website); the smaller ones get the copyright metadata only.

Un-marked masters live in private/img-masters/downloads/ (gitignored, never published). The first run copies each file there; every run
rebuilds the public file FROM its master, so running it again never stacks a mark; a picture that is already marked and has no master on
the machine (a fresh clone: private/ is not published) is left alone. Needs Pillow (the same as watermark-images.py).
"""
import glob
import importlib.util
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'downloads', 'src', 'img')
MASTERS = os.path.join(ROOT, 'private', 'img-masters', 'downloads')
SITE_MASTER = os.path.join(ROOT, 'private', 'img-masters', 'projects', 'ispsc', '01.webp')
SITE_PUBLIC = os.path.join(ROOT, 'site', 'img', 'projects', 'ispsc', '01.webp')

spec = importlib.util.spec_from_file_location('watermark_images', os.path.join(ROOT, 'scripts', 'watermark-images.py'))
wm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wm)


def save(im, name, quality):
    # baseline JPEG, the copyright XMP packet inside: Chrome embeds a JPEG as it is, so the packet travels into the PDF
    im.convert('RGB').save(os.path.join(OUT, name), 'JPEG', quality=quality, optimize=True, progressive=False, subsampling=0, xmp=wm.XMP)


def master_of(name):
    """The un-marked master of a picture, or None when there is none and the public file is already marked (never mark a marked picture again)."""
    m = os.path.join(MASTERS, name)
    if not os.path.exists(m):
        with open(os.path.join(OUT, name), 'rb') as f:
            if b'xmpRights:Marked' in f.read():
                return None
        os.makedirs(MASTERS, exist_ok=True)
        shutil.copy2(os.path.join(OUT, name), m)
    return m


def main():
    stamped = plain = 0

    # 1. the hero photograph, 1400 px wide, mark lower-centre
    src = SITE_MASTER if os.path.exists(SITE_MASTER) else SITE_PUBLIC
    im = Image.open(src).convert('RGB')
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    save(wm.stamp(im, corner_mode=False), 'ispsc-01.jpg', 74)
    stamped += 1

    # 2. the restaurant photographs, mark lower-centre
    skipped = []
    for path in sorted(glob.glob(os.path.join(OUT, 'restaurant-*.jpg'))):
        name = os.path.basename(path)
        master = master_of(name)
        if master is None:
            skipped.append(name)
            continue
        im = Image.open(master)
        im.load()
        save(wm.stamp(im, corner_mode=False), name, 90)
        stamped += 1

    # 3. the pictures from the catalogue PDF, mark bottom-right when they are big enough
    for path in sorted(glob.glob(os.path.join(OUT, 'own-*.jpg'))):
        name = os.path.basename(path)
        master = master_of(name)
        if master is None:
            skipped.append(name)
            continue
        im = Image.open(master)
        im.load()
        if max(im.size) >= wm.MIN_STAMP:
            save(wm.stamp(im, corner_mode=True), name, 88)
            stamped += 1
        else:
            save(im, name, 88)
            plain += 1

    print(f'watermark-downloads: {stamped + plain} images ({stamped} stamped, {plain} metadata only); masters in private/img-masters/downloads/')
    if skipped:
        print(f'  left as they are (already marked, and their un-marked master is not on this machine): {", ".join(skipped)}')


if __name__ == '__main__':
    sys.exit(main())
