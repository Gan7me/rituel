#!/usr/bin/env python3
"""Rendu 3D des médailles (champ de hauteur + éclairage physique simplifié) → public/badges/<id>.webp et <id>_lock.webp.
Usage : python3 tools/render-badges.py [taille=512]
Géométrie : jante torique chromée, bande plate, biseau, dôme d'émail guilloché, chiffre en relief métal, légende gravée,
ornement par famille (rayons, couronne, barre de traction, anneau de 7 segments, orbite)."""
import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'badges')
SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 512
SS = 2                       # sur-échantillonnage
N = SIZE * SS
FONT_BIG = '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'
FONT_LAB = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'

BADGES = [
  ('s1','ses',1,'1','SÉANCE'),('s10','ses',2,'10','SÉANCES'),('s25','ses',3,'25','SÉANCES'),('s50','ses',4,'50','SÉANCES'),('s100','ses',5,'100','SÉANCES'),
  ('pr1','pr',1,'★','RECORD'),('pr5','pr',3,'5','RECORDS'),('pr15','pr',5,'15','RECORDS'),
  ('t1','pull',1,'↑','TEST'),('t45','pull',2,'45','TRACTIONS'),('t55','pull',3,'55','TRACTIONS'),('t70','pull',5,'70','TRACTIONS'),
  ('w1','reg',1,'7/7','SEMAINE'),('w4','reg',3,'4','SEMAINES'),('w12','reg',5,'12','SEMAINES'),
  ('c1','cyc',2,'∞','CYCLE'),('ton','cyc',4,'10 t','SEMAINE'),
]
RANK_ENAMEL = [(0.45,0.49,0.56),(0.12,0.60,0.38),(0.86,0.22,0.17),(0.16,0.44,0.88),(0.93,0.64,0.12)]
RANK_METAL = [1,1,3,3,5]
ENAMEL = {'ses':(0.86,0.22,0.17),'pr':(0.93,0.64,0.12),'pull':(0.16,0.44,0.88),'reg':(0.12,0.60,0.38),'cyc':(0.50,0.28,0.82)}
METAL = {1:(0.82,0.52,0.30),2:(0.82,0.52,0.30),3:(0.84,0.86,0.90),4:(0.84,0.86,0.90),5:(0.97,0.78,0.32)}
LOCK_METAL = (0.30,0.32,0.36); LOCK_ENAMEL = (0.13,0.14,0.17)

# coordonnées : le médaillon occupe un rayon de 0.70 du demi-côté, les ornements vont jusqu'à ~0.95
yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
cx = cy = (N - 1) / 2
R0 = N * 0.345                      # rayon extérieur de la jante en pixels
X = (xx - cx) / R0; Y = (yy - cy) / R0   # Y vers le bas
R = np.sqrt(X * X + Y * Y)
ANG = np.arctan2(Y, X)

def smooth(a, px):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(px))
    return np.asarray(im).astype(np.float64) / 255

def mask_from_draw(fn):
    im = Image.new('L', (N, N), 0); d = ImageDraw.Draw(im); fn(d); return np.asarray(im).astype(np.float64) / 255

def P(x, y):  # unités médaillon → pixels
    return (cx + x * R0, cy + y * R0)

def text_mask(txt, font_path, size_units, y_units, spacing=0):
    f = ImageFont.truetype(font_path, int(size_units * R0))
    im = Image.new('L', (N, N), 0); d = ImageDraw.Draw(im)
    if spacing:
        # lettrage espacé
        w = sum(d.textlength(ch, font=f) for ch in txt) + spacing * R0 * (len(txt) - 1)
        x = cx - w / 2
        for ch in txt:
            d.text((x, cy + y_units * R0), ch, font=f, fill=255, anchor='lm'); x += d.textlength(ch, font=f) + spacing * R0
    else:
        d.text((cx, cy + y_units * R0), txt, font=f, fill=255, anchor='mm')
    return np.asarray(im).astype(np.float64) / 255

