# An original score for the trailer, made from scratch (no samples): D minor, low strings, a driving
# string pulse, war drums on every cut, a riser into the end card and one big hit under the title.
# python score.py <out.wav> <cut times in seconds, comma separated> <total seconds>
import sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
out_path, cuts, total = sys.argv[1], [float(c) for c in sys.argv[2].split(',')], float(sys.argv[3])
N = int(total * SR) + SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(1943)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda n: np.arange(n) / SR

def lp(x, f, order=2): return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b): return sosfilt(butter(2, [a, b], 'band', fs=SR, output='sos'), x)

def put(x, at, pan=0.0, gain=1.0):
    i = int(at * SR); x = x[: max(0, N - i)] * gain
    L[i:i + len(x)] += x * np.sqrt((1 - pan) / 2); R[i:i + len(x)] += x * np.sqrt((1 + pan) / 2)

def saw(f, n, detune=(0.0,), vib=0.0):
    t = tt(n); y = np.zeros(n)
    for d in detune:
        ph = 2 * np.pi * f * (1 + d) * t + vib * np.sin(2 * np.pi * 5.1 * t + rng.random() * 6)
        y += 2 * ((ph / (2 * np.pi)) % 1) - 1
    return y / len(detune)

def env(n, a, r):
    e = np.ones(n); A, Rl = int(a * SR), int(r * SR)
    if A: e[:A] = np.linspace(0, 1, A) ** 1.5
    if Rl: e[-Rl:] *= np.linspace(1, 0, Rl) ** 2
    return e

# ---- the harmony: one chord a shot, darkening, a turn to A (the dominant) before the end, home on D minor
#      (MIDI notes: a low root, and the chord's voices)
CHORDS = [(38, [50, 53, 57]), (38, [50, 53, 57]), (34, [46, 50, 53]), (34, [46, 50, 53]), (41, [48, 53, 57]),
          (36, [48, 52, 55]), (31, [46, 50, 55]), (33, [49, 52, 57]), (38, [50, 53, 57, 62])]
starts = [0.0] + cuts
for k, (root, voices) in enumerate(CHORDS):
    a = starts[k]; b = starts[k + 1] if k + 1 < len(starts) else total
    n = int((b - a + 0.6) * SR)
    rise = 0.35 + 0.65 * k / (len(CHORDS) - 1)
    last = k == len(CHORDS) - 1
    # the low strings: the root an octave apart, slow bow
    bass = saw(hz(root), n, (-0.003, 0.0, 0.004), 0.002) * 0.6 + saw(hz(root - 12), n, (0.0, 0.002)) * 0.5
    bass = lp(bass, 500) * env(n, 0.08 if k else 1.2, 0.5)
    put(bass, a, 0.0, 0.22 * (1.3 if last else 1))
    # the string chord: detuned saws, soft attack, spread across the field
    for j, v in enumerate(voices):
        s = lp(saw(hz(v), n, (-0.004, 0.0, 0.005), 0.003), 1800 + 1500 * rise) * env(n, 0.25 if k else 1.5, 0.5)
        put(s, a, (-0.6, 0.6, 0.0, -0.3)[j % 4], 0.07 * (0.5 + rise) * (1.6 if last else 1))
    # a high string line over the last shots: the fifth, then the root above it
    if k >= 5:
        hi = voices[-1] + 12
        s = lp(saw(hz(hi), n, (-0.002, 0.003), 0.004), 3500) * env(n, 0.4, 0.5)
        put(s, a, 0.3, 0.05 * (1.5 if last else 1))

# ---- the pulse: low strings in eighths at 126 bpm, from the second shot to the end card, building
BPM = 126; e8 = 60 / BPM / 2
t0 = cuts[0]; t1 = cuts[-1]
k = 0; t = t0
while t < t1 - 0.05:
    seg = max(i for i, s in enumerate(starts) if s <= t)
    root = CHORDS[seg][0] + 12
    n = int(0.16 * SR)
    note = lp(saw(hz(root), n, (-0.003, 0.004)), 900) * np.exp(-tt(n) * 22) * (1.0 if k % 2 == 0 else 0.7)
    put(note, t, -0.2 if k % 2 else 0.2, 0.16 * (0.5 + 0.6 * (t - t0) / (t1 - t0)))
    t += e8; k += 1

