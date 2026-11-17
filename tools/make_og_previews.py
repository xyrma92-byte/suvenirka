#!/usr/bin/env python3
"""Generate 1200x630 Open Graph preview images for the Сувенирка site.

Reuses the HTML-and-Chrome pipeline from the first OG set (stage collage,
minimal typography, price-focused), with two anime keyrings in every
variant and the wording «Мерч» instead of «рок-мерч».

Usage (from repo root or any cwd):
    python3 tools/make_og_previews.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TOOL_DIR = Path(__file__).resolve().parent / "og-preview"
SRC_DIR = TOOL_DIR / "src"
CUT_DIR = TOOL_DIR / "cuts"
BUILD_DIR = TOOL_DIR / "build"
SITE_OG = ROOT / "images" / "og"
STAGE = ROOT / "images" / "bg" / "stage.jpg"
HD = ROOT / "images" / "hd"

ANIME = {
    "gojo": SRC_DIR / "anime-1.jpg",
    "bakugo": SRC_DIR / "anime-2.jpg",
    "sukuna": SRC_DIR / "anime-3.jpg",
}

PINS = {
    "kish": HD / "pins" / "pins-126.webp",
    "metallica": HD / "pins" / "pins-067.webp",
    "rammstein": HD / "pins" / "pins-090.webp",
    "nirvana": HD / "pins" / "pins-077.webp",
    "alice": HD / "pins" / "pins-118.webp",
    "tsoi": HD / "pins" / "pins-136.webp",
    "acdc": HD / "magnets" / "magnets-005.webp",
    "motorhead": HD / "earrings" / "earrings-030.webp",
    "keychain": HD / "keychains" / "keychains-040.webp",
}


def font_dir() -> Path:
    for p in (TOOL_DIR / "fonts", Path("/workspace/fonts")):
        if (p / "Unbounded.ttf").is_file() and (p / "Manrope.ttf").is_file():
            return p
    raise SystemExit("Unbounded.ttf and Manrope.ttf not found in tools/og-preview/fonts or /workspace/fonts")


def chrome_path() -> str:
    for p in ("/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"):
        if os.path.isfile(p):
            return p
    raise SystemExit("Chrome/Chromium not found")


# --- keyring cutout ---------------------------------------------------------

def _dilate(mask: np.ndarray, r: int = 1) -> np.ndarray:
    m = mask.astype(np.uint8)
    h, w = m.shape
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r + 0.1:
                continue
            ys1, ye1 = max(0, dy), h + min(0, dy)
            xs1, xe1 = max(0, dx), w + min(0, dx)
            out[ys1:ye1, xs1:xe1] = np.maximum(out[ys1:ye1, xs1:xe1], m[ys1 - dy : ye1 - dy, xs1 - dx : xe1 - dx])
    return out.astype(bool)


def _flood_from_edges(passable: np.ndarray) -> np.ndarray:
    h, w = passable.shape
    vis = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        if passable[0, x]:
            stack.append((0, x))
        if passable[h - 1, x]:
            stack.append((h - 1, x))
    for y in range(h):
        if passable[y, 0]:
            stack.append((y, 0))
        if passable[y, w - 1]:
            stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w or vis[y, x] or not passable[y, x]:
            continue
        xl = x
        while xl >= 0 and passable[y, xl] and not vis[y, xl]:
            vis[y, xl] = True
            xl -= 1
        xl += 1
        xr = x + 1
        while xr < w and passable[y, xr] and not vis[y, xr]:
            vis[y, xr] = True
            xr += 1
        for nx in range(xl, xr):
            if y > 0 and passable[y - 1, nx] and not vis[y - 1, nx]:
                stack.append((y - 1, nx))
            if y + 1 < h and passable[y + 1, nx] and not vis[y + 1, nx]:
                stack.append((y + 1, nx))
    return vis


def _connected_components(mask: np.ndarray):
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    lid = 0
    sizes: dict[int, int] = {}
    ys, xs = np.where(mask)
    for y, x in zip(ys, xs):
        if labels[y, x]:
            continue
        lid += 1
        stack = [(int(y), int(x))]
        n = 0
        while stack:
            cy, cx = stack.pop()
            if cy < 0 or cy >= h or cx < 0 or cx >= w or labels[cy, cx] or not mask[cy, cx]:
                continue
            labels[cy, cx] = lid
            n += 1
            stack.extend(((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)))
        sizes[lid] = n
    return labels, sizes


def _find_hole_circle(lum: np.ndarray, sat: np.ndarray, y0: int, y1: int, x0: int, x1: int):
    top = max(0, y0 - 8)
    bot = int(y0 + (y1 - y0) * 0.28)
    mid = (x0 + x1) // 2
    left = max(0, mid - 70)
    right = min(lum.shape[1], mid + 70)
    bot = min(bot, top + 140)
    win_lum = lum[top:bot, left:right]
    win_sat = sat[top:bot, left:right]
    hh, ww = win_lum.shape
    white = (win_lum > 200) & (win_sat < 50)
    yy, xx = np.indices((hh, ww))
    best_score = -1e9
    best = None
    for r in range(15, 26):
        for cy in range(r + 2, hh - r, 2):
            for cx in range(r + 2, ww - r, 2):
                d2 = (yy - cy) ** 2 + (xx - cx) ** 2
                inner = d2 <= ((r - 1) ** 2)
                annulus = (d2 >= (r ** 2)) & (d2 <= ((r + 14) ** 2))
                mean_in = win_lum[inner].mean()
                if mean_in > 110:
                    continue
                mean_an = win_lum[annulus].mean()
                white_frac = white[annulus].mean()
                score = (mean_an - mean_in) + white_frac * 90
                if score > best_score:
                    best_score = score
                    best = (cx, cy, r)
    if best is None:
        return None
    cx, cy, r = best
    for rr in range(r - 2, r + 3):
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                ccx, ccy = cx + dx, cy + dy
                if rr < 12 or ccy - rr < 0 or ccx - rr < 0 or ccy + rr >= hh or ccx + rr >= ww:
                    continue
                d2 = (yy - ccy) ** 2 + (xx - ccx) ** 2
                inner = d2 <= ((rr - 1) ** 2)
                annulus = (d2 >= (rr ** 2)) & (d2 <= ((rr + 14) ** 2))
                mean_in = win_lum[inner].mean()
                mean_an = win_lum[annulus].mean()
                white_frac = white[annulus].mean()
                score = (mean_an - mean_in) + white_frac * 90
                if score > best_score:
                    best_score = score
                    best = (ccx, ccy, rr)
    cx, cy, r = best
    return (cx + left, cy + top, r, best_score)


def cut_charm(src: Path, dest: Path) -> Path:
    """Cut the acrylic keyring charm out of an Ozon marketing photo.

    Drops overlay text («БРЕЛОК», badges) and reconstructs a closed hanging hole.
    Saves a transparent PNG and a white-background PNG.
    """
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).copy()
    h, w = a.shape[:2]
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    near_white = (a.min(axis=2) > 210) & (sat < 45)
    plastic = (lum > 200) & (sat < 55)

    bg = _flood_from_edges(~near_white)
    labels, sizes = _connected_components(~bg)
    best, best_score = None, -1.0
    cy0, cx0 = h * 0.58, w * 0.50
    for lid, sz in sizes.items():
        if sz < 2000:
            continue
        ys, xs = np.where(labels == lid)
        cy, cx = float(ys.mean()), float(xs.mean())
        score = sz - np.hypot(cy - cy0, cx - cx0) * 30
        if score > best_score:
            best_score, best = score, lid
    if best is None:
        raise RuntimeError(f"Could not find keyring charm in {src}")
    charm = labels == best
    ys, xs = np.where(charm)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())

    hole = _find_hole_circle(lum, sat, y0, y1, x0, x1)
    if hole is None:
        raise RuntimeError(f"Could not find hanging hole in {src}")
    cx, cy, r = hole[0], hole[1], hole[2]
    yy, xx = np.indices((h, w))
    d = np.hypot(xx - cx, yy - cy)
    tab_white = plastic & (d >= r) & (d <= r + 28) & (yy <= cy + r + 10)
    r_tab = float(np.percentile(d[tab_white], 96)) if tab_white.sum() > 20 else r + 16
    r_tab = max(r + 10, min(r + 24, r_tab))

    tab = d <= r_tab + 0.6
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = a
    alpha = np.zeros((h, w), dtype=np.float32)
    alpha[_dilate(charm, 1)] = 255

    restore = tab & (alpha < 200)
    pl = plastic & (d <= r_tab + 2) & (d >= r)
    mean_pl = a[pl].mean(axis=0) if pl.sum() else np.array([248, 248, 249], dtype=np.float64)
    rgba[restore & ~(lum > 170), :3] = mean_pl
    alpha[tab] = 255

    hole_r = r - 0.2
    fade = 1.15
    hole_mult = np.clip((d - (hole_r - fade)) / fade, 0, 1)
    in_tab = d <= r_tab + 1.5
    alpha[in_tab] = alpha[in_tab] * hole_mult[in_tab]
    alpha[d <= hole_r - fade] = 0
    rgba[..., 3] = np.clip(alpha, 0, 255).astype(np.uint8)

    ys, xs = np.where(rgba[..., 3] > 12)
    pad = 12
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w, int(xs.max()) + 1 + pad),
        min(h, int(ys.max()) + 1 + pad),
    )
    cut = Image.fromarray(rgba).crop(box)
    rch, gch, bch, al = cut.split()
    al = al.filter(ImageFilter.GaussianBlur(radius=0.55))
    cut = Image.merge("RGBA", (rch, gch, bch, al))
    dest.parent.mkdir(parents=True, exist_ok=True)
    cut.save(dest)

    white_path = dest.with_name(dest.stem + "-white.png")
    bgim = Image.new("RGBA", cut.size, (255, 255, 255, 255))
    bgim.alpha_composite(cut)
    bgim.convert("RGB").save(white_path)
    return dest


def prepare_cuts() -> dict[str, Path]:
    CUT_DIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, src in ANIME.items():
        if not src.is_file():
            raise SystemExit(f"Missing anime source photo: {src}")
        dest = CUT_DIR / f"{name}.png"
        print(f"cut {src.name} -> {dest.name}")
        cut_charm(src, dest)
        out[name] = dest
        out[name + "_white"] = dest.with_name(dest.stem + "-white.png")
    return out


# --- HTML templates (same layouts as the original og-build set) --------------

def write_templates(cuts: dict[str, Path]) -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    fonts = font_dir()
    gojo = cuts["gojo_white"]
    bakugo = cuts["bakugo_white"]

    css = f"""@font-face{{font-family:U;src:url({fonts / 'Unbounded.ttf'} );font-weight:100 900}}
