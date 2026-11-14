import os
import re
import subprocess
import sys
import tempfile
import urllib.request

import cv2
import numpy as np

ZH = re.compile(r'[\u4e00-\u9fff]')
KO = re.compile(r'[\uac00-\ud7a3]')
LATIN = re.compile(r'[A-Za-z]')
DIGIT = re.compile(r'\d')
MODEL_URL = 'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt'
OCR_EVERY = 2
BOX_PAD = 16
BOX_WINDOW = 1
LAMA_MARGIN = 112
OCR_TOP = 0.12
OCR_MAX_W = 1280
DILATE = None
FEATHER = 21


def ffmpeg_path():
    return os.path.join(os.environ.get('APPDATA', ''), 'ShoppingLens', 'bin', 'ffmpeg.exe')


def model_path():
    return os.path.join(os.environ.get('APPDATA', ''), 'ShoppingLens', 'models', 'big-lama.pt')


def ensure_model():
    path = model_path()
    if os.path.isfile(path) and os.path.getsize(path) > 50_000_000:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print('model downloading', flush=True)
    urllib.request.urlretrieve(MODEL_URL, path)
    return path


def parse_ocr_item(item):
    if not isinstance(item, (list, tuple)) or len(item) < 2:
        return None, ''
    pts = item[0]
    rest = item[1]
    if isinstance(rest, (list, tuple)):
        text = rest[0] if rest else ''
    else:
        text = rest
    return pts, str(text or '')


def compact_text(text):
    return re.sub(r'\s+', '', str(text or ''))


def is_overlay_text(text):
    chars = compact_text(text)
    if len(chars) < 2:
        return False
    n_zh = len(ZH.findall(chars))
    n_ko = len(KO.findall(chars))
    n_en = len(LATIN.findall(chars))
    n_d = len(DIGIT.findall(chars))
    letters = n_zh + n_ko + n_en
    if letters < 2:
        return False
    if n_d >= 4 and letters <= 2 and n_zh == 0:
        return False
    return True


def keep_box(x1, y1, x2, y2, text, hh, ww):
    chars = compact_text(text)
    n_zh = len(ZH.findall(chars))
    n_ko = len(KO.findall(chars))
    n_en = len(LATIN.findall(chars))
    bw, bh = max(1, x2 - x1), max(1, y2 - y1)
    cy = (y1 + y2) / 2
    cx = (x1 + x2) / 2
    spans = x1 < ww * 0.46 and x2 > ww * 0.54
    cjk = n_zh + n_ko >= 2
    if bw < ww * 0.055 and bh < hh * 0.016:
        return False
    if cy < hh * 0.12 and bw < ww * 0.35 and bh < hh * 0.04:
        return False
    if cjk:
        if bw >= ww * 0.28 and bh >= hh * 0.014:
            return True
        if cy >= hh * 0.52 and n_zh >= 2 and (bw >= ww * 0.07 or bh >= hh * 0.026):
            return True
        if hh * 0.12 <= cy < hh * 0.52 and bw >= ww * 0.12 and bh >= hh * 0.018:
            return True
        return False
    if n_en >= 4 and spans and bw >= ww * 0.28 and bh >= hh * 0.03 and cy >= hh * 0.45:
        return True
    if n_en >= 5 and spans and bw >= ww * 0.3 and bh >= hh * 0.035 and hh * 0.14 <= cy < hh * 0.55:
        return True
    return False


def merge_line_boxes(rows, hh, ww):
    if not rows:
        return rows
    rows = sorted(rows, key=lambda b: (b[1], b[0]))
    groups = []
    for b in rows:
        placed = False
        for g in groups:
            gy1 = min(x[1] for x in g)
            gy2 = max(x[3] for x in g)
            overlap = min(gy2, b[3]) - max(gy1, b[1])
            if overlap > 0.4 * min(b[3] - b[1], gy2 - gy1, bh_safe(b)):
                g.append(b)
                placed = True
                break
        if not placed:
            groups.append([b])
    out = []
    for g in groups:
        x1 = min(b[0] for b in g)
        y1 = min(b[1] for b in g)
        x2 = max(b[2] for b in g)
        y2 = max(b[3] for b in g)
        cy = (y1 + y2) / 2
        pad_x = 12 if cy > hh * 0.18 else 6
        pad_y = max(8, int((y2 - y1) * 0.35))
        x1 -= pad_x
        x2 += pad_x
        y1 -= pad_y
        y2 += pad_y
        text = ' '.join(b[4] for b in g)
        out.append([max(0, x1), max(0, y1), min(ww, x2), min(hh, y2), text])
    return out


