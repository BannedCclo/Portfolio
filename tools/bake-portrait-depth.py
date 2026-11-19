#!/usr/bin/env python3
"""
bake-portrait-depth.py — foto  →  retrato em camadas (paralaxe 2.5D)

Alimenta o componente <DepthPortrait> (src/components/depthPortrait). Tudo o
que é caro roda aqui, uma vez, offline; o navegador só recebe imagens prontas.

  assets-source/retrato-original.*   (entrada, a foto sem nenhum tratamento)
        │
        ├─ recorte ........ BiRefNet (via rembg) → alfa macio, inclusive no cabelo
        ├─ limpeza ........ tira o ceu que o BiRefNet deixou entre os fios da
        │                   franja e a rua na fresta atras do braco
        ├─ partes ......... SegFormer (human parsing) → cabeca / corpo / mao,
        │                   com as bordas alinhadas a foto (guided filter)
        ├─ preenchimento .. o que cada camada esconde da de tras: casaco sob a
        │                   mao, pescoco sob a gola
        ├─ profundidade ... Depth Anything V2 (Small, Apache-2.0) — mas so a
        │                   forma GERAL de cada camada (muito suavizada): da
        │                   uma curvatura leve, nao relevo de pixel
        │
        ▼
  src/assets/eu/portrait/{head,body,hand}.webp   RGBA, recortados na caixa da camada
  src/assets/eu/portrait/depth.png               RGB = profundidade de cabeca/corpo/mao
  src/assets/eu/portrait/layers.json             caixas e ordem das camadas
  src/assets/eu/portrait-color.webp              o recorte inteiro (imagem plana)

Por que camadas e nao um unico relevo: deslocar a foto inteira por um mapa de
profundidade denso entorta o rosto (o mapa estimado nunca e exato no nariz,
nos labios, no contorno) e a luz da foto passa a "escorregar" pela geometria.
Em camadas, cada parte e um recorte rigido — os pixels continuam onde estavam
uns em relacao aos outros — e o volume vem de as partes deslizarem entre si.

Dependencias (venv a parte, nao entram no package.json):
  torch torchvision transformers rembg onnxruntime pymatting
  opencv-python-headless scipy pillow numpy

uso:  python tools/bake-portrait-depth.py [--debug] [--reuse]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets-source"
OUT_DIR = ROOT / "src" / "assets" / "eu"
LAYER_DIR = OUT_DIR / "portrait"
DEBUG_DIR = ROOT / "assets-source" / "_debug"

DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
MATTE_MODEL = "birefnet-portrait"
PARSE_MODEL = "mattmdjaga/segformer_b2_clothes"  # MIT
# rotulos do PARSE_MODEL usados aqui
L_HAIR, L_GLASSES, L_CLOTHES, L_FACE, L_ARM_L = 2, 3, 4, 11, 14
PARSE_KEEP = (L_HAIR, L_GLASSES, L_FACE, L_ARM_L)

# niveis finais do alfa (ver normalize_alpha)
ALPHA_FLOOR = 0.01
ALPHA_CEIL = 0.98

# ---- limpeza: valores especificos DESTA foto (coordenadas em px da fonte) --
# Franja esquerda: fios escuros pendendo sobre o ceu claro. Tudo a esquerda do
# contorno da tempora (marcado a mao) passa por uma chave de luminancia contra
# o ceu local. A testa e a orelha ficam de fora de proposito: sao tao claras
# quanto o ceu e uma chave automatica as furaria.
FRINGE_POLY = [(350, 262), (472, 262), (456, 300), (441, 340), (434, 400),
               (419, 430), (409, 445), (404, 465), (406, 488), (350, 488)]
# luminancia dos fios mais escuros da franja (referencia "100% cabelo")
HAIR_DARK = 0.32
# maciez da chave da franja: desfoque da medida, rampa (0 = ceu → 1 = cabelo)
# e desfoque final do alfa — a franja fica com borda de cabelo, nao de recorte
FRINGE_KEY_BLUR = 1.1
FRINGE_KEY_RAMP = (0.12, 0.85)
FRINGE_ALPHA_BLUR = 1.0
# Fresta entre o braco esquerdo e o corpo: a rua aparece em tres triangulos
# que o BiRefNet manteve. Casaco e quase preto; o asfalto, cinza.
ARM_GAP_ROI = (1160, 1290, 390, 432)  # y0, y1, x0, x1
ARM_GAP_LUM = (0.17, 0.30)

# ---- camadas ---------------------------------------------------------------
# quanto a cabeca continua por baixo da gola/casaco (px): cobre o que a gola
# revela quando desliza na orbita
HEAD_EXTEND = 48
# suavizacao da profundidade de cada camada (sigma em px da fonte). Grande =
# so a forma geral, sem relevo de nariz/labios — o que entortava o rosto.
Z_SIGMA = {"head": 26, "body": 42, "hand": 20}
# quanto da curvatura de cada camada fica (0 = plano rigido, 1 = forma toda)
Z_CURVE = {"head": 0.55, "body": 0.6, "hand": 0.6}
# luminancia minima da pele da mao (o casaco atras fica perto de 0.1)
HAND_SKIN_LUM = 0.28
# espessura da mao sobre o casaco, em unidades do mapa (ver layer_depth).
# Com o RELIEF do motor (0.42), ~0.13 da uns 4 cm num quadro de ~70 cm de
# altura. Mudou o RELIEF? Ajuste aqui na proporcao inversa.
HAND_LIFT = 0.13
# o mapa de profundidade das camadas sai nesta fracao da resolucao (e liso)
Z_SCALE = 0.25
# DETILT: modelos monoculares "deitam" a pessoa (mais baixo na foto = mais
# perto), afundando a cabeca atras do peito. Tira essa fracao da inclinacao.
DETILT = 0.85


def find_source() -> Path:
    for ext in ("webp", "png", "jpg", "jpeg"):
        p = SRC_DIR / f"retrato-original.{ext}"
        if p.exists():
            return p
    sys.exit("assets-source/retrato-original.(webp|png|jpg) nao encontrado")


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def nearest_fill(src: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Cada pixel fora de `known` recebe o valor do pixel conhecido mais proximo."""
    _, (iy, ix) = ndi.distance_transform_edt(~known, return_indices=True)
    return src[iy, ix]