def arc_text(txt, radius_units, font_path, size_units, top=True, spacing_deg=None):
    """texte le long d'un arc (centré en haut ou en bas), rendu en masque"""
    f = ImageFont.truetype(font_path, int(size_units * R0)); im = Image.new('L', (N, N), 0)
    widths = [f.getlength(ch) for ch in txt]; rad = radius_units * R0
    gap = (spacing_deg if spacing_deg is not None else 1.2)
    angs = [math.degrees(w / rad) for w in widths]; total = sum(angs) + gap * (len(txt) - 1)
    a = -total / 2
    for ch, w, da in zip(txt, widths, angs):
        mid = a + da / 2; a += da + gap
        theta = math.radians(mid)
        if top: x = cx + rad * math.sin(theta); y = cy - rad * math.cos(theta); rot = -mid
        else: x = cx + rad * math.sin(theta); y = cy + rad * math.cos(theta); rot = mid
        g = Image.new('L', (int(w) + 40, int(size_units * R0 * 1.6)), 0); ImageDraw.Draw(g).text((g.width / 2, g.height / 2), ch, font=f, fill=255, anchor='mm')
        g = g.rotate(rot, resample=Image.BICUBIC, expand=True)
        im.paste(g, (int(x - g.width / 2), int(y - g.height / 2)), g)
    return np.asarray(im).astype(np.float64) / 255

def silhouette(fam):
    """masque de la forme principale (unités médaillon) : disque, kettlebell, hexagone, chronomètre, écusson"""
    if fam == 'pr':      # kettlebell : corps rond à fond plat, anse rendue en ornement
        def kb(d):
            d.ellipse([P(-0.98, -0.82), P(0.98, 1.14)], fill=255)
            d.rectangle([P(-1.2, 0.86), P(1.2, 1.4)], fill=0)
            d.rounded_rectangle([P(-0.74, 0.70), P(0.74, 0.95)], radius=0.12 * R0, fill=255)
        return mask_from_draw(kb)
    if fam == 'pull':    # tête d'haltère hexagonale
        return mask_from_draw(lambda d: d.polygon([P(math.cos(math.radians(a)) * 1.02, math.sin(math.radians(a)) * 1.02) for a in range(0, 360, 60)], fill=255))
    if fam == 'reg':     # chronomètre : boîtier rond + poussoir et épaulements
        def sw(d):
            d.ellipse([P(-0.94, -0.94), P(0.94, 0.94)], fill=255)
        return mask_from_draw(sw)
    if fam == 'cyc':     # écusson
        def shield(d):
            d.polygon([P(-0.96, -0.80), P(0.96, -0.80), P(0.96, 0.15), P(0.80, 0.55), P(0.45, 0.88), P(0, 1.06), P(-0.45, 0.88), P(-0.80, 0.55), P(-0.96, 0.15)], fill=255)
            d.rounded_rectangle([P(-0.96, -1.0), P(0.96, -0.6)], radius=0.14 * R0, fill=255)
        return mask_from_draw(shield)
    return (R <= 1.0).astype(np.float64)