def bh_safe(b):
    return max(1, b[3] - b[1])


def ocr_boxes(ocr, frame):
    hh, ww = frame.shape[:2]
    y0 = int(hh * OCR_TOP)
    roi = frame[y0:]
    scale = 1.0
    rh, rw = roi.shape[:2]
    if rw > OCR_MAX_W:
        scale = OCR_MAX_W / rw
        roi = cv2.resize(roi, (int(rw * scale), int(rh * scale)))
    result, _ = ocr(roi)
    raw = []
    for item in result or []:
        pts, text = parse_ocr_item(item)
        if pts is None:
            continue
        xs = [p[0] / scale for p in pts]
        ys = [p[1] / scale + y0 for p in pts]
        x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
        chars = compact_text(text)
        n_zh = len(ZH.findall(chars))
        n_ko = len(KO.findall(chars))
        n_en = len(LATIN.findall(chars))
        if n_zh + n_ko >= 1 or n_en >= 3:
            raw.append([x1, y1, x2, y2, str(text)])
    return [b for b in merge_line_boxes(raw, hh, ww) if keep_box(b[0], b[1], b[2], b[3], b[4], hh, ww)]


def detect_boxes(video_path, every=OCR_EVERY, max_frames=0):
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()
    cap = cv2.VideoCapture(video_path)
    boxes = {}
    last = []
    i = 0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if max_frames:
        total = min(total, max_frames)
    while True:
        if max_frames and i >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break
        if i % every == 0:
            last = ocr_boxes(ocr, frame)
            boxes[i] = last
            if i % (every * 8) == 0:
                print(f'detect {i}/{total or i}', flush=True)
        else:
            boxes[i] = []
        i += 1
    cap.release()
    return boxes, i


def expand_strokes(frame, mask):
    if not mask.any():
        return mask
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (19, 7))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, k)
    extra = ((tophat > 18) | (blackhat > 18)).astype(np.uint8) * 255
    near = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 11)))
    extra = cv2.bitwise_and(extra, near)
    extra = cv2.dilate(extra, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 5)))
    return cv2.bitwise_or(mask, extra)


def build_mask(boxes, i, h, w, frame=None, pad=BOX_PAD, window=BOX_WINDOW):
    mask = np.zeros((h, w), np.uint8)
    for j in range(i - window, i + window + 1):
        for x1, y1, x2, y2, _ in boxes.get(j, []):
            mask[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)] = 255
    if not mask.any():
        return mask
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 7)))
    return mask


def lama_inpaint(model, frame, mask, margin, device):
    ys, xs = np.where(mask > 0)
    if xs.size == 0:
        return frame
    h, w = mask.shape
    x1, x2 = max(0, int(xs.min()) - margin), min(w, int(xs.max()) + margin)
    y1, y2 = max(0, int(ys.min()) - margin), min(h, int(ys.max()) + margin)
    crop = frame[y1:y2, x1:x2]
    mcrop = mask[y1:y2, x1:x2]
    ch, cw = mcrop.shape
    ph, pw = (8 - ch % 8) % 8, (8 - cw % 8) % 8
    import torch
    img = cv2.copyMakeBorder(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), 0, ph, 0, pw, cv2.BORDER_REFLECT)
    msk = cv2.copyMakeBorder(mcrop, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=0)
    img_t = torch.from_numpy(img).permute(2, 0, 1)[None].float().div(255).to(device)
    msk_t = torch.from_numpy((msk > 0).astype(np.float32))[None, None].to(device)
    with torch.no_grad():
        out = model(img_t, msk_t)[0].permute(1, 2, 0).cpu().numpy()
    out = cv2.cvtColor(np.clip(out * 255, 0, 255).astype(np.uint8)[:ch, :cw], cv2.COLOR_RGB2BGR)
    k = FEATHER if FEATHER % 2 else FEATHER + 1
    alpha = cv2.GaussianBlur(mcrop, (k, k), 0).astype(np.float32) / 255.0
    alpha = np.clip(alpha * 1.15, 0, 1)
    region = frame[y1:y2, x1:x2].astype(np.float32)
    blended = out.astype(np.float32) * alpha[..., None] + region * (1 - alpha[..., None])
    result = frame.copy()
    result[y1:y2, x1:x2] = np.clip(blended, 0, 255).astype(np.uint8)
    return result


