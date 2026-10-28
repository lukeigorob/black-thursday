# An original thrash track for the trailer, made from scratch (no samples): drop-D palm-muted chugs and power
# chords on two distorted guitars hard left and right, bass, double kick, snare on the backbeat, a crash on
# every cut, a ringing last chord under the title. python metal.py <out.wav> <cuts, comma separated> <total s>
import sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
out_path, cuts, total = sys.argv[1], [float(c) for c in sys.argv[2].split(',')], float(sys.argv[3])
N = int(total * SR) + 2 * SR
GL, GR, BUS = np.zeros(N), np.zeros(N), np.zeros(N)  # guitars left/right (distorted later), bass + drums (mono, panned at the end)
DL, DR = np.zeros(N), np.zeros(N)
rng = np.random.default_rng(1014)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda n: np.arange(n) / SR
def filt(x, kind, f, order=2): return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)
def add(buf, x, at, g=1.0):
    i = int(at * SR)
    if i >= N: return
    x = x[: N - i]; buf[i:i + len(x)] += x * g

BPM = 200; q = 60 / BPM; s16 = q / 4
# the riff, a bar of sixteenths: '0' a palm-muted chug on the low D, a number = a power chord that many
# semitones up (held for the dashes after it), '.' rest. One riff per shot, harder as it goes.
RIFFS = [  # thrash: '0' a palm-muted chug, a hex digit a power chord that many semitones up, a lowercase
           # letter one tremolo-picked note (a = D, b = Eb, ...), '-' held, '.' a rest
    '0.000.000.005-3-',  # gallops
    '0.000.000.006-5-',
    'aaaaddddffffhhhh',  # a tremolo climb
    '00000000003-5-6-',
    'hhhhffffddddbbbb',  # and down
    '0.000.000.008-7-',
    'aaaabbbbaaaagggg',
    '0000000000000000',
]
CHORD_AT_CUT = [0, 5, 3, 7, 10, 5, 8, 12]  # the big chord struck as each shot comes in (semitones over D)

def guitar_note(semi, dur, muted, detune):
    n = int((dur + (0.03 if muted else 0.25)) * SR); t = tt(n)
    f = hz(38 + semi)  # D2
    y = np.zeros(n)
    for m, a in ((1, 1.0), (1.5, 0.7), (2, 0.5)) if not muted else ((1, 1.0), (1.5, 0.35)):  # root, fifth, octave
        ph = 2 * np.pi * f * m * (1 + detune) * t
        y += a * (2 * ((ph / (2 * np.pi)) % 1) - 1)
    if muted:
        e = np.exp(-t * 28); y = filt(y, 'low', 900) * e
    else:
        e = np.minimum(1, t / 0.004) * (0.75 + 0.25 * np.exp(-t * 3)); rel = int(0.08 * SR); e[-rel:] *= np.linspace(1, 0, rel)
        y = y * e
    return y

def tremolo_note(semi, dur):
    n = int((dur + 0.02) * SR); t = tt(n); ph = 2 * np.pi * hz(38 + semi) * t
    y = (2 * ((ph / (2 * np.pi)) % 1) - 1) + 0.5 * (2 * ((2 * ph / (2 * np.pi)) % 1) - 1)
    return filt(y, 'low', 2400) * np.exp(-t * 12) * np.minimum(1, t / 0.002)

starts = [0.0] + cuts
end_card = cuts[-1]
# ---- the guitars and the bass, bar by bar through each shot
for k in range(len(cuts)):
    a, b = starts[k], starts[k + 1]
    riff = RIFFS[k % len(RIFFS)]
    # the shot opens on a big chord (two beats), then the riff
    big = CHORD_AT_CUT[k]
    for buf, dt_ in ((GL, 0.0), (GR, 0.011)):
        add(buf, guitar_note(big, 2 * q, False, 0.002 if buf is GL else -0.002), a + dt_)
    add(BUS, filt(guitar_note(big - 12, 2 * q, False, 0) * 0.8, 'low', 300), a, 0.9)
    t = a + 2 * q
    while t < b - s16 * 0.5:
        for i, ch in enumerate(riff):
            at = t + i * s16
            if at >= b - 0.01: break
            if ch in '.-': continue
            held = 1
            while i + held < len(riff) and riff[i + held] == '-': held += 1
            dur = min(held * s16, b - at)
            muted = ch == '0'
            trem = ch.islower() and ch > 'f' or ch in 'abcdef' and riff.count(ch) > 3
            semi = (ord(ch) - 97 + 12) if trem else 0 if muted else int(ch, 16)
            for buf, dt_ in ((GL, 0.0), (GR, 0.009)):
                add(buf, tremolo_note(semi, dur) if trem else guitar_note(semi, dur, muted, 0.0015 if buf is GL else -0.0015), at + dt_, 0.8 if trem else 1.0 if not muted or i % 4 else 1.15)
            add(BUS, filt(guitar_note((semi - 24 if trem else semi - 12), dur, muted or trem, 0), 'low', 250), at, 0.8)
        t += 16 * s16