def guided_filter(guide: np.ndarray, src: np.ndarray, r: int, eps: float):
    """Guided filter (He et al.): suaviza `src` preservando bordas de `guide`."""
    k = (2 * r + 1, 2 * r + 1)

    def box(x):
        return cv2.boxFilter(x, -1, k, normalize=True, borderType=cv2.BORDER_REFLECT)

    mi, mp = box(guide), box(src)
    cov = box(guide * src) - mi * mp
    var = box(guide * guide) - mi * mi
    a = cov / (var + eps)
    b = mp - a * mi
    return box(a) * guide + box(b)


def masked_blur(x: np.ndarray, m: np.ndarray, sigma: float) -> np.ndarray:
    """Desfoque so com os pixels de `m` (convolucao normalizada), estendido a tudo."""
    m = m.astype(np.float32)
    num = cv2.GaussianBlur(x * m, (0, 0), sigma)
    den = cv2.GaussianBlur(m, (0, 0), sigma)
    ok = den > 1e-3
    out = np.where(ok, num / np.maximum(den, 1e-6), 0.0).astype(np.float32)
    return nearest_fill(out, ok)


# --------------------------------------------------------------------------
# modelos (cacheados em assets-source/_debug/cache.npz)
# --------------------------------------------------------------------------
def matte(img: Image.Image) -> np.ndarray:
    """Alfa float32 [0,1], mesmo tamanho da imagem."""
    from rembg import new_session, remove

    session = new_session(MATTE_MODEL)
    mask = remove(img, session=session, only_mask=True)
    return np.asarray(mask, dtype=np.float32) / 255.0


def clean_alpha(a: np.ndarray) -> np.ndarray:
    """Mantem so o maior componente conexo e fecha buracos pequenos."""
    solid = a > 0.5
    lab, n = ndi.label(solid)
    if n > 1:
        sizes = ndi.sum(solid, lab, range(1, n + 1))
        keep = lab == (1 + int(np.argmax(sizes)))
        near = ndi.binary_dilation(keep, iterations=6)
        a = np.where(near, a, 0.0)
    holes = ndi.binary_fill_holes(a > 0.5) & ~(a > 0.5)
    lab, n = ndi.label(holes)
    if n:
        sizes = ndi.sum(holes, lab, range(1, n + 1))
        for i, s in enumerate(sizes, start=1):
            if s < 1500:  # buraco pequeno = erro do modelo, nao vao real
                a[lab == i] = 1.0
    return np.clip(a, 0.0, 1.0)