def band_from_boxes(boxes, hh, ww):
    ys = []
    for rows in boxes.values():
        for x1, y1, x2, y2, _ in rows:
            cy = (y1 + y2) / 2
            if cy >= hh * 0.45:
                ys.extend([y1, y2])
    if not ys:
        return int(hh * 0.78), int(hh * 0.96)
    ya = max(0, int(np.percentile(ys, 8)) - 16)
    yb = min(hh, int(np.percentile(ys, 96)) + 20)
    if yb - ya < int(hh * 0.06):
        mid = int(np.median(ys))
        ya, yb = max(0, mid - int(hh * 0.05)), min(hh, mid + int(hh * 0.07))
    return ya, yb


def wipe_ocr_lama(src, dst, seconds=0):
    import torch
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit('영상을 열지 못했습니다')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    ht = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    max_frames = int(min(count, seconds * fps)) if seconds > 0 and count else 0
    cap.release()

    boxes, n = detect_boxes(src, OCR_EVERY, max_frames)
    n_text = sum(1 for v in boxes.values() if v)
    print(f'detected {n_text}/{n}', flush=True)
    ya, yb = band_from_boxes(boxes, ht, w)
    print(f'band {ya} {yb}', flush=True)
    print(f'ratio {ya / max(ht, 1):.4f} {(yb - ya) / max(ht, 1):.4f}', flush=True)

    ff = ffmpeg_path()
    if n_text == 0:
        subprocess.check_call([ff, '-y', '-i', src, '-an', '-c:v', 'copy', '-movflags', '+faststart', dst], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f'done {n}', flush=True)
        return 0

    model = torch.jit.load(ensure_model(), map_location=device).eval()
    cap = cv2.VideoCapture(src)
    proc = subprocess.Popen(
        [ff, '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{ht}', '-r', f'{fps:.6f}',
         '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    i = 0
    total = max_frames or n or count
    while True:
        if max_frames and i >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break
        mask = build_mask(boxes, i, ht, w, frame)
        if mask.any():
            frame = lama_inpaint(model, frame, mask, LAMA_MARGIN, device)
        proc.stdin.write(frame.tobytes())
        i += 1
        if i % 30 == 0:
            print(f'{i}/{total}', flush=True)
    cap.release()
    proc.stdin.close()
    proc.wait()
    print(f'band {ya} {yb}', flush=True)
    print(f'ratio {ya / max(ht, 1):.4f} {(yb - ya) / max(ht, 1):.4f}', flush=True)
    print(f'done {i}', flush=True)
    return 0 if proc.returncode == 0 else proc.returncode


def zh_overlay(ocr, path):
    img = cv2.imread(path)
    if img is None:
        return False
    for box in ocr_boxes(ocr, img):
        text = box[4] if len(box) > 4 else ''
        if len(ZH.findall(compact_text(text))) >= 2:
            return True
    return False


def probe_ocr(path, image=False):
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()
    if image:
        img = cv2.imread(path)
        if img is None:
            return None
        rows = ocr_boxes(ocr, img)
        if not rows:
            return None
        hh = img.shape[0]
        ya, yb = band_from_boxes({0: rows}, hh, img.shape[1])
        return ya / hh, (yb - ya) / hh
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    ht = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1920)
    ww = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1080)
    all_rows = []
    for i in range(12):
        idx = int((i + 0.5) * max(count - 1, 1) / 12)
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        all_rows.extend(ocr_boxes(ocr, frame))
    cap.release()
    if not all_rows:
        return None
    ya, yb = band_from_boxes({0: all_rows}, ht, ww)
    return ya / max(ht, 1), (yb - ya) / max(ht, 1)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--probe-zh':
        from rapidocr_onnxruntime import RapidOCR
        ocr = RapidOCR()
        for image in sys.argv[2:]:
            try:
                yes = zh_overlay(ocr, image)
            except Exception:
                yes = False
            print('zh yes' if yes else 'zh no', flush=True)
        raise SystemExit(0)
    if len(sys.argv) >= 3 and sys.argv[2] == '--probe-image':
        try:
            r = probe_ocr(sys.argv[1], True)
        except Exception:
            r = None
        print('caption yes' if r else 'caption no', flush=True)
        if r:
            print(f'ratio {r[0]:.4f} {r[1]:.4f}', flush=True)
        raise SystemExit(0)
    if len(sys.argv) >= 3 and sys.argv[2] == '--probe':
        try:
            r = probe_ocr(sys.argv[1], False)
        except Exception:
            r = None
        print('caption yes' if r else 'caption no', flush=True)
        if r:
            print(f'ratio {r[0]:.4f} {r[1]:.4f}', flush=True)
        raise SystemExit(0)

    src, dst = sys.argv[1], sys.argv[2]
    seconds = float(sys.argv[5]) if len(sys.argv) > 5 else 0
    try:
        raise SystemExit(wipe_ocr_lama(src, dst, seconds))
    except SystemExit:
        raise
    except Exception as e:
        sys.stderr.write(f'ocr-lama 실패, 기존 방식으로 전환 · {e}\n')
        raise SystemExit(wipe_fallback(src, dst, seconds))


