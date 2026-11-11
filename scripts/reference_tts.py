import os
import json
import math
import numpy as np
import onnxruntime as ort
import soundfile as sf
from tokenizers import Tokenizer

def run_reference_tts(
    text: str = "Xin chào, đây là giọng đọc thử nghiệm tiếng Việt offline bằng mô hình VieNeu-TTS v3 Turbo.",
    voice_name: str = "Minh Đức",
    output_path: str = "out.wav",
    temperature: float = 0.8,
    top_k: int = 25,
    top_p: float = 0.95,
    rep_penalty: float = 1.2,
    rep_window: int = 64,
    max_frames: int = 250
):
    print(f"=== VieNeu-TTS v3 Turbo Reference Pipeline ===")
    print(f"Text: {text}")
    print(f"Voice: {voice_name}")
    print(f"Output: {output_path}")

    model_dir = "models"
    cfg = json.loads(open(os.path.join(model_dir, "config.json"), encoding="utf-8").read())
    voices = json.loads(open(os.path.join(model_dir, "voices_v3_turbo.json"), encoding="utf-8").read())
    g2p_dict = json.loads(open(os.path.join(model_dir, "vieneu_vi_g2p.json"), encoding="utf-8").read())
    tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
    heads = np.load(os.path.join(model_dir, "vieneu_v3_heads.npz"))

    # Config parameters
    n_vq = int(cfg["n_vq"])
    hidden = int(cfg["hidden_size"])
    L = int(cfg["num_hidden_layers"]) # 12
    L_loc = int(cfg.get("local_num_hidden_layers", 1)) # 1
    nH_loc = int(cfg.get("local_num_attention_heads", 8)) # 8
    hd_loc = hidden // nH_loc # 96
    audio_pad = int(cfg["audio_pad_token_id"]) # 1024
    tps = int(cfg["text_prompt_start_token_id"]) # 3
    tpe = int(cfg["text_prompt_end_token_id"]) # 4
    sgs = int(cfg["speech_generation_start_token_id"]) # 5
    eos_speech = int(cfg["speech_generation_end_token_id"]) # 6
    ref_slot = int(cfg["audio_ref_slot_token_id"]) # 7
    default_style_id = int(cfg.get("default_style_token_id", 16)) # 16

    # Weights
    text_emb = heads["text_emb"].astype(np.float32)
    audio_emb = heads["audio_emb"].astype(np.float32)
    xvec_w = heads["xvec_w"].astype(np.float32)
    xvec_b = heads["xvec_b"].astype(np.float32)
    xvec_ln_w = heads["xvec_ln_w"].astype(np.float32)
    xvec_ln_b = heads["xvec_ln_b"].astype(np.float32)
    xvec_ln_eps = float(heads["xvec_ln_eps"])

    # Voice preset
    preset = voices["presets"][voice_name]
    speaker_emb = np.array(preset["speaker_emb"], dtype=np.float32)
    ref_codes = np.array(preset["codes"], dtype=np.int64)
    print(f"Loaded voice: '{voice_name}' with {ref_codes.shape[0]} ref frames")

    # Step 1: Text normalization & phonemization
    # Simple word-level G2P with punctuation preservation
    words = []
    import re
    tokens_raw = re.findall(r"[\w']+|[.,!?;:]", text.lower())
    for t in tokens_raw:
        if t in [".", ",", "!", "?", ";", ":"]:
            words.append(t)
        else:
            ipa = g2p_dict.get(t)
            if ipa:
                words.append(ipa)
            else:
                words.append(t)
    phonemes = " ".join(words)
    if not phonemes.endswith((".", "!", "?")):
        phonemes += " ."
    print(f"Phonemes: {phonemes[:80]}...")

    # Step 2: BPE tokenize
    phone_ids = tok.encode(phonemes, add_special_tokens=False).ids
    text_ids = [default_style_id, tps] + list(phone_ids) + [tpe]
    T_text = len(text_ids)
    print(f"Token IDs count: {T_text} (sample: {text_ids[:10]})")

    # Step 3: Speaker anchor (LayerNorm(Linear(speaker_emb)))
    v = speaker_emb @ xvec_w.T + xvec_b
    mean = v.mean()
    var = ((v - mean)**2).mean()
    anchor = ((v - mean) / np.sqrt(var + xvec_ln_eps)) * xvec_ln_w + xvec_ln_b
    anchor = anchor.astype(np.float32)

    # Step 4: Build prompt rows (text rows + reference audio rows)
    rows = np.full((T_text + ref_codes.shape[0], n_vq + 1), audio_pad, dtype=np.int64)
    rows[:T_text, 0] = text_ids
    rows[T_text:, 0] = ref_slot
    rows[T_text:, 1:] = ref_codes

    # Embed rows
    T_prompt = rows.shape[0]
    prompt_embeds = text_emb[rows[:, 0]]
    for ch in range(n_vq):
        ch_ids = rows[:, ch + 1]
        valid = ch_ids != audio_pad
        safe = np.where(valid, ch_ids, 0)
        prompt_embeds = prompt_embeds + audio_emb[ch][safe] * valid[:, None]
    prompt_embeds = (prompt_embeds + anchor[None])[None].astype(np.float32) # (1, T_prompt, 768)
    print(f"Prompt embeds shape: {prompt_embeds.shape}")

    # Load ONNX sessions
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = min(os.cpu_count() or 4, 4)

    print("Loading ONNX models...")
    sess_pre = ort.InferenceSession(os.path.join(model_dir, "vieneu_prefill.onnx"), so, providers=["CPUExecutionProvider"])
    sess_dec = ort.InferenceSession(os.path.join(model_dir, "vieneu_decode_step.onnx"), so, providers=["CPUExecutionProvider"])
    sess_ac = ort.InferenceSession(os.path.join(model_dir, "vieneu_acoustic_cached.onnx"), so, providers=["CPUExecutionProvider"])
    sess_codec = ort.InferenceSession(os.path.join(model_dir, "moss_audio_tokenizer_decode_full.onnx"), so, providers=["CPUExecutionProvider"])

    # Step 5: Prefill once
    print("Running prefill...")
    pre_outs = sess_pre.run(None, {"inputs_embeds": prompt_embeds})
    past_k = [pre_outs[1 + i] for i in range(L)]
    past_v = [pre_outs[1 + L + i] for i in range(L)]
    h = pre_outs[0][:, -1] # (1, 768)

    # Helper sampling function
    def sample_code(logits, ch_history):
        logits = logits.copy().astype(np.float32)
        if rep_penalty > 1.0 and ch_history:
            idx = np.array(list(ch_history), dtype=np.int64)
            logits[idx] = np.where(logits[idx] < 0, logits[idx] * rep_penalty, logits[idx] / rep_penalty)
        if temperature > 0:
            logits /= temperature
        if 0 < top_k < len(logits):
            cand = np.argpartition(logits, -top_k)[-top_k:]
        else:
            cand = np.arange(len(logits))
        cs = logits[cand]
        order = np.argsort(cs)[::-1]
        cand = cand[order]
        probs = np.exp(cs[order] - np.max(cs[order]))
        probs /= np.sum(probs)
        if top_p < 1.0:
            keep = (np.cumsum(probs) - probs) < top_p
            probs = probs * keep
            probs /= np.sum(probs)
        return int(cand[np.random.choice(len(cand), p=probs)])

    # Repetition history per channel (deque with rep_window maxlen)
    from collections import deque
    histories = [deque(maxlen=rep_window) for _ in range(n_vq)]

    frames = []
    print(f"Generating frames (max {max_frames})...")
    empty_ac_past = np.zeros((1, nH_loc, 0, hd_loc), dtype=np.float32)

    for t in range(max_frames):
        cond = h[0].astype(np.float32)
        txt = text_emb[sgs].astype(np.float32)
        tok_step = np.stack([cond, txt])[None].astype(np.float32) # (1, 2, 768)

        ac_feed = {
            "token_emb": tok_step,
            "position_ids": np.array([[0, 1]], dtype=np.int64),
            "past_k_0": empty_ac_past,
            "past_v_0": empty_ac_past
        }
        ac_out = sess_ac.run(None, ac_feed)
        ac_hidden = ac_out[0]
        pk, pv = ac_out[1], ac_out[2]
        slot0 = ac_hidden[0, 0]

        # Sample codebook 0
        c0 = sample_code(ac_hidden[0, 1] @ audio_emb[0].T, histories[0])
        histories[0].append(c0)
        cur_codes = [c0]

        # Sample codebooks 1..15
        for ch in range(1, n_vq):
            emb_ch = audio_emb[ch - 1, cur_codes[-1]][None, None].astype(np.float32)
            ac_step_feed = {
                "token_emb": emb_ch,
                "position_ids": np.array([[ch + 1]], dtype=np.int64),
                "past_k_0": pk,
                "past_v_0": pv
            }
            ac_step_out = sess_ac.run(None, ac_step_feed)
            pk, pv = ac_step_out[1], ac_step_out[2]
            c_ch = sample_code(ac_step_out[0][0, 0] @ audio_emb[ch].T, histories[ch])
            histories[ch].append(c_ch)
            cur_codes.append(c_ch)

        frames.append(cur_codes)

        # EOS check
        text_logits = slot0 @ text_emb.T
        if int(text_logits.argmax()) == eos_speech:
            print(f"Reached EOS token at frame {t+1}!")
            break

        # Next backbone decode step
        slot_row = np.full((1, 1, n_vq + 1), audio_pad, dtype=np.int64)
        slot_row[0, 0, 0] = sgs
        slot_row[0, 0, 1:] = cur_codes
        slot_emb = text_emb[sgs]
        for ch in range(n_vq):
            slot_emb = slot_emb + audio_emb[ch, cur_codes[ch]]
        slot_emb = (slot_emb + anchor)[None, None].astype(np.float32) # (1, 1, 768)

        dec_feed = {
            "inputs_embeds": slot_emb,
            "position_ids": np.array([[T_prompt + t]], dtype=np.int64)
        }
        for i in range(L):
            dec_feed[f"past_k_{i}"] = past_k[i]
            dec_feed[f"past_v_{i}"] = past_v[i]

        dec_out = sess_dec.run(None, dec_feed)
        h = dec_out[0][:, 0]
        past_k = [dec_out[1 + i] for i in range(L)]
        past_v = [dec_out[1 + L + i] for i in range(L)]

        if (t + 1) % 25 == 0:
            print(f"Generated {t+1} frames (~{(t+1)/25:.1f}s)...")

    total_frames = len(frames)
    print(f"Total frames generated: {total_frames} (~{total_frames/25:.2f}s audio)")

    # Step 6: Codec decode to float32 PCM 48kHz
    print("Decoding audio with MOSS codec...")
    audio_codes = np.array(frames, dtype=np.int32)[None] # (1, total_frames, 16)
    code_lens = np.array([total_frames], dtype=np.int32)
    codec_out = sess_codec.run(None, {"audio_codes": audio_codes, "audio_code_lengths": code_lens})
    audio_pcm = codec_out[0][0].mean(axis=0).astype(np.float32)

    # Save to WAV
    sf.write(output_path, audio_pcm, 48000, subtype="PCM_16")
    file_size_kb = os.path.getsize(output_path) / 1024
    duration_sec = len(audio_pcm) / 48000.0
    print(f"SUCCESS: Saved {output_path} ({duration_sec:.2f}s, {file_size_kb:.1f} KB at 48kHz 16-bit)")

    # Export a test fixture for Kotlin / TypeScript unit tests
    test_fixture = {
        "text": text,
        "phonemes": phonemes,
        "token_ids": text_ids,
        "voice": voice_name,
        "first_5_frames": frames[:5],
        "total_frames": total_frames,
        "sample_rate": 48000,
        "audio_length_samples": len(audio_pcm)
    }
    with open("reference_test_fixture.json", "w", encoding="utf-8") as f:
        json.dump(test_fixture, f, indent=2, ensure_ascii=False)
    print("Exported reference_test_fixture.json for cross-language validation.")

if __name__ == "__main__":
    run_reference_tts()