def ornament(fam, tier):
    """retourne (hauteur, masque métal, masque émail, masque alpha) de l'ornement derrière le médaillon"""
    h = np.zeros((N, N)); metal = np.zeros((N, N)); enamel = np.zeros((N, N))
    if fam == 'ses':
        pass
    elif fam == 'ses_old':
        n = 8 + tier * 2
        def rays(d):
            for i in range(n):
                a0 = i * 2 * math.pi / n; a1 = a0 + math.pi / n
                pts = [P(0.95 * math.cos(a0 - math.pi / n / 2), 0.95 * math.sin(a0 - math.pi / n / 2)), P(1.22 * math.cos(a0), 1.22 * math.sin(a0)), P(0.95 * math.cos(a1 - math.pi / n / 2), 0.95 * math.sin(a1 - math.pi / n / 2)), P(0, 0)]
                d.polygon(pts, fill=255)
        m = mask_from_draw(rays); metal = m; h = 0.10 * smooth(m, N * 0.006) + 0.04 * smooth(m, N * 0.03)
    elif fam == 'pr':
        def handle(d):
            d.arc([P(-0.60, -1.56), P(0.60, -0.10)], start=180, end=360, fill=255, width=int(0.17 * R0))
        m = mask_from_draw(handle); metal = m; h = 0.16 * smooth(m, N * 0.006) + 0.05 * smooth(m, N * 0.02)
    elif fam == 'pr_old':
        def crown(d):
            pts = [P(-0.70, -0.55), P(-0.52, -1.18), P(-0.26, -0.80), P(0, -1.32), P(0.26, -0.80), P(0.52, -1.18), P(0.70, -0.55)]
            d.polygon(pts, fill=255)
            for (x, y) in [(-0.52, -1.18), (0, -1.32), (0.52, -1.18)]:
                d.ellipse([P(x - 0.075, y - 0.075), P(x + 0.075, y + 0.075)], fill=255)
        m = mask_from_draw(crown); metal = m; h = 0.12 * smooth(m, N * 0.006) + 0.05 * smooth(m, N * 0.03)
        gem = mask_from_draw(lambda d: d.ellipse([P(-0.075, -0.95), P(0.075, -0.80)], fill=255))
        enamel = gem; h += 0.10 * smooth(gem, N * 0.004)
    elif fam == 'pull':
        def bar(d):
            d.rounded_rectangle([P(-1.25, -1.20), P(1.25, -1.02)], radius=0.09 * R0, fill=255)
            d.line([P(-0.42, -1.10), P(-0.36, -0.60)], fill=255, width=int(0.07 * R0))
            d.line([P(0.42, -1.10), P(0.36, -0.60)], fill=255, width=int(0.07 * R0))
        m = mask_from_draw(bar); metal = m; h = 0.14 * smooth(m, N * 0.006) + 0.05 * smooth(m, N * 0.02)
    elif fam == 'reg':
        def crown(d):
            d.rounded_rectangle([P(-0.13, -1.30), P(0.13, -0.90)], radius=0.05 * R0, fill=255)
            d.rounded_rectangle([P(-0.24, -1.42), P(0.24, -1.24)], radius=0.06 * R0, fill=255)
            for sgn in (-1, 1):
                im2 = Image.new('L', (N, N), 0); d2 = ImageDraw.Draw(im2)
                d2.rounded_rectangle([P(-0.10, -1.16), P(0.10, -0.86)], radius=0.05 * R0, fill=255)
                im2 = im2.rotate(-sgn * 42, resample=Image.BICUBIC, center=(cx, cy)); d.bitmap((0, 0), im2, fill=255)
        m = mask_from_draw(crown); metal = m; h = 0.16 * smooth(m, N * 0.005) + 0.05 * smooth(m, N * 0.02)
    elif fam == 'reg_old':
        def ring(d):
            for i in range(7):
                a0 = -90 + i * 360 / 7 + 4; a1 = -90 + (i + 1) * 360 / 7 - 4
                d.arc([P(-1.17, -1.17), P(1.17, 1.17)], start=a0, end=a1, fill=255, width=int(0.13 * R0))
        m = mask_from_draw(ring); enamel = m; h = 0.12 * smooth(m, N * 0.004) + 0.04 * smooth(m, N * 0.015)
    elif fam == 'cyc':
        pass
    elif fam == 'cyc_old':
        def orbit(d):
            im2 = Image.new('L', (N, N), 0); d2 = ImageDraw.Draw(im2)
            d2.ellipse([P(-1.30, -0.46), P(1.30, 0.46)], outline=255, width=int(0.075 * R0))
            d2.ellipse([P(1.30 - 0.11, -0.11), P(1.30 + 0.11, 0.11)], fill=255)
            im2 = im2.rotate(25, resample=Image.BICUBIC, center=(cx, cy))
            d.bitmap((0, 0), im2, fill=255)
        m = mask_from_draw(orbit); metal = m; h = 0.12 * smooth(m, N * 0.006)
    alpha = np.clip(metal + enamel, 0, 1)
    return h, metal, enamel, alpha

