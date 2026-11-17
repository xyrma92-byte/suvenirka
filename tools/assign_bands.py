#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проставляет поля band / bandSlug в products.json и products.js по названию изделия."""
import json, os, re, unicodedata
from collections import defaultdict

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOOKALIKE = str.maketrans({
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i',
    'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'У': 'Y', 'Х': 'X',
})

def has_cyrillic(s):
    return bool(re.search(r'[А-Яа-яЁё]', s))

def normalize(name):
    s = unicodedata.normalize('NFC', name).replace('ё', 'е').replace('Ё', 'Е')
    s = re.sub(r'\s+', ' ', s).strip()
    if re.search(r'[A-Za-z]', s) and re.search(r'[А-Яа-я]', s):
        latin = len(re.findall(r'[A-Za-z]', s))
        cyr = len(re.findall(r'[А-Яа-я]', s))
        if latin >= cyr:
            s = s.translate(LOOKALIKE)
    return s

ALIASES = {
    'my chmical romance': 'My Chemical Romance',
    'three days grace': 'Three Days Grace',
    'three days grase': 'Three Days Grace',
    'dimmu borgir': 'Dimmu Borgir',
    'eskimo callboy': 'Eskimo Callboy',
    'children of bodom': 'Children of Bodom',
    'depeche mode': 'Depeche Mode',
    'deep purple': 'Deep Purple',
    'green day': 'Green Day',
    'guano apes': 'Guano Apes',
    'in flames': 'In Flames',
    'iron maiden': 'Iron Maiden',
    'king diamond': 'King Diamond',
    'linkin park': 'Linkin Park',
    'limp bizkit': 'Limp Bizkit',
    'pink floyd': 'Pink Floyd',
    'paramore': 'Paramore',
    'napalm death': 'Napalm Death',
    'black sabbath': 'Black Sabbath',
    'black metall': 'Black Metal',
    'black metal': 'Black Metal',
    'arch enemy': 'Arch Enemy',
    'arctic monkeys': 'Arctic Monkeys',
    'asking alexandria': 'Asking Alexandria',
    'billy talent': 'Billy Talent',
    'bring me the horizon': 'Bring Me The Horizon',
    'bmth': 'Bring Me The Horizon',
    'bullet for my valentine': 'Bullet For My Valentine',
    'cannibal corpse': 'Cannibal Corpse',
    'fall out boy': 'Fall Out Boy',
    'guns n roses': "Guns N' Roses",
    'guns and roses': "Guns N' Roses",
    'hollywood undead': 'Hollywood Undead',
    'imagine dragons': 'Imagine Dragons',
    'judas priest': 'Judas Priest',
    'led zeppelin': 'Led Zeppelin',
    'marilyn manson': 'Marilyn Manson',
    'motley crue': 'Mötley Crüe',
    'motorhead': 'Motörhead',
    'the offspring': 'The Offspring',
    'offspring': 'The Offspring',
    'ozzy osbourne': 'Ozzy Osbourne',
    'papa roach': 'Papa Roach',
    'rolling stones': 'The Rolling Stones',
    'sex pistols': 'Sex Pistols',
    'the beatles': 'The Beatles',
    'beatles': 'The Beatles',
    'the exploited': 'The Exploited',
    'exploited': 'The Exploited',
    'the hatters': 'The Hatters',
    'acdc': 'AC/DC',
    'rhcp': 'Red Hot Chili Peppers',
    'soad': 'System of a Down',
    '5fdp': 'Five Finger Death Punch',
    '21 pilots': '21 Pilots',
    '30 seconds to mars': '30 Seconds to Mars',
    'bob marley': 'Bob Marley',
    'bon jovi': 'Bon Jovi',
    'jimi hendrix': 'Jimi Hendrix',
    'van halen': 'Van Halen',
    'zz top': 'ZZ Top',
    'wasp': 'W.A.S.P.',
    'fpg': 'FPG',
    'u2': 'U2',
    'amon amarth': 'Amon Amarth',
    'aerosmith': 'Aerosmith',
    'behemoth': 'Behemoth',
    'biohazard': 'Biohazard',
    'blink 182': 'Blink-182',
    'disturbed': 'Disturbed',
    'exodus': 'Exodus',
    'helloween': 'Helloween',
    'immortal': 'Immortal',
    'kiss': 'Kiss',
    'korn': 'Korn',
    'kreator': 'Kreator',
    'lacrimosa': 'Lacrimosa',
    'louna': 'Louna',
    'lumen': 'Lumen',
    'manowar': 'Manowar',
    'mayhem': 'Mayhem',
    'megadeth': 'Megadeth',
    'metallica': 'Metallica',
    'metallica master': 'Metallica',
    'metallica ride': 'Metallica',
    'misfits': 'Misfits',
    'muse': 'Muse',
    'nickelback': 'Nickelback',
    'nightwish': 'Nightwish',
    'nirvana': 'Nirvana',
    'nirvana smile': 'Nirvana',
    'opeth': 'Opeth',
    'pantera': 'Pantera',
    'powerwolf': 'Powerwolf',
    'prodigy': 'The Prodigy',
    'queen': 'Queen',
    'rammstein': 'Rammstein',
    'ramones': 'Ramones',
    'rise against': 'Rise Against',
    'sabaton': 'Sabaton',
    'scorpions': 'Scorpions',
    'skillet': 'Skillet',
    'slayer': 'Slayer',
    'slipknot': 'Slipknot',
    'sons of anarchy': 'Sons of Anarchy',
    'sum 41': 'Sum 41',
    'tool': 'Tool',
    'venom': 'Venom',
    'whitesnake': 'Whitesnake',
    'lindemann': 'Lindemann',
    'till': 'Lindemann',
    'тиль': 'Lindemann',
    'алиса': 'Алиса',
    'ария': 'Ария',
    'агата кристи': 'Агата Кристи',
    'ддт': 'ДДТ',
    'король и шут': 'Король и Шут',
    'король и шут горшок': 'Король и Шут',
    'король и шут лого': 'Король и Шут',
    'горшок': 'Король и Шут',
    'князь': 'Князь',
    'цой': 'Кино (Цой)',
    'кино': 'Кино (Цой)',
    'ленинград': 'Ленинград',
    'в питере пить': 'Ленинград',
    'кукрыниксы': 'Кукрыниксы',
    'кукрыниксы лого': 'Кукрыниксы',
    'пикник': 'Пикник',
    'пилот': 'Пилот',
    'пневмослон': 'Пневмослон',
    'сектор газа': 'Сектор Газа',
    'слот': 'Слот',
    'сплин': 'Сплин',
    'чиж': 'Чиж & Co',
    'пентаграмма': 'Пентаграмма',
    'гроб': 'Гроб',
    'дерзость и молодость': 'Дерзость и молодость',
    'rock': 'Рок',
    'rock серьги': 'Рок',
}

