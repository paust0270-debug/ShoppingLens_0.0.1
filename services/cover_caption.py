import os
import subprocess
import sys

import cv2
import numpy as np

STROKE = cv2.getStructuringElement(cv2.MORPH_RECT, (23, 7))
BLOB = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
BLOCK = cv2.getStructuringElement(cv2.MORPH_RECT, (31, 13))


def row_score(gray):
    wh = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, STROKE)
    bright = gray > 205
    dark = gray < 75
    ring = cv2.dilate(dark.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    hit = bright & ring & (wh > 5)
    score = hit.sum(axis=1).astype(np.float32)
    return np.convolve(score, np.ones(7) / 7, mode='same'), hit, wh


def span_from_score(score, y0, y1, min_score=28):
    band = score[y0:y1]
    if band.size < 8 or band.max() < min_score:
        return None
    i = int(band.argmax())
    a = i
    b = i
    cut = max(min_score * 0.35, band.max() * 0.2)
    while a > 0 and band[a] > cut:
        a -= 1
    while b < len(band) - 1 and band[b] > cut:
        b += 1
    a = max(0, a - 6)
    b = min(len(band), b + 8)
    if b - a < 20:
        a = max(0, i - 28)
        b = min(len(band), i + 32)
    if b - a > 140:
        a = max(0, i - 36)
        b = min(len(band), i + 40)
    return y0 + a, y0 + b, float(band[i])


def text_box(gray, hit, top, bot):
    hh, ww = gray.shape
    top = max(0, top)
    bot = min(hh, bot)
    if bot - top < 12:
        return None
    sl = hit[top:bot]
    cols = sl.sum(axis=0) > 2
    if cols.sum() < 40:
        return None
    xs = np.where(cols)[0]
    x0 = max(0, int(xs.min()) - 6)
    x1 = min(ww, int(xs.max()) + 6)
    if x1 - x0 < 80:
        return None
    mid = (x0 + x1) / 2 / ww
    if mid < 0.18 or mid > 0.82:
        return None
    rows = sl[:, x0:x1].sum(axis=1)
    if rows.max() < 8:
        return None
    ys = np.where(rows > max(4, rows.max() * 0.12))[0]
    ya = top + int(ys.min()) - 8
    yb = top + int(ys.max()) + 8
    return max(0, ya), min(hh, yb), x0, x1


def find_caption(gray, lock=None):
    hh, ww = gray.shape
    score, hit, _ = row_score(gray)
    if lock:
        ly0, ly1 = lock
        pad = 70
        found = span_from_score(score, max(int(hh * 0.08), ly0 - pad), min(int(hh * 0.94), ly1 + pad), 16)
        if found and abs(((found[0] + found[1]) / 2) - ((ly0 + ly1) / 2)) > 80:
            found = (ly0, ly1, 1)
    else:
        found = span_from_score(score, int(hh * 0.12), int(hh * 0.90), 32)
    if not found:
        return None
    top, bot, _ = found
    box = text_box(gray, hit, top, bot)
    return box


def sample_strip(frame, y, h, x0, x1):
    hh = frame.shape[0]
    y = int(np.clip(y, 0, max(0, hh - h)))
    return frame[y:y + h, x0:x1].astype(np.float32)


def neighbor_fill(frame, ya, yb, x0, x1):
    hh, ww = frame.shape[:2]
    h = yb - ya
    w = x1 - x0
    above_n = min(3, ya)
    below_n = min(3, hh - yb)
    above = frame[ya - above_n:ya, x0:x1].astype(np.float32) if above_n >= 2 else None
    below = frame[yb:yb + below_n, x0:x1].astype(np.float32) if below_n >= 2 else None
    if above is None and below is None:
        return None
    src = above if above is not None else below
    row = np.median(src, axis=0, keepdims=True)
    k = min(41, (w // 2) * 2 + 1)
    if k >= 5:
        row = cv2.GaussianBlur(row, (k, 1), 0)
    return np.repeat(row, h, axis=0)


def wipe_box(frame, box):
    ya, yb, x0, x1 = [int(v) for v in box]
    hh, ww = frame.shape[:2]
    ya = max(0, ya - 3)
    yb = min(hh, yb + 3)
    x0 = max(0, x0 - 3)
    x1 = min(ww, x1 + 3)
    h = yb - ya
    if h < 12 or x1 - x0 < 40:
        return frame
    donor = neighbor_fill(frame, ya, yb, x0, x1)
    if donor is None:
        return frame
    out = frame.copy()
    out[ya:yb, x0:x1] = np.clip(donor, 0, 255).astype(np.uint8)
    return out


def lock_band(path, hint=None, samples=14):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    votes = []
    for i in range(samples):
        idx = int((i + 0.5) * max(count - 1, 1) / samples)
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        box = find_caption(gray, hint)
        if box:
            votes.append(box)
    cap.release()
    if len(votes) < 2:
        return votes[0] if votes else None
    cy = np.array([(a + b) / 2 for a, b, _, _ in votes])
    med = float(np.median(cy))
    keep = [v for v, c in zip(votes, cy) if abs(c - med) < 70]
    if not keep:
        keep = votes
    ya = int(np.median([v[0] for v in keep]))
    yb = int(np.median([v[1] for v in keep]))
    x0 = int(np.median([v[2] for v in keep]))
    x1 = int(np.median([v[3] for v in keep]))
    return ya, yb, x0, x1


def main():
    if len(sys.argv) >= 3 and sys.argv[2] == '--probe-image':
        img = cv2.imread(sys.argv[1])
        if img is None:
            print('caption no', flush=True)
            raise SystemExit(0)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        box = find_caption(gray)
        print('caption yes' if box else 'caption no', flush=True)
        raise SystemExit(0)
    if len(sys.argv) >= 3 and sys.argv[2] == '--probe':
        lock = lock_band(sys.argv[1])
        print('caption yes' if lock else 'caption no', flush=True)
        if lock:
            print(f'band {lock[0]} {lock[1]}', flush=True)
        raise SystemExit(0)
    src, dst = sys.argv[1], sys.argv[2]
    hint = None
    if len(sys.argv) > 4:
        try:
            hy, hhgt = int(sys.argv[3]), int(sys.argv[4])
            if hhgt > 8:
                hint = (max(0, hy), hy + hhgt)
        except ValueError:
            hint = None
    seconds = float(sys.argv[5]) if len(sys.argv) > 5 else 0
    lock = lock_band(src, hint)
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit('영상을 열지 못했습니다')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    ht = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    total = int(count if seconds <= 0 or not count else min(count, seconds * fps))
    ff = os.path.join(os.environ['APPDATA'], 'ShoppingLens', 'bin', 'ffmpeg.exe')
    proc = subprocess.Popen(
        [ff, '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{ht}', '-r', f'{fps:.6f}',
         '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    last = lock
    done = 0
    while done < total:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        box = find_caption(gray, lock[:2] if lock else None)
        if box is None and lock:
            score, hit, _ = row_score(gray)
            if score[lock[0]:lock[1]].max() >= 16:
                box = lock
        if box is not None:
            last = box
            frame = wipe_box(frame, box)
        proc.stdin.write(frame.tobytes())
        done += 1
        if done % 90 == 0:
            print(f'{done}/{total}', flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode('utf-8', 'ignore')
    code = proc.wait()
    cap.release()
    if code:
        sys.stderr.write(err[-500:])
    if last:
        print(f'band {last[0]} {last[1]}', flush=True)
    print(f'done {done}', flush=True)
    raise SystemExit(code)


if __name__ == '__main__':
    main()
