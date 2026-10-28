# A ~10 s calm sample of every Kokoro male English voice, for Chatterbox to copy.
# python refs_all.py <out folder>
import os, sys, numpy as np, soundfile as sf
from kokoro import KPipeline

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
TEXT = ("Pilot to crew, we're crossing the coast now. Keep your eyes open and call out anything you see. "
        "Check your oxygen every few minutes, and stay off the interphone unless it matters.")
VOICES = {'a': ['am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
                'am_puck,am_echo', 'am_fenrir,am_eric', 'am_michael,am_onyx'],
          'b': ['bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis']}
for lang, voices in VOICES.items():
    pipe = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M')
    for v in voices:
        audio = [r.audio.numpy() for r in pipe(TEXT, voice=v) if r.audio is not None]
        name = v.replace(',', '+')
        sf.write(os.path.join(out, name + '.wav'), np.concatenate(audio), 24000, subtype='PCM_16')
        print(name, flush=True)