def render(bid, fam, tier, big, lab, locked):
    # --- corps : silhouette propre à la famille, bord caoutchouc bombé, collerette acier, face plate, moyeu acier (distance au bord)
    sil = silhouette(fam) if fam != 'rank' else (R <= 1.0).astype(np.float64)
    D = ndimage.distance_transform_edt(sil > 0.5) / R0          # distance au bord, en unités médaillon
    h = np.zeros((N, N))
    edge = (sil > 0.5) & (D < 0.10); t = np.clip((0.05 - D) / 0.05, -1, 1)
    h = np.where(edge, 0.10 + 0.08 * np.sqrt(np.clip(1 - t * t, 0, 1)), h)
    collar = (D >= 0.10) & (D < 0.155); tc = np.clip((D - 0.1275) / 0.0275, -1, 1)
    h = np.where(collar, 0.12 + 0.05 * np.sqrt(np.clip(1 - tc * tc, 0, 1)), h)
    face = (D >= 0.155); h = np.where(face, 0.10, h)
    HUB = 0.33 if fam in ('reg',) else 0.37
    hubbev = (R >= HUB) & (R < HUB + 0.06); h = np.where(hubbev, 0.10 + (HUB + 0.06 - R) / 0.06 * 0.06, h)
    hub = R < HUB; h = np.where(hub, 0.16 + 0.04 * (1 - (R / HUB) ** 2), h)
    metal = (collar | hubbev | hub).astype(np.float64) * sil; enamel = (edge | face).astype(np.float64) * sil * (1 - metal)
    # lettrage moulé en relief : marque en haut, légende en bas ; fines rainures concentriques sur la face
    ry = 0.66 if fam in ('ses', 'pull', 'rank') else 0.60
    brand = arc_text('RITUEL', ry, FONT_LAB, 0.15, top=True, spacing_deg=4) * face
    h = h + 0.06 * smooth(brand, N * 0.0015)
    lm = (arc_text(lab, ry, FONT_LAB, 0.13, top=False, spacing_deg=3) if lab else np.zeros((N, N))) * face
    h = h + 0.06 * smooth(lm, N * 0.0015)
    h = np.where(face, h + 0.004 * np.sin(R * 160) * (R > HUB + 0.10) * (D > 0.20), h)
    if fam == 'reg':   # cadran : 7 segments en relief autour du moyeu
        def segs(d):
            for i in range(7):
                a0 = -90 + i * 360 / 7 + 5; a1 = -90 + (i + 1) * 360 / 7 - 5
                d.arc([P(-0.50, -0.50), P(0.50, 0.50)], start=a0, end=a1, fill=255, width=int(0.07 * R0))
        sg = mask_from_draw(segs); h = h + 0.05 * smooth(sg, N * 0.002); metal = np.clip(metal + sg, 0, 1); enamel = np.clip(enamel - sg, 0, 1)
    # chiffre gravé dans le moyeu
    if big.startswith('^'):
        n = int(big[1:])
        def chev(d):
            for i in range(n):
                y0 = 0.0 + (i - (n - 1) / 2) * 0.11
                d.line([P(-0.19, y0 + 0.08), P(0, y0 - 0.05), P(0.19, y0 + 0.08)], fill=255, width=int(0.08 * R0), joint='curve')
        tm = mask_from_draw(chev)
    elif big == '★':
        def star(d):
            pts = [P(0.24 * math.cos(math.radians(-90 + i * 36)) * (1 if i % 2 == 0 else 0.42), 0.02 + 0.24 * math.sin(math.radians(-90 + i * 36)) * (1 if i % 2 == 0 else 0.42)) for i in range(10)]
            d.polygon(pts, fill=255)
        tm = mask_from_draw(star)
    elif big == '↑':
        def arrow(d):
            d.polygon([P(0, -0.24), P(0.21, -0.02), P(0.09, -0.02), P(0.09, 0.22), P(-0.09, 0.22), P(-0.09, -0.02), P(-0.21, -0.02)], fill=255)
        tm = mask_from_draw(arrow)
    elif big == '∞':
        tm = text_mask('∞', FONT_BIG, 0.52, 0.0)
    else:
        sz = 0.42 if len(big) <= 2 else 0.33 if len(big) == 3 else 0.27
        tm = text_mask(big, FONT_BIG, sz, 0.02)
    tmb = smooth(tm, N * 0.002)
    h = h - 0.05 * tmb
    # --- ornement
    oh, om, oe, oa = ornament(fam, tier) if fam != 'rank' else (np.zeros((N, N)),) * 4
    inside = sil
    h = np.where(inside > 0, h, oh); metal = np.where(inside > 0, metal, om); enamel = np.where(inside > 0, enamel, oe)
    alpha = np.clip(inside + oa, 0, 1)
    # --- normales
    scale = R0 * 0.55
    dzdx = np.gradient(h, axis=1) * scale; dzdy = np.gradient(h, axis=0) * scale
    nx = -dzdx; ny = -dzdy; nz = np.ones_like(h); ln = np.sqrt(nx * nx + ny * ny + nz * nz); nx /= ln; ny /= ln; nz /= ln
    # --- éclairage
    def norm(v): v = np.array(v, dtype=np.float64); return v / np.linalg.norm(v)
    L1 = norm((-0.45, -0.75, 0.55)); L2 = norm((0.7, 0.4, 0.5)); V = np.array((0, 0, 1.0))
    ndl1 = np.clip(nx * L1[0] + ny * L1[1] + nz * L1[2], 0, 1); ndl2 = np.clip(nx * L2[0] + ny * L2[1] + nz * L2[2], 0, 1)
    H1 = norm(L1 + V); H2 = norm(L2 + V)
    ndh1 = np.clip(nx * H1[0] + ny * H1[1] + nz * H1[2], 0, 1); ndh2 = np.clip(nx * H2[0] + ny * H2[1] + nz * H2[2], 0, 1)
    # réflexion d'environnement pour le métal : ciel clair en haut, horizon marqué, sol sombre
    ry = -(2 * nz * ny)           # composante verticale du vecteur réfléchi (vers le haut positif)
    rx = -(2 * nz * nx)
    env = np.where(ry > 0.05, 0.80 + 0.20 * np.clip(ry, 0, 1), np.where(ry > -0.05, 0.55 + (ry + 0.05) / 0.10 * 0.25, 0.30 + 0.20 * np.clip(1 + ry, 0, 1)))
    env = env + 0.10 * np.sin(rx * 6) * (np.abs(ry) < 0.4)  # reflets latéraux
    env = np.clip(env, 0, 1)
    mc = np.array(LOCK_METAL if locked else METAL[tier]); ec = np.array(LOCK_ENAMEL if locked else (RANK_ENAMEL[int(big[1:]) - 1] if fam == 'rank' else ENAMEL[fam]))
    spec_m = (0.9 * ndh1 ** 90 + 0.35 * ndh2 ** 40) * (0.35 if locked else 1.0)
    metal_rgb = mc[None, None, :] * (0.25 + 0.75 * env)[..., None] * (0.75 + 0.25 * ndl1)[..., None] + spec_m[..., None] * np.array([1, 1, 0.95])
    diff = 0.50 + 0.60 * ndl1 + 0.18 * ndl2
    fres = (1 - nz) ** 2
    vign = 1 - 0.22 * np.clip(1 - D, 0, 1) ** 6
    spec_e = (0.55 * ndh1 ** 120 + 0.18 * ndh2 ** 50) * (0.4 if locked else 1.0)
    enamel_rgb = ec[None, None, :] * (diff * vign)[..., None] * (1 + 0.6 * fres)[..., None] + spec_e[..., None] * np.array([1, 1, 1]) + (0.10 * fres * (not locked))[..., None] * np.array([1, 1, 1])
    # reflet glacé en haut du dôme
    gloss = np.clip(1 - ((X) ** 2 / 0.55 + (Y + 0.62) ** 2 / 0.03), 0, 1) * (D > 0.155) * (R > HUB + 0.07) * (0.10 if locked else 0.22)
    enamel_rgb = enamel_rgb + gloss[..., None]
    rgb = metal_rgb * metal[..., None] + enamel_rgb * enamel[..., None]
    # ombre d'occlusion sous la jante intérieure
    ao = (1 - 0.22 * np.clip(1 - np.abs(R - (HUB + 0.06)) / 0.04, 0, 1)) * (1 - 0.18 * np.clip(1 - np.abs(D - 0.155) / 0.03, 0, 1))
    rgb = rgb * ao[..., None] * (1 - 0.28 * tmb)[..., None]
    rgb = np.clip(rgb, 0, 1) ** (1 / 1.05)
    # --- composition avec ombre portée
    a = smooth(alpha, N * 0.002)
    out = np.zeros((N, N, 4)); out[..., :3] = rgb; out[..., 3] = a
    img = Image.fromarray((out * 255).astype(np.uint8), 'RGBA')
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sa = (smooth(alpha, N * 0.012) * (0.10 if locked else 0.30) * 255).astype(np.uint8)
    sh.putalpha(Image.fromarray(sa)); sh = sh.transform(sh.size, Image.AFFINE, (1, 0, 0, 0, 1, -N * 0.012))
    comp = Image.alpha_composite(sh, img).resize((SIZE, SIZE), Image.LANCZOS)
    return comp

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for i in range(5):
        render(f'rank{i+1}', 'rank', RANK_METAL[i], f'^{i+1}', '', False).save(os.path.join(OUT, f'rank{i+1}.webp'), 'WEBP', quality=88, method=6); print('· rank', i + 1)
    for bid, fam, tier, big, lab in BADGES:
        for locked in (False, True):
            im = render(bid, fam, tier, big, lab, locked)
            im.save(os.path.join(OUT, f'{bid}{"_lock" if locked else ""}.webp'), 'WEBP', quality=88, method=6)
        print('·', bid)
    # planche de contrôle
    sheet = Image.new('RGBA', (SIZE * 6, SIZE * 3), (244, 245, 247, 255))
    for i, (bid, *_r) in enumerate(BADGES):
        im = Image.open(os.path.join(OUT, f'{bid}{"_lock" if i % 4 == 3 else ""}.webp'))
        sheet.alpha_composite(im, ((i % 6) * SIZE, (i // 6) * SIZE))
    for i in range(5):
        im = Image.open(os.path.join(OUT, f'rank{i+1}.webp'))
        sheet.alpha_composite(im, ((i + 1) * SIZE // 2 + 17 % 6 * SIZE, 2 * SIZE))
    sheet.convert('RGB').save(os.path.join(OUT, '..', '..', 'tools', 'badges-planche.png'))
