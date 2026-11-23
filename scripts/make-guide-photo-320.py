#!/usr/bin/env python3
"""Makes the 320 x 240 WebP variant of every Kitchen Guide photograph (the small picture a row card on /guides/ and a "related reading" card use).

    python3 scripts/make-guide-photo-320.py            (every slug in scripts/guide-photos-*.json that has no -320 file yet, or whose file is wrong)
    python3 scripts/make-guide-photo-320.py --all      (rebuild every one)

WHY. A 96 px thumbnail on a phone must not download the 40 KB -thumb file 130 times, so each photograph has a third size beside <slug>-thumb.webp (600 x 450)
and <slug>-1000.webp: site/img/guides/<slug>-320.webp, 320 x 240, quality 72 (lowered in steps for a busy picture until it fits), 16 KB at most (the hub generator, scripts/build-guides-hub.js, refuses to run
without it; tests/content-assets.test.mjs checks size and weight). It is made from the largest file of the photograph with the same tool that made the other sizes
(Pillow, WebP, Lanczos), cropped to the 4:3 the pages frame every photograph in (a 3:2 or 16:9 photograph is trimmed at the sides, never stretched). A manifest entry may name its own file with "src320" (the pillar article keeps the owner's DMMMSU project photograph, which lives under
site/img/projects/, so its 320 file is the one new file in site/img/guides/); its XMP copyright packet, if the source has one, is carried over.
"""
import glob, io, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 320, 240
MAX_BYTES = 16 * 1024


def entries():
    out = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'scripts', 'guide-photos-*.json'))):
        with open(f, encoding='utf-8') as fh:
            out.update(json.load(fh))
    return out


def target_of(slug, e):
    rel = e.get('src320') or e['src'].replace('.webp', '-320.webp')
    return rel, os.path.join(ROOT, rel.lstrip('/'))


def source_of(e):
    # the largest file the entry names: src itself (1600 w) — a project photograph's own file for an owner photo
    return os.path.join(ROOT, e['src'].lstrip('/'))


def cover(im):
    # the pages show every photograph in a 4:3 frame with object-fit:cover, so the 320 file is the centred 4:3 crop of the largest file, scaled down (never stretched)
    w, h = im.size
    if w * H > h * W:      # wider than 4:3: trim the sides
        nw = round(h * W / H)
        box = ((w - nw) // 2, 0, (w - nw) // 2 + nw, h)
    else:                  # taller (or equal): trim top and bottom
        nh = round(w * H / W)
        box = (0, (h - nh) // 2, w, (h - nh) // 2 + nh)
    return im.crop(box).resize((W, H), Image.LANCZOS)


def encode(im, xmp):
    last = None
    for q in (72, 68, 64, 60, 56, 52, 48, 44, 40):
        buf = io.BytesIO()
        kw = {'quality': q, 'method': 6}
        if xmp:
            kw['xmp'] = xmp
        im.save(buf, 'WEBP', **kw)
        last = buf.getvalue()
        if len(last) <= MAX_BYTES:
            return last, q
    raise SystemExit('a 320 file stays over %d bytes even at quality 40' % MAX_BYTES)


def main():
    rebuild = '--all' in sys.argv
    made = skipped = 0
    for slug, e in entries().items():
        rel, dst = target_of(slug, e)
        if os.path.exists(dst) and not rebuild:
            try:
                with Image.open(dst) as chk:
                    if chk.size == (W, H) and os.path.getsize(dst) <= MAX_BYTES:
                        skipped += 1
                        continue
            except Exception:
                pass
        src = source_of(e)
        with Image.open(src) as im:
            xmp = im.info.get('xmp')
            im = cover(im.convert('RGB'))
            try:
                data, q = encode(im, xmp)
            except SystemExit as err:
                raise SystemExit('%s: %s' % (slug, err))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'wb') as fh:
            fh.write(data)
        made += 1
        print('%s  %d bytes  q%d' % (rel, len(data), q))
    print('made %d, already fine %d' % (made, skipped))


if __name__ == '__main__':
    main()
