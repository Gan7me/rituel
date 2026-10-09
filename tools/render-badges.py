#!/usr/bin/env python3
"""Rendu 3D des médailles (champ de hauteur + éclairage physique simplifié) → public/badges/<id>.webp et <id>_lock.webp.
Usage : python3 tools/render-badges.py [taille=512]
Géométrie : jante torique chromée, bande plate, biseau, dôme d'émail guilloché, chiffre en relief métal, légende gravée,
ornement par famille (rayons, couronne, barre de traction, anneau de 7 segments, orbite)."""
import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

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

def ornament(fam, tier):
    """retourne (hauteur, masque métal, masque émail, masque alpha) de l'ornement derrière le médaillon"""
    h = np.zeros((N, N)); metal = np.zeros((N, N)); enamel = np.zeros((N, N))
    if fam == 'ses':
        n = 8 + tier * 2
        def rays(d):
            for i in range(n):
                a0 = i * 2 * math.pi / n; a1 = a0 + math.pi / n
                pts = [P(0.95 * math.cos(a0 - math.pi / n / 2), 0.95 * math.sin(a0 - math.pi / n / 2)), P(1.22 * math.cos(a0), 1.22 * math.sin(a0)), P(0.95 * math.cos(a1 - math.pi / n / 2), 0.95 * math.sin(a1 - math.pi / n / 2)), P(0, 0)]
                d.polygon(pts, fill=255)
        m = mask_from_draw(rays); metal = m; h = 0.10 * smooth(m, N * 0.006) + 0.04 * smooth(m, N * 0.03)
    elif fam == 'pr':
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
        def ring(d):
            for i in range(7):
                a0 = -90 + i * 360 / 7 + 4; a1 = -90 + (i + 1) * 360 / 7 - 4
                d.arc([P(-1.17, -1.17), P(1.17, 1.17)], start=a0, end=a1, fill=255, width=int(0.13 * R0))
        m = mask_from_draw(ring); enamel = m; h = 0.12 * smooth(m, N * 0.004) + 0.04 * smooth(m, N * 0.015)
    elif fam == 'cyc':
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
    # --- hauteur et matériaux du médaillon
    h = np.zeros((N, N))
    rim = (R >= 0.78) & (R <= 1.0)
    t = np.clip((R - 0.89) / 0.11, -1, 1)
    h = np.where(rim, 0.18 * np.sqrt(np.clip(1 - t * t, 0, 1)) + 0.02, h)
    band = (R >= 0.72) & (R < 0.78); h = np.where(band, 0.10, h)
    bev = (R >= 0.695) & (R < 0.72); h = np.where(bev, 0.10 - (0.72 - R) / 0.025 * 0.07, h)
    dome = R < 0.695; h = np.where(dome, 0.03 + 0.07 * (1 - (R / 0.695) ** 2), h)
    # guilloché : fines rainures concentriques + rayons
    metal = (R >= 0.695).astype(np.float64); enamel = (R < 0.695).astype(np.float64)
    # chiffre en relief (métal) et légende gravée
    if big.startswith('^'):
        n = int(big[1:])
        def chev(d):
            for i in range(n):
                y0 = -0.02 + (i - (n - 1) / 2) * 0.17
                d.line([P(-0.30, y0 + 0.12), P(0, y0 - 0.08), P(0.30, y0 + 0.12)], fill=255, width=int(0.13 * R0), joint='curve')
        tm = mask_from_draw(chev); lab = ''
    elif big in ('★', '↑', '∞'):
        glyph = {'★': 'M', '↑': 'T', '∞': '∞'}[big]
        if big == '★':
            def star(d):
                pts = [P(0.33 * math.cos(math.radians(-90 + i * 36)) * (1 if i % 2 == 0 else 0.42), -0.06 + 0.33 * math.sin(math.radians(-90 + i * 36)) * (1 if i % 2 == 0 else 0.42)) for i in range(10)]
                d.polygon(pts, fill=255)
            tm = mask_from_draw(star)
        elif big == '↑':
            def arrow(d):
                d.polygon([P(0, -0.40), P(0.30, -0.08), P(0.13, -0.08), P(0.13, 0.26), P(-0.13, 0.26), P(-0.13, -0.08), P(-0.30, -0.08)], fill=255)
            tm = mask_from_draw(arrow)
        else:
            tm = text_mask('∞', FONT_BIG, 0.80, -0.08)
    else:
        sz = 0.62 if len(big) <= 2 else 0.50 if len(big) == 3 else 0.42
        tm = text_mask(big, FONT_BIG, sz, -0.06)
    tmb = smooth(tm, N * 0.0025)
    guil = (0.0028 * np.sin(R * 110) + 0.0015 * np.sin(ANG * 48) * (R > 0.25)) * (R < 0.66) * (1 - smooth(tm, N * 0.006))
    h = h + guil + 0.09 * tmb; metal = np.clip(metal + tm, 0, 1); enamel = np.clip(enamel - tm, 0, 1)
    lm = text_mask(lab, FONT_LAB, 0.105, 0.34, spacing=0.012) if lab else np.zeros((N, N))
    h = h + 0.03 * smooth(lm, N * 0.0015); metal = np.clip(metal + lm, 0, 1); enamel = np.clip(enamel - lm, 0, 1)
    # --- ornement
    oh, om, oe, oa = ornament(fam, tier) if fam != 'rank' else (np.zeros((N, N)),) * 4
    inside = (R <= 1.0).astype(np.float64)
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
    vign = 1 - 0.40 * np.clip(R / 0.695, 0, 1) ** 3
    spec_e = (0.55 * ndh1 ** 120 + 0.18 * ndh2 ** 50) * (0.4 if locked else 1.0)
    enamel_rgb = ec[None, None, :] * (diff * vign)[..., None] * (1 + 0.6 * fres)[..., None] + spec_e[..., None] * np.array([1, 1, 1]) + (0.10 * fres * (not locked))[..., None] * np.array([1, 1, 1])
    # reflet glacé en haut du dôme
    gloss = np.clip(1 - ((X) ** 2 / 0.30 + (Y + 0.36) ** 2 / 0.05), 0, 1) * (R < 0.68) * (0.12 if locked else 0.35)
    enamel_rgb = enamel_rgb + gloss[..., None]
    rgb = metal_rgb * metal[..., None] + enamel_rgb * enamel[..., None]
    # ombre d'occlusion sous la jante intérieure
    ao = 1 - 0.25 * np.clip(1 - np.abs(R - 0.695) / 0.05, 0, 1)
    rgb = rgb * ao[..., None]
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
