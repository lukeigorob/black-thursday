# Records the crew's lines with Chatterbox (Resemble AI's open speech model, MIT): each man's voice copied
# from a short sample of it (.voices/ref-all/<voice>.wav), with as much feeling as he's set to give.
# Each line three times, then the best take kept: Whisper (OpenAI's open speech recogniser) listens to
# each, and the one that says the words right (none dropped, garbled or added), at the most natural
# pace of those, becomes <folder>/<id>.wav. Needs a graphics card (CUDA) to be quick.
# Run by make-voices.mjs:  python speak_chatterbox.py <jobs.json> <folder>
# Clips already in the folder are kept: delete a WAV to record it again.
import json, os, re, sys, time
import numpy as np
import soundfile as sf
import torch

TAKES = int(os.environ.get('TAKES', 3))  # (more for a line none of whose takes came out right: TAKES=6)
jobs_file, out = sys.argv[1], sys.argv[2]
takes_dir = os.path.join(out, 'takes')
os.makedirs(takes_dir, exist_ok=True)
jobs = [j for j in json.load(open(jobs_file, encoding='utf-8')) if not os.path.exists(os.path.join(out, j['id'] + '.wav'))]
take = lambda j, k: os.path.join(takes_dir, f"{j['id']}.{k}.wav")
dev = 'cuda' if torch.cuda.is_available() else 'cpu'

# 1. the takes
todo = [j for j in jobs if not all(os.path.exists(take(j, k)) for k in range(TAKES))]
if todo:
    from chatterbox.tts import ChatterboxTTS
    model = ChatterboxTTS.from_pretrained(device=dev)
    todo.sort(key=lambda j: (j['ref'], j['exaggeration']))  # (one man at a time: his voice taken from the sample once for each way he talks)
    ref, t0 = None, time.time()
    for n, j in enumerate(todo):
        if (j['ref'], j['exaggeration']) != ref:
            ref = (j['ref'], j['exaggeration'])
            model.prepare_conditionals(j['ref'], exaggeration=j['exaggeration'])
        for k in range(TAKES):
            if os.path.exists(take(j, k)): continue
            wav = model.generate(j['text'], exaggeration=j['exaggeration'], cfg_weight=j['cfg'])
            sf.write(take(j, k), wav.squeeze(0).cpu().numpy(), model.sr, subtype='PCM_16')
        if n % 10 == 0: print(f'{n}/{len(todo)} lines, {time.time() - t0:.0f}s', flush=True)
    del model
    torch.cuda.empty_cache()

# 2. the best of each
if jobs:
    from transformers import pipeline
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device=0 if dev == 'cuda' else -1)
    NUMS = {w: str(i) for i, w in enumerate('zero one two three four five six seven eight nine ten eleven twelve'.split())} | {'twenty': '20'}
    # (what Whisper spells its own way, not a fault in the take: "hi" for high, "shoots" for chutes)
    SAME = NUMS | {'hi': 'high', 'flack': 'flak', 'flaks': 'flak', 'flacks': 'flak', 'shoots': 'chutes', 'them': 'em', 'him': 'em', 'for': 'fort', 'floor': 'fort', 'courts': 'forts'}
    def norm(s):
        s = s.lower().replace('kilometres', 'kilometers').replace('-', ' ').replace("'", '')
        s = re.sub(r'\b(there are|theyre)\b', 'theres', s)
        return [SAME.get(w, w) for w in re.sub(r"[^a-z0-9 ]", '', s).split()]
    def wer(a, b):  # word edit distance / words wanted
        d = list(range(len(b) + 1))
        for i, x in enumerate(a, 1):
            p, d[0] = d[0], i
            for k, y in enumerate(b, 1):
                p, d[k] = d[k], min(d[k] + 1, d[k - 1] + 1, p + (x != y))
        return d[len(b)] / max(1, len(b))
    report = {}
    for j in jobs:
        scored = []
        for k in range(TAKES):
            a, sr = sf.read(take(j, k), dtype='float32')
            heard = asr({'raw': a, 'sampling_rate': sr})['text']
            scored.append({'k': k, 'wer': wer(norm(heard), norm(j['text'])), 'dur': len(a) / sr, 'heard': heard.strip()})
        best = min(s['wer'] for s in scored)
        ok = [s for s in scored if s['wer'] <= best + 1e-6]
        mid = float(np.median([s['dur'] for s in scored]))
        pick = min(ok, key=lambda s: abs(s['dur'] - mid))  # (of the right ones, the one not rushed or dragged)
        a, sr = sf.read(take(j, pick['k']), dtype='int16')
        sf.write(os.path.join(out, j['id'] + '.wav'), a, sr, subtype='PCM_16')
        report[j['id']] = {'text': j['text'], 'pick': pick['k'], 'takes': scored}
    path = os.path.join(out, 'picks.json')
    old = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    json.dump(old | report, open(path, 'w', encoding='utf-8'), indent=1)
print(f'recorded {len(jobs)} clips')