def parse(img: Image.Image) -> np.ndarray:
    """Probabilidade por rotulo de PARSE_KEEP, float32 [len(PARSE_KEEP),H,W]."""
    import torch
    from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation

    proc = AutoImageProcessor.from_pretrained(PARSE_MODEL)
    model = AutoModelForSemanticSegmentation.from_pretrained(PARSE_MODEL).eval()
    with torch.no_grad():
        logits = model(**proc(images=img, return_tensors="pt")).logits
    up = torch.nn.functional.interpolate(
        logits, size=img.size[::-1], mode="bilinear", align_corners=False
    )
    prob = up.softmax(1)[0].numpy()
    return prob[list(PARSE_KEEP)].astype(np.float32)


def _predict(model, processor, img: Image.Image, scale: int) -> np.ndarray:
    import torch

    w, h = img.size
    inputs = processor(
        images=img,
        return_tensors="pt",
        size={"height": scale, "width": scale},
        keep_aspect_ratio=True,
        ensure_multiple_of=14,
    )
    with torch.no_grad():
        out = model(**inputs).predicted_depth  # [1,H,W], maior = mais perto
    d = out[0].numpy().astype(np.float32)
    return cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)


def predict_depth(img: Image.Image) -> np.ndarray:
    """Media de duas escalas + espelhamento, cada previsao normalizada."""
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    processor = AutoImageProcessor.from_pretrained(DEPTH_MODEL)
    model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL).eval()
    flipped = img.transpose(Image.FLIP_LEFT_RIGHT)
    acc = []
    for scale in (518, 1036):
        d = _predict(model, processor, img, scale)
        df = _predict(model, processor, flipped, scale)[:, ::-1]
        for x in (d, df):
            lo, hi = np.percentile(x, [1, 99])
            acc.append(np.clip((x - lo) / max(hi - lo, 1e-6), 0, 1))
    return (sum(acc) / len(acc)).astype(np.float32)


# --------------------------------------------------------------------------
# limpeza do recorte
# --------------------------------------------------------------------------
def clean_background(rgb: np.ndarray, a0: np.ndarray):
    """Tira os restos de fundo. Devolve (alfa, peso da franja, cor-de-cabelo)."""
    h, w = a0.shape
    lum = rgb.mean(-1)
    known_bg = a0 < 0.02
    # ceu local, estendido para dentro do cabelo a partir do fundo certo
    sky = cv2.GaussianBlur(nearest_fill(rgb, known_bg), (0, 0), 6).mean(-1)

    # quanto cada pixel e mais escuro que o ceu atras dele, em fracao do
    # contraste ceu→fio escuro: 0 = ceu puro, 1 = cabelo
    k = np.clip((sky - lum) / np.maximum(sky - HAIR_DARK, 0.1), 0, 1)
    # chave macia de proposito: uma rampa curta e sem desfoque recortava os
    # vaos entre os fios como furos de borda dura ("picotado")
    k = cv2.GaussianBlur(k, (0, 0), FRINGE_KEY_BLUR)
    key = smoothstep(*FRINGE_KEY_RAMP, k)
    keyed = cv2.GaussianBlur(np.minimum(a0, key), (0, 0), FRINGE_ALPHA_BLUR)

    region = np.zeros((h, w), np.uint8)
    cv2.fillPoly(region, [np.array(FRINGE_POLY, np.int32)], 1)
    # transicao larga na borda do poligono, para nao marcar onde a chave acaba
    region = cv2.GaussianBlur(region.astype(np.float32), (0, 0), 5.0)
    alpha = a0 + (keyed - a0) * region

    y0, y1, x0, x1 = ARM_GAP_ROI
    alpha[y0:y1, x0:x1] *= 1 - smoothstep(*ARM_GAP_LUM, lum[y0:y1, x0:x1])
    return np.clip(alpha, 0, 1).astype(np.float32), region


