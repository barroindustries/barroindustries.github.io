#!/usr/bin/env python3
"""Watermark + copyright metadata for the public website photos.

    python3 scripts/watermark-images.py [dir ...]     (default: products projects pages)

- Un-watermarked masters live in private/img-masters/<same path> (gitignored, never
  published). The first run copies each site/img file there; every run rebuilds the
  public file FROM the master, so re-running never stacks watermarks.
- Images whose longest side is >= MIN_STAMP get a small mark (the Barro Kitchens cube +
  "barroindustries.com"), dark on light backgrounds, white on dark ones. Product cut-outs
  (shown object-fit:contain) get it bottom-right; project/page photos are shown
  object-fit:cover in many frame shapes, so theirs sits lower-centre, inside the area every
  crop keeps. Smaller thumbnails and NO_STAMP files get the metadata only.
- Every image gets XMP copyright metadata (dc:rights, dc:creator, xmpRights, IPTC
  creator contact + licensor URL) - Google Images reads these.
Dimensions never change (product-photos.json / width+height attributes stay valid).
"""
import os, shutil, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'site', 'img')
MASTERS = os.path.join(ROOT, 'private', 'img-masters')
LOGO = os.path.join(ROOT, 'icons', 'barro-kitchens.png')
MIN_STAMP = 600
OPACITY = 0.42
TEXT = 'barroindustries.com'
YEAR = '2026'
RIGHTS = (f'© {YEAR} Barro Industries OPC (Barro Kitchens). All rights reserved. '
          'Photos may not be reused without written permission.')
EXTS = ('.webp', '.jpg', '.jpeg', '.png')
# The homepage hero background (full-bleed, text over it): metadata only, no visible mark.
NO_STAMP = {'projects/ispsc/01.webp', 'projects/ispsc/01-thumb.webp'}

XMP = f'''<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"
    xmpRights:Marked="True"
    xmpRights:WebStatement="https://barroindustries.com/#copyright"
    photoshop:Credit="Barro Industries OPC"
    photoshop:Source="barroindustries.com">
   <dc:creator><rdf:Seq><rdf:li>Barro Industries OPC</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">{RIGHTS}</rdf:li></rdf:Alt></dc:rights>
   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">Not licensed for reuse. Contact hello@barroindustries.com for permission.</rdf:li></rdf:Alt></xmpRights:UsageTerms>
   <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource">
    <Iptc4xmpCore:CiEmailWork>hello@barroindustries.com</Iptc4xmpCore:CiEmailWork>
    <Iptc4xmpCore:CiUrlWork>https://barroindustries.com/</Iptc4xmpCore:CiUrlWork>
   </Iptc4xmpCore:CreatorContactInfo>
   <plus:Licensor><rdf:Seq><rdf:li rdf:parseType="Resource">
    <plus:LicensorName>Barro Industries OPC</plus:LicensorName>
    <plus:LicensorURL>https://barroindustries.com/#copyright</plus:LicensorURL>
   </rdf:li></rdf:Seq></plus:Licensor>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>'''.encode('utf-8')


def font(px):
    for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, px, index=1) if f.endswith('.ttc') else ImageFont.truetype(f, px)
            except Exception:
                return ImageFont.truetype(f, px)
    return ImageFont.load_default()


_LOGO_MASK = None
def logo_mask():
    """The white parts of the cube logo as an alpha mask (navy background dropped)."""
    global _LOGO_MASK
    if _LOGO_MASK is None:
        im = Image.open(LOGO).convert('RGB')
        r, g, b = im.split()
        # alpha = how close the pixel is to white (min channel), so yellow/navy fall away
        px_r, px_g, px_b = r.load(), g.load(), b.load()
        a = Image.new('L', im.size)
        pa = a.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                m = min(px_r[x, y], px_g[x, y], px_b[x, y])
                pa[x, y] = 0 if m < 140 else min(255, (m - 140) * 255 // 90)
        _LOGO_MASK = a.crop(a.getbbox())
    return _LOGO_MASK


def stamp(im, corner_mode=True):
    w, h = im.size
    short = min(w, h)
    logo_h = max(28, round(short * 0.075))
    text_px = max(11, round(logo_h * 0.36))
    margin = max(10, round(short * 0.03))
    gap = round(logo_h * 0.22)

    lm = logo_mask()
    lm = lm.resize((round(lm.size[0] * logo_h / lm.size[1]), logo_h), Image.LANCZOS)
    f = font(text_px)
    tb = ImageDraw.Draw(Image.new('L', (1, 1))).textbbox((0, 0), TEXT, font=f)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]

    bw = lm.size[0] + gap + tw
    bh = logo_h
    if corner_mode:
        x0, y0 = w - margin - bw, h - margin - bh
    else:  # lower-centre: survives 2:1 crops of 4:3, 4:3 crops of 3:4 and phone side-crops
        x0, y0 = (w - bw) // 2, round(h * 0.74) - bh

    # colour from the corner it sits on: dark mark on light photos, white on dark
    corner = im.convert('L').crop((max(0, x0 - 4), max(0, y0 - 4), w, h))
    mean = sum(i * c for i, c in enumerate(corner.histogram())) / max(1, corner.size[0] * corner.size[1])
    light = mean > 150
    ink = (11, 26, 58) if light else (255, 255, 255)
    halo = (255, 255, 255) if light else (0, 0, 0)

    mask = Image.new('L', (w, h), 0)
    mask.paste(lm, (x0, y0))
    ImageDraw.Draw(mask).text((x0 + lm.size[0] + gap - tb[0], y0 + (bh - th) // 2 - tb[1]),
                              TEXT, font=f, fill=255)
    # soft halo so the mark reads on busy backgrounds
    shadow = mask.filter(ImageFilter.GaussianBlur(max(1, logo_h // 14)))
    base = im.convert('RGBA')
    base.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (w, h), c) for c in halo],
                                              shadow.point(lambda v: int(v * OPACITY * 0.5)))))
    base.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (w, h), c) for c in ink],
                                              mask.point(lambda v: int(v * OPACITY)))))
    return base.convert(im.mode if im.mode in ('RGB', 'RGBA') else 'RGB')


def process(rel):
    pub = os.path.join(SRC, rel)
    master = os.path.join(MASTERS, rel)
    if not os.path.exists(master):
        os.makedirs(os.path.dirname(master), exist_ok=True)
        shutil.copy2(pub, master)
    im = Image.open(master)
    im.load()
    stamped = max(im.size) >= MIN_STAMP and rel.replace(os.sep, '/') not in NO_STAMP
    out = stamp(im, rel.startswith('products')) if stamped else (im if im.mode in ('RGB', 'RGBA') else im.convert('RGB'))
    ext = os.path.splitext(rel)[1].lower()
    if ext == '.webp':
        out.save(pub, 'WEBP', quality=82, method=6, xmp=XMP)
    elif ext in ('.jpg', '.jpeg'):
        out.convert('RGB').save(pub, 'JPEG', quality=84, optimize=True, progressive=True, xmp=XMP)
    else:
        out.save(pub, 'PNG', optimize=True)
    return stamped


def main():
    dirs = sys.argv[1:] or ['products', 'projects', 'pages']
    n = s = 0
    for d in dirs:
        for dp, _, fs in os.walk(os.path.join(SRC, d)):
            for fn in sorted(fs):
                if fn.lower().endswith(EXTS):
                    rel = os.path.relpath(os.path.join(dp, fn), SRC)
                    s += process(rel)
                    n += 1
    print(f'watermark: {n} images ({s} stamped, {n - s} metadata only); masters in private/img-masters/')


if __name__ == '__main__':
    main()
