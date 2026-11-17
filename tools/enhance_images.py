"""Делает «отрендеренные» копии фото товаров: обрезка белых полей, апскейл LANCZOS,
лёгкая резкость/контраст, центрирование на квадратном белом холсте 360×360 → images/hd/<cat>/<id>.webp.
Оригиналы в images/<cat>/ не трогаются. Запуск: python3 tools/enhance_images.py"""
import glob, os
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE, PAD = 360, 22
for src in sorted(glob.glob(os.path.join(ROOT, 'images', '*', '*.jpg'))):
    cat = os.path.basename(os.path.dirname(src))
    if cat == 'hd': continue
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    w, h = im.size
    corner = im.getpixel((0, 0))
    white_bg = min(corner) > 228
    if white_bg:
        diff = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).convert('L').point(lambda v: 255 if v > 18 else 0)
        box = diff.getbbox()
        if box:
            m = 2; box = (max(0, box[0]-m), max(0, box[1]-m), min(w, box[2]+m), min(h, box[3]+m)); im = im.crop(box)
    inner = SIZE - 2 * PAD
    s = inner / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=90, threshold=2))
    im = ImageEnhance.Contrast(im).enhance(1.06)
    im = ImageEnhance.Color(im).enhance(1.12)
    canvas = Image.new('RGB', (SIZE, SIZE), (255, 255, 255) if white_bg else corner)
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    out = os.path.join(ROOT, 'images', 'hd', cat, os.path.basename(src)[:-4] + '.webp')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.save(out, 'WEBP', quality=82, method=6)
print('ok')