def foreground_color(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Cor do primeiro plano sem contaminacao do fundo, e sangrada para fora."""
    from pymatting import estimate_foreground_ml

    fg = np.clip(estimate_foreground_ml(rgb.astype(np.float64), alpha.astype(np.float64)), 0, 1)
    # pixels com alfa ~0 nao tem cor confiavel: copia a do vizinho solido mais
    # proximo. Sem isso o filtro bilinear da GPU mistura cinza nas bordas.
    core = ndi.binary_erosion(alpha > 0.9, iterations=2)
    bled = nearest_fill(fg, core)
    wgt = np.clip(alpha / 0.9, 0.0, 1.0)[..., None]
    out = np.where(core[..., None], fg, bled * (1 - wgt) + fg * wgt)
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def repaint_fringe(color, alpha, region, hair_mask):
    """Fios finos da franja: troca o tom de ceu que sobrou pela cor do cabelo."""
    core = ndi.binary_erosion(hair_mask & (alpha > 0.98), iterations=18)
    hair = cv2.GaussianBlur(nearest_fill(color, core), (0, 0), 4)
    wgt = (region * (1 - np.clip(alpha, 0, 1)))[..., None]
    return color * (1 - wgt) + np.minimum(color, hair) * wgt


def normalize_alpha(a: np.ndarray) -> np.ndarray:
    # o BiRefNet devolve ~0.996 no interior, nao 1.0: a figura inteira ficava
    # levemente translucida. Leva o interior a opaco e a franja quase
    # invisivel a zero, sem mexer na rampa macia do cabelo entre os extremos.
    return np.clip((a - ALPHA_FLOOR) / (ALPHA_CEIL - ALPHA_FLOOR), 0.0, 1.0)


# --------------------------------------------------------------------------
# camadas
# --------------------------------------------------------------------------
def membership(prob_sum: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Rotulo do parsing (borda grosseira) → mascara macia alinhada a foto."""
    m = guided_filter(gray, np.clip(prob_sum, 0, 1).astype(np.float32), r=6, eps=4e-4)
    m = smoothstep(0.35, 0.65, m)
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7)


def part_masks(prob: np.ndarray, rgb: np.ndarray, alpha: np.ndarray):
    h, w = alpha.shape
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    p = {lab: prob[i] for i, lab in enumerate(PARSE_KEEP)}
    yy = np.mgrid[0:h, 0:w][0]

    # cabeca = cabelo + rosto/pescoco + oculos (o rotulo "oculos" tambem
    # aparece no relogio, la embaixo: so vale perto do rosto)
    face_box = ndi.binary_dilation(p[L_FACE] > 0.5, iterations=40)
    sat = rgb.max(-1) - rgb.min(-1)
    glasses = (p[L_GLASSES] > 0.5) & face_box
    # o rotulo "rosto" desce ate a gola dourada da camisa, que e corpo: abaixo
    # dos oculos, dourado nao e cabeca
    below_glasses = yy > np.nonzero(glasses)[0].max() + 30
    collar = ndi.binary_dilation((sat > 0.10) & below_glasses, iterations=2)
    head_p = (p[L_HAIR] + p[L_FACE] + p[L_GLASSES] * face_box) * ~collar

    # mao = pele do braco levantado + punho dourado da camisa + relogio.
    # O dourado e a unica cor da foto (o resto e P&B): saturacao separa.
    arm = p[L_ARM_L] > 0.5
    near_arm = ndi.binary_dilation(arm, iterations=50)
    below = yy > np.median(np.nonzero(arm)[0])  # so a ponta do pulso, nao a gola
    gold = (sat > 0.10) & near_arm & below
    lab, n = ndi.label(gold | arm)
    keep = np.unique(lab[arm])
    hand_hard = np.isin(lab, keep[keep > 0])
    hand_hard = ndi.binary_closing(hand_hard, iterations=4)
    hand_hard = ndi.binary_fill_holes(hand_hard)  # mostrador escuro do relogio
    # o parsing come a ponta dos dedos; pele (clara, sem cor) sobre o casaco
    # (quase preto) e facil de separar: cresce a mao por ela
    lum = rgb.mean(-1)
    skin = (lum > HAND_SKIN_LUM) & (sat < 0.08) & ndi.binary_dilation(hand_hard, iterations=14)
    lab, _ = ndi.label(skin | hand_hard)
    keep = np.unique(lab[hand_hard])
    hand_hard = ndi.binary_fill_holes(np.isin(lab, keep[keep > 0]))
    hand_p = np.maximum(hand_hard.astype(np.float32), 0.5 * p[L_ARM_L])

    s_head = membership(head_p, gray)
    s_hand = membership(hand_p, gray) * (1 - s_head)
    return s_head, s_hand