PROTECTED = {
    'blink 182', 'sum 41', '21 pilots', '30 seconds to mars', '5fdp',
}

SUFFIXES = [
    r'\s+лого$',
    r'\s+smile$',
    r'\s+master$',
    r'\s+ride$',
    r'\s+серьги$',
    r'\s+горшок$',
]

def stem(name):
    s = normalize(name)
    low = s.lower()
    for pat in SUFFIXES:
        low = re.sub(pat, '', low, flags=re.I).strip()
    if low not in PROTECTED:
        low = re.sub(r'\s+[1-9]$', '', low).strip()
    return low

def canonical(name):
    key = stem(name)
    if key in ALIASES:
        return ALIASES[key]
    if has_cyrillic(key):
        return ' '.join(w[:1].upper() + w[1:] if w else w for w in key.split())
    small = {'of', 'the', 'and', 'n', 'to', 'for', 'my'}
    parts = key.split()
    out = []
    for i, w in enumerate(parts):
        if i > 0 and w in small:
            out.append(w)
        elif w.isupper() or re.fullmatch(r'[0-9]+', w):
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return ' '.join(out)

SLUG_OVERRIDE = {
    'Король и Шут': 'kish',
    'Кино (Цой)': 'kino',
    'Алиса': 'alisa',
    'AC/DC': 'acdc',
    "Guns N' Roses": 'guns-n-roses',
    'Red Hot Chili Peppers': 'rhcp',
    'System of a Down': 'soad',
    'Five Finger Death Punch': '5fdp',
    'Bring Me The Horizon': 'bmth',
    'The Beatles': 'beatles',
    'The Offspring': 'offspring',
    'The Exploited': 'exploited',
    'The Rolling Stones': 'rolling-stones',
    'The Hatters': 'the-hatters',
    'The Prodigy': 'prodigy',
    'Mötley Crüe': 'motley-crue',
    'Motörhead': 'motorhead',
    'W.A.S.P.': 'wasp',
    'Чиж & Co': 'chizh',
    'Lindemann': 'lindemann',
    'Ленинград': 'leningrad',
    '21 Pilots': '21-pilots',
    '30 Seconds to Mars': '30-seconds-to-mars',
    'Blink-182': 'blink-182',
    'Sum 41': 'sum-41',
    'ДДТ': 'ddt',
    'Ария': 'ariya',
    'Агата Кристи': 'agata-kristi',
    'Сектор Газа': 'sektor-gaza',
    'Black Metal': 'black-metal',
    'Рок': 'rock',
}

TR = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z',
    'и': 'i', 'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'ö': 'o', 'ü': 'u', 'ä': 'a', 'é': 'e', '&': 'and', '/': '-',
}

def slugify(name):
    if name in SLUG_OVERRIDE:
        return SLUG_OVERRIDE[name]
    s = name.lower().replace('ё', 'е')
    s = ''.join(TR.get(ch, ch) for ch in s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'band'

def inject(p, band, slug):
    out = {}
    for k, v in p.items():
        if k in ('band', 'bandSlug'):
            continue
        out[k] = v
        if k == 'name':
            out['band'] = band
            out['bandSlug'] = slug
    if 'band' not in out:
        out['band'] = band
        out['bandSlug'] = slug
    return out

def main():
    src = os.path.join(SITE, 'products.json')
    products = json.load(open(src, encoding='utf-8'))
    out, groups = [], defaultdict(list)
    slugs = {}
    for p in products:
        band = canonical(p['name'])
        slug = slugify(band)
        if slug in slugs and slugs[slug] != band:
            raise SystemExit(f'Slug collision: {slug} → {slugs[slug]!r} vs {band!r}')
        slugs[slug] = band
        q = inject(p, band, slug)
        out.append(q)
        groups[(band, slug)].append(q)
    json.dump(out, open(src, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    js = os.path.join(SITE, 'products.js')
    header = ('// Сгенерировано: каталог xlsx + остатки из Google Sheets «Сувенирка» '
              '(вкладки «Склад …», колонка «Количество»). stock=null → под заказ. '
              'band/bandSlug — каноническое имя группы.\n')
    open(js, 'w', encoding='utf-8').write(header + 'window.PRODUCTS=' + json.dumps(out, ensure_ascii=False) + ';\n')
    print(f'Updated {len(out)} products, {len(groups)} bands → {src} and products.js')

if __name__ == '__main__':
    main()
