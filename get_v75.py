
import hashlib, json, subprocess, wave, struct

sampleText = 'Xin chào, đây là giọng đọc thử nghiệm với tốc độ và cao độ tùy chỉnh.'
h = hashlib.sha256(('capcut_tts:BV075_streaming:1:' + sampleText).encode('utf-8')).hexdigest()
with open(f'.cache/tts/{h}.json') as fjson:
    data = json.load(fjson)

import base64
with open('/tmp/cached_bv075.mp3', 'wb') as fmp3:
    fmp3.write(base64.b64decode(data['audioBase64']))

subprocess.run(['ffmpeg', '-y', '-i', '/tmp/cached_bv075.mp3', '-ar', '16000', '-ac', '1', '/tmp/cached_bv075.wav'], capture_output=True)
with wave.open('/tmp/cached_bv075.wav', 'r') as w:
    frames = w.readframes(w.getnframes())
    samples = struct.unpack(f'{len(frames)//2}h', frames)
    sample_rate = 16000
    chunk = samples[16000:17024]
    corrs = [sum(chunk[i]*chunk[i+lag] for i in range(len(chunk)-lag)) for lag in range(40, 200)]
    max_lag = 40 + corrs.index(max(corrs))
    pitch = sample_rate / max_lag
    print(f'Estimated pitch of cached BV075: {pitch:.1f} Hz')