def inpaint(color: np.ndarray, hole: np.ndarray, radius: int = 9) -> np.ndarray:
    """Telea (OpenCV) numa janela em volta do buraco — rapido e suficiente: so a
    faixa perto da borda chega a aparecer na orbita."""
    ys, xs = np.nonzero(hole)
    pad = radius * 4
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, hole.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, hole.shape[1])
    crop = (color[y0:y1, x0:x1] * 255 + 0.5).astype(np.uint8)
    m = hole[y0:y1, x0:x1].astype(np.uint8) * 255
    filled = cv2.inpaint(crop, m, radius, cv2.INPAINT_TELEA).astype(np.float32) / 255
    out = color.copy()
    out[y0:y1, x0:x1] = np.where(hole[y0:y1, x0:x1, None], filled, color[y0:y1, x0:x1])
    return out


def split_band(color: np.ndarray, s: np.ndarray, pad: int = 12):
    """Na faixa de transicao de uma parte, separa a cor da parte (F) da cor do
    que esta atras dela (B), com color ≈ s·F + (1-s)·B (pymatting).

    Entra `color` (o recorte ja sem o ceu), nao a foto: a separacao aqui e so
    entre partes da pessoa. Fora da caixa da parte, F = B = color."""
    from pymatting import estimate_foreground_ml

    ys, xs = np.nonzero(s > 0.002)
    h, w = s.shape
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, h)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, w)
    f, b = estimate_foreground_ml(
        color[y0:y1, x0:x1].astype(np.float64),
        s[y0:y1, x0:x1].astype(np.float64),
        return_background=True,
    )
    F, B = color.copy(), color.copy()
    F[y0:y1, x0:x1] = np.clip(f, 0, 1)
    B[y0:y1, x0:x1] = np.clip(b, 0, 1)
    return F, B


def build_layers(color, alpha, s_head, s_hand):
    """Tres camadas RGBA de tela inteira, de tras para frente.

    Em repouso, mao sobre corpo sobre cabeca reproduz o recorte: em cada faixa
    de emenda a camada da frente leva F e a de tras leva B (split_band), entao
    s·F + (1-s)·B = cor original. E, quando as camadas deslizam, nenhuma
    carrega um "fantasma" da borda da outra.
    """
    hand_hard = s_hand > 0.5
    # A mascara macia da cabeca nao chega a 1 na borda com o ceu, nem em ilhas
    # que o parsing errou (a ponta da lente esquerda): sem isto o corpo herdava
    # um contorno fraco da cabeca inteira, que se descolava na orbita. O corpo
    # so existe perto do proprio corpo (maior componente); o resto e cabeca.
    body_hard = (alpha > 0.5) & (s_head < 0.5)
    lab, n = ndi.label(body_hard)
    if n > 1:
        sizes = ndi.sum(body_hard, lab, range(1, n + 1))
        body_hard = lab == 1 + int(np.argmax(sizes))
    zone = cv2.GaussianBlur(
        ndi.binary_dilation(body_hard, iterations=4).astype(np.float32), (0, 0), 1.0
    )
    near_head = ndi.binary_dilation(s_head > 0.5, iterations=16)
    s_head = np.where(near_head, 1 - (1 - s_head) * zone, s_head)
    head_hard = s_head > 0.5
    band_h = (s_head > 0.002) & (s_head < 0.998)

    # --- cabeca: continua por baixo da gola/casaco
    ext = ndi.binary_dilation(head_hard, iterations=HEAD_EXTEND)
    ext &= (alpha > 0.5) & ~hand_hard
    ext_soft = cv2.GaussianBlur(ext.astype(np.float32), (0, 0), 1.0)
    head_a = alpha * np.maximum(s_head, ext_soft)
    F_head, B_head = split_band(color, s_head)
    # so pele/cabelo continuam por baixo (nunca a gola ou o casaco): cor do
    # pixel de cabeca mais proximo, desfocada para nao virar listras
    src = ndi.binary_erosion(head_hard, iterations=3)
    smear = cv2.GaussianBlur(nearest_fill(F_head, src), (0, 0), 3)
    # F so e confiavel onde a cabeca ja pesa na mistura; na ponta quase
    # transparente da emenda ele extrapola (sai azulado contra o dourado da
    # gola) — ali entra a pele vizinha. Em repouso o erro fica <= s·(1-w).
    w = smoothstep(0.2, 0.75, s_head)[..., None]
    head_c = F_head * w + smear * (1 - w)

    # --- corpo: tudo menos a cabeca; na emenda com a cabeca, B; sob a mao,
    # casaco reconstruido (so a partir de pixels de corpo — nunca da pele do
    # pescoco, que fica no buraco da cabeca)
    body_a = alpha * (1 - s_head)
    body_c = np.where(band_h[..., None], B_head, color)
    body_core = (body_a > 0.98) & ~hand_hard
    body_c = np.where((s_head > 0.5)[..., None], nearest_fill(body_c, body_core), body_c)
    under = ndi.binary_dilation(s_hand > 0.002, iterations=3)
    body_c = inpaint(body_c, under, radius=9)

    # --- mao: cor de primeiro plano estimada contra o casaco preto
    F_hand, _ = split_band(color, s_hand)
    hand_a = alpha * s_hand

    return {
        "head": (head_c, head_a, head_hard),
        "body": (body_c, body_a, (body_a > 0.5) & ~hand_hard),
        "hand": (F_hand, hand_a, hand_hard),
    }