@font-face{{font-family:M;src:url({fonts / 'Manrope.ttf'} );font-weight:200 800}}
*{{box-sizing:border-box;margin:0}}
html,body{{width:1200px;height:630px;overflow:hidden;background:#0a0a0f;color:#fff;font-family:M}}
.stage{{position:absolute;inset:0;background:url({STAGE}) center/cover}}
.shade{{position:absolute;inset:0}}
.acc{{background:linear-gradient(90deg,#ff4d5a,#ffb02e);-webkit-background-clip:text;background-clip:text;color:transparent}}
.card{{background:#fff;border-radius:22px;padding:12px;box-shadow:0 18px 40px rgba(0,0,0,.55),0 0 0 3px rgba(255,255,255,.08)}}
.card img{{display:block;width:100%;height:100%;object-fit:contain}}
.logo{{font-family:U;font-weight:800;font-size:30px;display:flex;align-items:center;gap:12px}}
.logo i{{font-style:normal;color:#ff4d5a}}
.pill{{display:inline-block;border:2px solid rgba(255,176,46,.7);color:#ffd28a;border-radius:99px;padding:8px 18px;font-weight:700;font-size:22px}}
.url{{font-weight:600;color:#aab;font-size:20px}}
"""
    (BUILD_DIR / "base.css").write_text(css, encoding="utf-8")

    a_html = f"""<html><head><link rel=stylesheet href=base.css><style>
.shade{{background:linear-gradient(90deg,rgba(10,10,15,.96) 0%,rgba(10,10,15,.85) 45%,rgba(10,10,15,.35) 100%)}}
.txt{{position:absolute;left:64px;top:56px;width:600px}}
h1{{font-family:U;font-weight:900;font-size:76px;line-height:1.02;margin:34px 0 22px;letter-spacing:-1px}}
p{{font-size:26px;color:#dde;line-height:1.35;font-weight:600}}
.pills{{position:absolute;left:64px;bottom:56px;display:flex;gap:12px}}
.grid{{position:absolute;right:52px;top:50px;display:grid;grid-template-columns:repeat(3,158px);gap:20px}}
.grid .card{{width:158px;height:158px}}
.grid .card:nth-child(odd){{transform:rotate(-4deg)}} .grid .card:nth-child(even){{transform:rotate(3deg) translateY(14px)}}
.cap{{position:absolute;right:56px;bottom:56px;font-weight:700;font-size:20px;color:#ffd28a}}
</style></head><body><div class=stage></div><div class=shade></div>
<div class=txt><div class=logo><i>★</i>Сувенирка</div>
<h1>Мерч<br><span class=acc>оптом и<br>поштучно</span></h1>
<p>Брелоки, магниты, значки и серьги.<br>Свой дизайн · производство в России</p></div>
<div class=pills><span class=pill>опт от 500 шт</span><span class=pill>скидки до −15%</span><span class=pill>от 1 шт</span></div>
<div class=grid>
<div class=card><img src={PINS['kish']}></div>
<div class=card><img src={gojo}></div>
<div class=card><img src={PINS['metallica']}></div>
<div class=card><img src={PINS['nirvana']}></div>
<div class=card><img src={bakugo}></div>
<div class=card><img src={PINS['rammstein']}></div>
</div><div class=cap>438 дизайнов · 120 групп</div></body></html>
"""
    (BUILD_DIR / "a.html").write_text(a_html, encoding="utf-8")

    b_html = f"""<html><head><link rel=stylesheet href=base.css><style>
body{{background:radial-gradient(900px 500px at 85% 20%,rgba(255,77,90,.35),transparent 60%),radial-gradient(700px 500px at 10% 110%,rgba(255,176,46,.25),transparent 60%),#0a0a0f}}
.top{{position:absolute;left:64px;top:52px;right:64px;display:flex;justify-content:space-between;align-items:center}}
h1{{position:absolute;left:64px;top:118px;font-family:U;font-weight:900;font-size:140px;line-height:.95;letter-spacing:-3px;text-transform:uppercase}}
h2{{position:absolute;left:66px;top:268px;font-family:U;font-weight:800;font-size:44px;letter-spacing:-1px}}
.sub{{position:absolute;left:68px;bottom:62px;font-size:26px;font-weight:700;color:#dde}}
.sub b{{color:#ffb02e}}
.row{{position:absolute;right:48px;top:130px;width:520px;height:360px}}
.row .card{{position:absolute;width:200px;height:200px;padding:14px}}
.row .card:nth-child(1){{left:0;top:80px;transform:rotate(-7deg)}}
.row .card:nth-child(2){{left:155px;top:0;transform:rotate(3deg);z-index:2}}
.row .card:nth-child(3){{left:310px;top:100px;transform:rotate(8deg)}}
.bar{{position:absolute;left:0;right:0;bottom:0;height:12px;background:linear-gradient(90deg,#ff4d5a,#ffb02e)}}
</style></head><body>
<div class=top><div class=logo><i>★</i>Сувенирка</div><span class=url>xyrma92-byte.github.io/suvenirka</span></div>
<h1>Мерч<span class=acc>.</span></h1>
<h2 class=acc>оптом и поштучно</h2>
<div class=row>
<div class=card><img src={gojo}></div>
<div class=card><img src={PINS['kish']}></div>
<div class=card><img src={bakugo}></div></div>
<div class=sub>Брелоки · магниты · значки · серьги · <b>опт от 500 шт</b> · свой дизайн</div>
<div class=bar></div></body></html>
"""
    (BUILD_DIR / "b.html").write_text(b_html, encoding="utf-8")

    c_html = f"""<html><head><link rel=stylesheet href=base.css><style>
.shade{{background:linear-gradient(180deg,rgba(10,10,15,.80),rgba(10,10,15,.93))}}
.top{{position:absolute;left:64px;top:50px;right:64px;display:flex;justify-content:space-between;align-items:center}}
.big{{position:absolute;left:64px;top:128px;font-family:U;font-weight:900;line-height:1}}
.big .l1{{font-size:52px;color:#fff;letter-spacing:1px}}
.big .l2{{font-size:150px;letter-spacing:-5px;margin-top:6px}}
.big .l3{{font-size:30px;font-family:M;font-weight:700;color:#dde;margin-top:16px}}
.prices{{position:absolute;left:64px;right:64px;bottom:52px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}}
.pc{{background:rgba(27,30,38,.92);border:1px solid #2a2e39;border-radius:18px;padding:14px;display:flex;gap:14px;align-items:center}}
.pc .card{{width:84px;height:84px;padding:6px;border-radius:14px;box-shadow:none;flex:none}}
.pc span{{display:block;color:#9aa1b1;font-size:18px;font-weight:600}}.pc b{{font-family:U;font-size:30px;color:#ffb02e}}
.tiers{{position:absolute;right:64px;top:128px;display:flex;flex-direction:column;gap:10px;align-items:flex-end}}
.tiers div{{font-weight:800;font-size:24px;padding:10px 18px;border-radius:12px;background:rgba(255,77,90,.16);border:1px solid rgba(255,77,90,.6)}}
.tiers div b{{color:#ffb02e}}
.feat{{position:absolute;left:560px;top:118px;width:280px;height:250px}}
.feat .card{{position:absolute;width:150px;height:150px;padding:10px}}
.feat .card:nth-child(1){{left:0;top:40px;transform:rotate(-8deg)}}
.feat .card:nth-child(2){{left:110px;top:0;transform:rotate(7deg);z-index:2}}
</style></head><body><div class=stage></div><div class=shade></div>
<div class=top><div class=logo><i>★</i>Сувенирка</div><span class=pill>производство в России</span></div>
<div class=big><div class=l1>ОПТ ОТ</div><div class="l2 acc">189 ₽</div><div class=l3>за штуку · минимум 500 шт миксом</div></div>
<div class=feat>
<div class=card><img src={gojo}></div>
<div class=card><img src={bakugo}></div>
</div>
<div class=tiers><div>от 1000 шт <b>−5%</b></div><div>от 3000 шт <b>−10%</b></div><div>от 5000 шт <b>−15%</b></div></div>
<div class=prices>
<div class=pc><div class=card><img src={PINS['keychain']}></div><div><span>Брелоки</span><b>189 ₽</b></div></div>
<div class=pc><div class=card><img src={PINS['acdc']}></div><div><span>Магниты</span><b>180 ₽</b></div></div>
<div class=pc><div class=card><img src={PINS['nirvana']}></div><div><span>Значки</span><b>199 ₽</b></div></div>
<div class=pc><div class=card><img src={PINS['motorhead']}></div><div><span>Серьги</span><b>400 ₽</b></div></div>
</div></body></html>
"""
    (BUILD_DIR / "c.html").write_text(c_html, encoding="utf-8")


def render_html(html: Path, png: Path, scale: int = 2) -> None:
    js = TOOL_DIR / "render.cjs"
    subprocess.run(
        ["node", str(js), str(html), str(png), str(scale), chrome_path(), str(_puppeteer_dir())],
        check=True,
    )


def _puppeteer_dir() -> Path:
    for p in (
        Path("/tmp/chrome-test/node_modules/puppeteer-core"),
        TOOL_DIR / "node_modules" / "puppeteer-core",
        ROOT / "node_modules" / "puppeteer-core",
    ):
        if p.is_dir():
            return p
    raise SystemExit("puppeteer-core is not installed")


def write_render_script() -> Path:
    js = TOOL_DIR / "render.cjs"
    js.write_text(
        r"""const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const [html, out, scaleArg, chrome, puppeteerPath] = process.argv.slice(2);
const puppeteer = require(puppeteerPath);
const scale = Number(scaleArg || 2);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all([...document.images].map(img => img.complete ? null : new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      })));
    });
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log('rendered', out, fs.statSync(out).size);
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
""",
        encoding="utf-8",
    )
    return js


def png_to_og_jpeg(png: Path, jpg: Path) -> None:
    im = Image.open(png).convert("RGB")
    if im.size != (1200, 630):
        im = im.resize((1200, 630), Image.Resampling.LANCZOS)
    jpg.parent.mkdir(parents=True, exist_ok=True)
    im.save(jpg, format="JPEG", quality=85, optimize=True, progressive=True, subsampling=1)
    print(f"wrote {jpg} ({jpg.stat().st_size} bytes)")


def main() -> int:
    cuts = prepare_cuts()
    write_templates(cuts)
    write_render_script()
    SITE_OG.mkdir(parents=True, exist_ok=True)
    for letter in "abc":
        html = BUILD_DIR / f"{letter}.html"
        png = BUILD_DIR / f"{letter}.png"
        print(f"render {html.name}")
        render_html(html, png, scale=2)
        png_to_og_jpeg(png, SITE_OG / f"og-{letter}.jpg")
        # also keep a 1:1 preview jpeg in build for inspection
        shutil.copy2(SITE_OG / f"og-{letter}.jpg", BUILD_DIR / f"og-{letter}.jpg")
    print("done", json.dumps({k: str(v) for k, v in cuts.items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
