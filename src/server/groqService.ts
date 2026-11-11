import path from 'path';

export interface GroqSttOptions {
  apiKey?: string;
  model?: string; // 'whisper-large-v3' | 'whisper-large-v3-turbo'
  language?: string;
  autoTranslateToVietnamese?: boolean;
}

export interface GroqSubtitleSegment {
  id: string;
  startTime: number;
  endTime: number;
  sourceText: string;
  originalText: string;
  vietnamese?: string;
  confidence?: number;
}

export interface GroqSttResult {
  success: boolean;
  language?: string;
  duration?: number;
  subtitles: GroqSubtitleSegment[];
  rawText?: string;
}

/**
 * Validates and tests connection to Groq API using provided API Key
 */
export async function testGroqConnection(apiKey: string): Promise<{ success: boolean; models: string[]; message: string }> {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Vui lòng cung cấp Groq API Key hợp lệ (bắt đầu bằng gsk_...)');
  }

  const res = await fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${cleanKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let errMsg = `Lỗi Groq API (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) {
        errMsg = parsed.error.message;
      }
    } catch (_) {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  const models = Array.isArray(data?.data)
    ? data.data.map((m: any) => m.id).filter(Boolean)
    : [];

  return {
    success: true,
    models,
    message: `Kết nối Groq AI thành công! Nhận diện ${models.length} mô hình khả dụng.`,
  };
}

/**
 * Transcribe audio buffer using Groq Whisper Cloud API (whisper-large-v3 / whisper-large-v3-turbo)
 */
export async function transcribeWithGroq(
  audioBuffer: Buffer,
  options: GroqSttOptions = {}
): Promise<GroqSttResult> {
  const apiKey = (options.apiKey || process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Chưa cấu hình Groq API Key! Vui lòng nhập Groq API Key trong phần Cài đặt (Lựa chọn 4: Groq AI) hoặc lấy miễn phí tại https://console.groq.com/keys');
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Dữ liệu âm thanh trống, không thể nhận diện');
  }

  const sttModel = options.model || 'whisper-large-v3';

  // Construct standard FormData using native fetch File / Blob
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer as unknown as BlobPart], { type: 'audio/wav' });
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', sttModel);
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0');

  // Handle language normalization
  if (options.language && options.language !== 'auto' && options.language !== 'detect') {
    // Map standard language codes to ISO 639-1 expected by Whisper
    let langCode = options.language.toLowerCase().trim();
    if (langCode.startsWith('zh')) langCode = 'zh';
    else if (langCode.startsWith('vi')) langCode = 'vi';
    else if (langCode.startsWith('en')) langCode = 'en';
    else if (langCode.startsWith('ja')) langCode = 'ja';
    else if (langCode.startsWith('ko')) langCode = 'ko';
    else if (langCode.startsWith('th')) langCode = 'th';
    else if (langCode.startsWith('fr')) langCode = 'fr';
    else if (langCode.startsWith('de')) langCode = 'de';
    else if (langCode.startsWith('ru')) langCode = 'ru';
    else if (langCode.startsWith('es')) langCode = 'es';
    formData.append('language', langCode);
  }

  console.log(`[Groq STT] Sending ${audioBuffer.length} bytes to Groq Whisper (${sttModel}), lang: ${options.language || 'auto'}...`);

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let detail = `Mã lỗi HTTP ${response.status}`;
    try {
      const jsonErr = JSON.parse(errorText);
      if (jsonErr.error?.message) {
        detail = jsonErr.error.message;
      }
    } catch (_) {
      if (errorText) detail = errorText.slice(0, 300);
    }
    console.error(`[Groq STT Error] ${detail}`);
    throw new Error(`Groq Whisper STT thất bại: ${detail}`);
  }

  const jsonResult: any = await response.json();
  const rawSegments = Array.isArray(jsonResult.segments) ? jsonResult.segments : [];
  const fullText = (jsonResult.text || '').trim();

  let subtitles: GroqSubtitleSegment[] = [];

  if (rawSegments.length > 0) {
    subtitles = rawSegments.map((seg: any, idx: number) => {
      const text = (seg.text || '').trim();
      const start = Number(seg.start) || 0;
      const end = Number(seg.end) || (start + 2);
      const conf = seg.no_speech_prob !== undefined ? Math.max(0.5, 1 - Number(seg.no_speech_prob)) : 0.95;

      return {
        id: `stt_groq_${Date.now()}_${idx}`,
        startTime: Math.round(start * 100) / 100,
        endTime: Math.round(end * 100) / 100,
        sourceText: text,
        originalText: text,
        confidence: conf,
      };
    }).filter((s: GroqSubtitleSegment) => s.sourceText.length > 0);
  } else if (fullText.length > 0) {
    // Fallback if segments is empty: split into sentence chunks
    const sentences = fullText.split(/(?<=[.!?。！？\n])\s+/).filter(Boolean);
    const totalDur = Number(jsonResult.duration) || 5;
    const durPerSent = totalDur / Math.max(1, sentences.length);

    subtitles = sentences.map((sent: string, idx: number) => ({
      id: `stt_groq_${Date.now()}_${idx}`,
      startTime: Math.round(idx * durPerSent * 100) / 100,
      endTime: Math.round((idx + 1) * durPerSent * 100) / 100,
      sourceText: sent.trim(),
      originalText: sent.trim(),
      confidence: 0.9,
    }));
  }

  console.log(`[Groq STT] Successfully extracted ${subtitles.length} subtitle segments from audio.`);

  return {
    success: true,
    language: jsonResult.language,
    duration: jsonResult.duration,
    subtitles,
    rawText: fullText,
  };
}

/**
 * Text translation or generation using Groq LLM (e.g. llama-3.3-70b-versatile)
 */
export async function translateWithGroq(
  prompt: string,
  options: {
    apiKey?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    responseFormatJson?: boolean;
  } = {}
): Promise<string> {
  const apiKey = (options.apiKey || process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Chưa có Groq API Key. Vui lòng nhập trong Cài đặt (Lựa chọn 4).');
  }

  const model = options.model || 'llama-3.3-70b-versatile';
  const systemMessage = options.systemPrompt || 'Bạn là chuyên gia dịch thuật phụ đề phim chuyên nghiệp. Luôn trả về kết quả chính xác, tự nhiên, văn phong điện ảnh cuốn hút.';

  const bodyPayload: any = {
    model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt },
    ],
    temperature: options.temperature !== undefined ? options.temperature : 0.2,
  };

  if (options.responseFormatJson) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) detail = parsed.error.message;
    } catch (_) {}
    throw new Error(`Groq LLM call failed: ${detail}`);
  }

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content.trim();
}