STROKE = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7))
BAND_CLOSE = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))


def text_mask(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    white = gray > 175
    yellow = (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 50) & (hsv[:, :, 2] >= 130)
    dark = gray < 90
    ring = cv2.dilate(dark.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, STROKE) > 8
    blur = cv2.GaussianBlur(gray, (9, 9), 0)
    contrast = cv2.absdiff(gray, blur) > 22
    raw = (white | yellow) & (ring | tophat | contrast)
    mask = (raw.astype(np.uint8)) * 255
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, BAND_CLOSE)


def cover_band(frame, ya, yb):
    hh, ww = frame.shape[:2]
    ya, yb = int(max(0, ya)), int(min(hh, yb))
    h = yb - ya
    if h < 10:
        return frame
    src = frame[max(0, ya - max(16, min(h, 80))):ya]
    if src.shape[0] < 4:
        src = frame[max(0, ya - 4):max(ya, 1)]
    fill = cv2.GaussianBlur(cv2.resize(src, (ww, h), interpolation=cv2.INTER_LINEAR), (31, 11), 0)
    out = frame.copy()
    out[ya:yb] = fill
    return out


def wipe_fallback(src, dst, seconds=0):
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    ht = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    total = int(count if seconds <= 0 or not count else min(count, seconds * fps))
    ya, yb = int(ht * 0.82), int(ht * 0.985)
    ff = ffmpeg_path()
    proc = subprocess.Popen(
        [ff, '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{ht}', '-r', f'{fps:.6f}',
         '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    done = 0
    while done < total:
        ok, frame = cap.read()
        if not ok:
            break
        proc.stdin.write(cover_band(frame, ya, yb).tobytes())
        done += 1
        if done % 90 == 0:
            print(f'{done}/{total}', flush=True)
    proc.stdin.close()
    proc.wait()
    cap.release()
    print(f'band {ya} {yb}', flush=True)
    print(f'ratio {ya / max(ht, 1):.4f} {(yb - ya) / max(ht, 1):.4f}', flush=True)
    print(f'done {done}', flush=True)
    return 0


if __name__ == '__main__':
    main()