# ---- the drums: a war drum (a big low membrane) on every cut, a small one driving the second half
def drum(f0, f1, dur, noise=0.25):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * 18)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4.0 / dur))
    hit = lp(rng.standard_normal(n), 1200) * np.exp(-t * 40) * noise
    return np.tanh((body + hit) * 1.6)

for i, c in enumerate(cuts[:-1]):
    put(drum(110, 48, 1.4), c - 0.01, 0.0, 0.5)
    put(drum(160, 70, 0.6), c + e8, 0.15, 0.22)
# the snare-ish frame drum in the back half, on the off-beats
t = cuts[3]
k = 0
while t < t1 - 0.2:
    if k % 4 == 2:
        n = int(0.25 * SR)
        sn = bp(rng.standard_normal(n), 300, 2800) * np.exp(-tt(n) * 18)
        put(sn, t, -0.25, 0.09)
    if k % 4 == 0:
        put(drum(90, 55, 0.7, 0.15), t, 0.0, 0.18)
    t += e8; k += 1

# ---- the riser into the end card: noise swept up, the strings tremolo, then silence for a beat
rs = 2.6; n = int(rs * SR); t = tt(n)
sweep = rng.standard_normal(n)
out = np.zeros(n)
for j in range(0, n, 2400):  # (a stepped band-pass, rising)
    f = 300 * (12 ** (j / n))
    seg = sweep[j:j + 2400]
    out[j:j + len(seg)] = bp(seg, f * 0.7, min(f * 1.4, 20000))
put(out * (t / rs) ** 2.2, t1 - rs, 0.0, 0.25)
trem = saw(hz(57), n, (-0.004, 0.005)) * (0.6 + 0.4 * np.sin(2 * np.pi * 14 * t)) * (t / rs) ** 1.5
put(lp(trem, 3000), t1 - rs, 0.4, 0.06)

# ---- the end card: one huge hit (drum, low brass-like stab, a crash of noise), ringing under the title
put(drum(80, 38, 3.2, 0.5), t1, 0.0, 0.9)
n = int(3.5 * SR)
stab = lp(saw(hz(38), n, (-0.006, 0.0, 0.007)) + saw(hz(45), n, (-0.005, 0.006)) * 0.7 + saw(hz(50), n, (0.004, -0.004)) * 0.6, 1400)
put(stab * np.exp(-tt(n) * 0.9), t1, 0.0, 0.2)
crash = hp(rng.standard_normal(int(2.5 * SR)), 3000) * np.exp(-tt(int(2.5 * SR)) * 2.2)
put(crash, t1, 0.0, 0.08)

# ---- a hall: convolved with a decaying noise burst (wider in the right channel), mixed in
ir_n = int(2.4 * SR); irt = tt(ir_n)
irL = rng.standard_normal(ir_n) * np.exp(-irt * 2.8); irR = rng.standard_normal(ir_n) * np.exp(-irt * 2.6)
irL = lp(irL, 6000); irR = lp(irR, 6000)
wetL = fftconvolve(L, irL)[:N] / np.sqrt(np.sum(irL ** 2)) * 0.32
wetR = fftconvolve(R, irR)[:N] / np.sqrt(np.sum(irR ** 2)) * 0.32
L, R = L + wetL, R + wetR
# the very end faded
fade = int(0.8 * SR); end = int(total * SR)
for ch in (L, R): ch[end - fade:end] *= np.linspace(1, 0, fade) ** 2; ch[end:] = 0
mix = np.stack([L, R], 1)[:end]
mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.4) / np.tanh(1.4) * 0.89
import wave
with wave.open(out_path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('score', out_path, f'{end / SR:.2f} s')