# the end card: one last D chord rung out, the bass under it
for buf, dt_ in ((GL, 0.0), (GR, 0.012)):
    add(buf, guitar_note(0, total - end_card, False, 0.002 if buf is GL else -0.002), end_card + dt_, 1.1)
add(BUS, filt(guitar_note(-12, total - end_card, False, 0), 'low', 250), end_card, 0.9)

# the amp: a lot of gain, then a 4x12 cabinet (no fizz above 5 kHz, a bite at 2.5 kHz, a bump at 120 Hz)
def amp(x):
    x = filt(x, 'high', 90)
    x = np.tanh(x * 22) ; x = np.tanh(filt(x, 'high', 200) * 3)
    x = filt(x, 'low', 5200, 4)
    bite = filt(x, 'band', [1800, 3400]); low = filt(x, 'band', [90, 180])
    return x * 0.8 + bite * 0.5 + low * 0.6
GL, GR = amp(GL), amp(GR)
BUS = np.tanh(BUS * 1.5) * 0.9

# ---- the drums
def kick():
    n = int(0.35 * SR); t = tt(n); f = 48 + 110 * np.exp(-t * 45)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) + filt(rng.standard_normal(n), 'high', 2000) * np.exp(-t * 300) * 0.5
def snare():
    n = int(0.3 * SR); t = tt(n)
    return np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.7 + filt(rng.standard_normal(n), 'band', [1200, 7000]) * np.exp(-t * 16)
def crash(d=1.8):
    n = int(d * SR); t = tt(n); return filt(rng.standard_normal(n), 'high', 4000) * np.exp(-t * 2.4) * 0.6
def hat():
    n = int(0.06 * SR); t = tt(n); return filt(rng.standard_normal(n), 'high', 7000) * np.exp(-t * 70) * 0.35
K, S, C, H = kick(), snare(), crash(), hat()
for k in range(len(cuts)):
    a, b = starts[k], starts[k + 1]
    add(DL, C, a, 0.9); add(DR, C, a + 0.004, 0.9)  # the crash on the cut
    add(DL, K, a, 1.0); add(DR, K, a, 1.0)
    t = a + 2 * q; beat = 0
    while t < b - 0.02:
        if k < 2:
            add(DL, K, t, 0.9); add(DR, K, t, 0.9)
            if t + 2 * s16 < b: add(DL, S, t + 2 * s16, 0.8); add(DR, S, t + 2 * s16 + 0.002, 0.8)
        else:
            for j in range(4):
                if t + j * s16 < b: add(DL, K, t + j * s16, 0.75); add(DR, K, t + j * s16, 0.75)
            if k >= 6:
                if t + 2 * s16 < b: add(DL, S, t + 2 * s16, 0.75); add(DR, S, t + 2 * s16, 0.75)
            elif beat % 2 == 1: add(DL, S, t, 0.85); add(DR, S, t + 0.002, 0.85)
        for j in range(0, 4, 2): add(DR, H, t + j * s16, 0.8)
        if b - t <= q + 0.01:
            for j in range(4):
                if t + j * s16 < b: add(DL, S, t + j * s16, 0.5 + 0.12 * j); add(DR, S, t + j * s16, 0.5 + 0.12 * j)
        t += q; beat += 1
# the end card: one huge hit
for buf in (DL, DR): add(buf, K, end_card, 1.2); add(buf, crash(3.0), end_card, 1.0)

# ---- a little room on the drums, then the mix
ir = rng.standard_normal(int(0.8 * SR)) * np.exp(-tt(int(0.8 * SR)) * 7); ir = filt(ir, 'low', 7000); ir /= np.sqrt(np.sum(ir ** 2))
DL = DL + fftconvolve(DL, ir)[:N] * 0.18; DR = DR + fftconvolve(DR, ir)[:N] * 0.18
L = GL * 0.55 + GR * 0.12 + BUS * 0.6 + DL * 0.75
R = GR * 0.55 + GL * 0.12 + BUS * 0.6 + DR * 0.75
end = int(total * SR); fade = int(1.2 * SR)
for ch in (L, R): ch[end - fade:end] *= np.linspace(1, 0, fade) ** 1.5
mix = np.stack([L, R], 1)[:end]
mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.6) / np.tanh(1.6) * 0.89  # (a limiter: loud, as metal is)
with wave.open(out_path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('thrash', out_path, f'{end / SR:.2f} s')