def base_depth(raw: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Profundidade normalizada no primeiro plano, sem a inclinacao global."""
    h, w = raw.shape
    core = ndi.binary_erosion(alpha > 0.9, iterations=3)
    lo, hi = np.percentile(raw[core], [1.5, 99.0])
    d = np.clip((raw - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xs, ys = xx / w, yy / h
    A = np.stack([xs[core], ys[core], np.ones(core.sum(), np.float32)], 1)
    (a, b, _c), *_ = np.linalg.lstsq(A, d[core], rcond=None)
    return (d - DETILT * (a * xs + b * ys)).astype(np.float32)


def layer_depth(d: np.ndarray, layers: dict) -> dict:
    """Forma geral de cada camada: media mascarada bem larga + curvatura reduzida."""
    out = {}
    for name, (_c, _a, hard) in layers.items():
        core = ndi.binary_erosion(hard, iterations=4)
        z = masked_blur(d, core, Z_SIGMA[name])
        med = float(np.median(z[core]))
        out[name] = med + Z_CURVE[name] * (z - med)

    # A mao segura a lapela: esta encostada no peito, nao flutuando na frente.
    # O mapa monocular a joga bem a frente do casaco (e no punho ainda a mistura
    # com a manga), e na orbita ela deslizava e entortava sobre o casaco que
    # esta segurando. Entao a mao herda a superficie do corpo logo atras dela
    # — se move rigida junto com o casaco — mais a espessura da propria mao.
    out["hand"] = out["body"] + HAND_LIFT
    # sem esticar: a escala do mapa (unidades de `d`) e o que da a proporcao
    # entre as camadas; so desloca para comecar em 0
    lo = min(float(np.percentile(z[layers[n][2]], 1)) for n, z in out.items())
    return {n: np.clip(z - lo, 0, 1) for n, z in out.items()}


def save_rgba_crop(path: Path, color: np.ndarray, a: np.ndarray, pad: int = 4) -> dict:
    ys, xs = np.nonzero(a > 1 / 255)
    h, w = a.shape
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, h)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, w)
    rgba = np.dstack([color[y0:y1, x0:x1], a[y0:y1, x0:x1]])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(
        path, quality=94, method=6, exact=True
    )
    return {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}


# --------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", action="store_true", help="grava previas em assets-source/_debug")
    ap.add_argument(
        "--reuse",
        action="store_true",
        help="reaproveita recorte, parsing e profundidade bruta do cache",
    )
    args = ap.parse_args()

    src = find_source()
    print(f"fonte: {src.name}")
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img, dtype=np.float32) / 255.0
    H, W = rgb.shape[:2]

    cache = DEBUG_DIR / "cache.npz"
    c = dict(np.load(cache)) if (args.reuse and cache.exists()) else {}
    if "alpha" not in c:
        print("recorte...")
        c["alpha"] = clean_alpha(matte(img))
    if "raw" not in c:
        print("profundidade...")
        c["raw"] = predict_depth(img)
    if "parse" not in c:
        print("partes do corpo...")
        c["parse"] = parse(img).astype(np.float16)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, alpha=c["alpha"], raw=c["raw"], parse=c["parse"])
    prob = c["parse"].astype(np.float32)

    print("limpeza do recorte...")
    alpha, fringe = clean_background(rgb, c["alpha"].astype(np.float32))
    print("cor de primeiro plano...")
    color = foreground_color(rgb, alpha)
    color = repaint_fringe(color, alpha, fringe, prob[PARSE_KEEP.index(L_HAIR)] > 0.5)
    alpha = normalize_alpha(alpha)

    print("camadas...")
    s_head, s_hand = part_masks(prob, rgb, alpha)
    layers = build_layers(color, alpha, s_head, s_hand)
    z = layer_depth(base_depth(c["raw"], c["alpha"]), layers)

    LAYER_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"width": W, "height": H, "layers": []}
    for name in ("head", "body", "hand"):  # de tras para frente
        lc, la, _ = layers[name]
        box = save_rgba_crop(LAYER_DIR / f"{name}.webp", lc, la)
        manifest["layers"].append({"name": name, **box})
    zr = [cv2.resize(z[n], (round(W * Z_SCALE), round(H * Z_SCALE)), interpolation=cv2.INTER_AREA)
          for n in ("head", "body", "hand")]
    Image.fromarray((np.dstack(zr) * 255 + 0.5).astype(np.uint8), "RGB").save(
        LAYER_DIR / "depth.png", optimize=True
    )
    manifest["depthChannels"] = ["head", "body", "hand"]
    # z que fica parado na orbita: o do rosto, que fica estavel enquanto a
    # mao e o casaco deslizam em volta
    manifest["focus"] = round(float(np.median(z["head"][layers["head"][2]])), 4)
    (LAYER_DIR / "layers.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

    # imagem plana (fallback sem WebGL / reduced motion): o recorte limpo
    Image.fromarray((np.dstack([color, alpha]) * 255 + 0.5).astype(np.uint8), "RGBA").save(
        OUT_DIR / "portrait-color.webp", quality=94, method=6, exact=True
    )
    print("gravado em", LAYER_DIR.relative_to(ROOT))

    for n in ("head", "body", "hand"):
        hard = layers[n][2]
        print(f"  z {n}: mediana {np.median(z[n][hard]):.3f}  p5 {np.percentile(z[n][hard], 5):.3f}"
              f"  p95 {np.percentile(z[n][hard], 95):.3f}")

    if args.debug:
        # composicao das camadas em repouso, sobre o fundo da pagina e magenta
        for tag, bg in (("page", (0.027, 0.027, 0.027)), ("mag", (1.0, 0.0, 1.0))):
            out = np.ones((H, W, 3), np.float32) * np.array(bg, np.float32)
            for n in ("head", "body", "hand"):
                lc, la, _ = layers[n]
                out = lc * la[..., None] + out * (1 - la[..., None])
            Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(DEBUG_DIR / f"layers-{tag}.png")
        flat = color * alpha[..., None] + 0.027 * (1 - alpha[..., None])
        diff = np.abs(np.asarray(Image.open(DEBUG_DIR / "layers-page.png")) / 255.0 - flat).max(-1)
        print(f"  composicao vs recorte: erro p99 {np.percentile(diff, 99):.4f}  max {diff.max():.4f}")
        for n in ("head", "body", "hand"):
            lc, la, _ = layers[n]
            over = lc * la[..., None] + np.array((1.0, 0, 1.0)) * (1 - la[..., None])
            Image.fromarray((over * 255 + 0.5).astype(np.uint8)).resize((W // 2, H // 2)).save(
                DEBUG_DIR / f"layer-{n}.png"
            )
        Image.fromarray((np.dstack(zr) * 255).astype(np.uint8)).save(DEBUG_DIR / "layer-depth.png")
        print("previas em", DEBUG_DIR.relative_to(ROOT))


if __name__ == "__main__":
    main()
