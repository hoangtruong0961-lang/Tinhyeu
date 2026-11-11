import NativeGeminiWebView, { isNativeGeminiWebViewSupported } from '../plugins/geminiWebView';

export interface ParsedGoogleCookies {
  psid: string;
  psidts?: string;
  psidcc?: string;
  cleanCookieHeader: string;
  isValid: boolean;
}

/**
 * Parses user input cookie string into structured cookies (works in both Browser and Node.js environments)
 */
export function parseGoogleCookies(rawCookieStr: string): ParsedGoogleCookies {
  if (!rawCookieStr || typeof rawCookieStr !== 'string') {
    return { psid: '', cleanCookieHeader: '', isValid: false };
  }

  const cookieMap = new Map<string, string>();
  const pairs = rawCookieStr.split(';');

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      if (key && val) {
        cookieMap.set(key, val);
      }
    }
  }

  // Common Google session authentication keys
  const psid = cookieMap.get('__Secure-1PSID') || cookieMap.get('__Secure-3PSID') || cookieMap.get('SID') || '';
  const psidts = cookieMap.get('__Secure-1PSIDTS') || cookieMap.get('__Secure-3PSIDTS') || '';
  const psidcc = cookieMap.get('__Secure-1PSIDCC') || cookieMap.get('__Secure-3PSIDCC') || '';

  const standardPairs: string[] = [];
  cookieMap.forEach((v, k) => {
    standardPairs.push(`${k}=${v}`);
  });

  return {
    psid,
    psidts,
    psidcc,
    cleanCookieHeader: standardPairs.join('; '),
    isValid: !!psid
  };
}

/**
 * Parses Google RPC stream response
 */
export function parseGeminiWebStreamResponse(responseText: string): string {
  if (!responseText || typeof responseText !== 'string') return '';

  const lines = responseText.split('\n');
  let accumulatedText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(")]}'")) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item[0] === 'wrb.fr') {
            const dataStr = item[2];
            if (typeof dataStr === 'string') {
              try {
                const subData = JSON.parse(dataStr);
                if (Array.isArray(subData) && subData[4]) {
                  const candidateList = subData[4];
                  if (Array.isArray(candidateList) && candidateList[0] && Array.isArray(candidateList[0][1])) {
                    const textParts = candidateList[0][1];
                    if (typeof textParts[0] === 'string') {
                      accumulatedText = textParts[0];
                    }
                  }
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }

  if (!accumulatedText.trim()) {
    const textMatches = responseText.match(/\\n\\n([^\\]+)\\n/g);
    if (textMatches && textMatches.length > 0) {
      const last = textMatches[textMatches.length - 1].replace(/\\n/g, '\n').trim();
      if (last.length > 3) {
        accumulatedText = last;
      }
    }
  }

  return accumulatedText.trim();
}

/**
 * Executes a prompt via Google Gemini Web either natively on Android (no CORS restriction)
 * or through the backend proxy server.
 */
export async function executeGeminiWebPromptHybrid(
  prompt: string,
  options: {
    cookie: string;
    snlm0e?: string;
  }
): Promise<{ success: boolean; text?: string; snlm0e?: string; error?: string; logs?: string[] }> {
  const logs: string[] = [];
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${time}] ${msg}`);
  };

  if (!options.cookie || !options.cookie.trim()) {
    return { success: false, error: 'Thiếu Cookie Google (__Secure-1PSID)', logs };
  }

  // 1. If running on native Android APK (Capacitor), execute directly via Android native plugin
  if (isNativeGeminiWebViewSupported()) {
    try {
      addLog('[GeminiNative RPC] Đang gửi yêu cầu trực tiếp qua Android Native Engine...');
      const nativeRes = await NativeGeminiWebView.executeGeminiPrompt({
        prompt,
        cookies: options.cookie.trim(),
        snlm0e: options.snlm0e
      });

      if (nativeRes.success && nativeRes.text) {
        addLog('[GeminiNative RPC] Nhận phản hồi thành công từ Google Web.');
        return {
          success: true,
          text: nativeRes.text,
          snlm0e: nativeRes.snlm0e || options.snlm0e,
          logs
        };
      } else {
        addLog(`[GeminiNative RPC Warning] ${nativeRes.error || 'Thử qua server proxy...'}`);
      }
    } catch (nativeErr: any) {
      addLog(`[GeminiNative RPC Err] ${nativeErr.message || 'Lỗi plugin'}`);
    }
  }

  // 2. Fallback or Web Mode: Call /api/gemini-web/execute-prompt
  try {
    addLog('[GeminiWeb Service] Gửi yêu cầu qua máy chủ proxy...');
    const res = await fetch('/api/gemini-web/execute-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        cookie: options.cookie.trim()
      })
    });

    const rawText = await res.text().catch(() => '');
    let data: any = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Máy chủ không phản hồi JSON hợp lệ: ${rawText.slice(0, 100)}`);
    }

    if (data.logs && Array.isArray(data.logs)) {
      data.logs.forEach((l: string) => logs.push(l));
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return {
      success: true,
      text: data.text,
      logs
    };
  } catch (err: any) {
    addLog(`[GeminiWeb Service Error] ${err.message || 'Lỗi kết nối'}`);
    return {
      success: false,
      error: err.message || 'Lỗi kết nối dịch vụ Gemini Web',
      logs
    };
  }
}

/**
 * Translates a chunk of subtitles using Gemini Web (Direct RPC Native / Proxy fallback)
 */
export async function translateSubtitleChunkWithGeminiWeb(
  subtitles: { id: string; originalText: string; startTime?: number; endTime?: number }[],
  targetLang: string,
  options: {
    cookie: string;
    snlm0e?: string;
    globalContext?: any;
    glossary?: any[];
    previousContext?: any[];
    customContext?: string;
    optimizeForTts?: boolean;
  }
): Promise<{
  success: boolean;
  translations: { id: string; translatedText: string }[];
  newEntities?: any[];
  error?: string;
}> {
  if (!subtitles || subtitles.length === 0) {
    return { success: true, translations: [] };
  }

  const { globalContext, glossary, previousContext, customContext, optimizeForTts = false } = options;

  const ttsInstruction = optimizeForTts
    ? `
=== CHỈ THỊ DỊCH THOẠI CHO THUYẾT MINH / LỒNG TIẾNG (DUBBING TIMING) ===
1. ƯU TIÊN SỐ 1 LÀ TỰ NHIÊN & ĐẦY ĐỦ Ý: Câu thoại tiếng Việt phải tự nhiên, tròn vành rõ chữ, có đầu có đuôi, đúng tâm lý nhân vật và truyền tải trọn vẹn cảm xúc.
2. TUYỆT ĐỐI KHÔNG cắt xén bừa bãi làm câu què, cộc lốc, vô lễ, khó hiểu hay mất đi các chi tiết quan trọng của câu thoại gốc.
3. Diễn đạt súc tích khi cần thiết: Với những câu quá dài, hãy tìm cách diễn đạt bằng tiếng Việt cô đọng, gãy gọn, thanh thoát để người đọc/thuyết minh bắt kịp nhịp hình, nhưng VẪN PHẢI GIỮ ĐỦ 100% Ý NGHĨA.
4. Giữ trọn ngữ khí và kính ngữ: Giữ đúng đại từ xưng hô và các trợ từ tình thái tự nhiên (ạ, nhé, chứ, hả...).`
    : `
=== NGUYÊN TẮC DỊCH THUẬT: TỰ NHIÊN, MƯỢT MÀ, TRỌN VẸN 100% Ý NGHĨA PHIM ===
1. GIỮ TRỌN VẸN Ý NGHĨA & CẢM XÚC: Dịch đầy đủ, chính xác, không lược bớt bất kỳ thông tin, chi tiết hay hàm ý nào của câu thoại gốc. TUYỆT ĐỐI KHÔNG tóm tắt hay cắt giảm câu chữ.
2. KHẨU KHÍ ĐIỆN ẢNH TỰ NHIÊN: Lời thoại phải tự nhiên như người Việt giao tiếp hàng ngày ngoài đời thực, câu cú mượt mà, trôi chảy, đúng phong cách phim ảnh.
3. TRỢ TỪ NGỮ KHÍ PHONG PHÚ: Giữ đầy đủ các trợ từ ngữ khí tự nhiên của tiếng Việt (như: nhé, nha, đấy, mà, chứ, sao, cơ, ạ, dạ, hả...) để câu thoại có hồn và truyền tải đúng cảm xúc nhân vật.
4. XƯNG HÔ LINH HOẠT THEO TÌNH HUỐNG: Đảm bảo vai vế xưng hô chuẩn xác theo mối quan hệ, tuổi tác và sắc thái tình cảm giữa các nhân vật.`;

  let globalGenreSection = '';
  if (globalContext && (globalContext.movieGenre || globalContext.characterPronounGuide)) {
    globalGenreSection = `
=== 1. GLOBAL MOVIE GENRE & STYLE RULES ===
- Thể loại phim: ${globalContext.movieGenre || 'Chưa xác định'}
- Thời đại & Bối cảnh: ${globalContext.eraAndSetting || 'Tự nhiên'}
${globalContext.summary ? `- Tóm tắt: ${globalContext.summary}` : ''}
- QUY TẮC ĐẠI TỪ NHÂN XƯNG: ${globalContext.characterPronounGuide || 'Xưng hô linh hoạt, tự nhiên theo quan hệ nhân vật.'}`;
  }

  let glossarySection = '';
  if (Array.isArray(glossary) && glossary.length > 0) {
    const entries = glossary
      .map((g: any) => `- "${g.original}" -> "${g.translated}" (${g.type || 'term'})`)
      .join('\n');
    glossarySection = `
=== 2. KNOWN ENTITY GLOSSARY (BẮT BUỘC DỊCH ĐÚNG) ===
${entries}`;
  }

  let prevContextSection = '';
  if (Array.isArray(previousContext) && previousContext.length > 0) {
    const prevLines = previousContext
      .map((p: any) => `[Câu trước] Gốc: "${p.originalText || ''}" -> Đã dịch: "${p.translatedText || ''}"`)
      .join('\n');
    prevContextSection = `
=== 3. PREVIOUS CONTEXT ===
${prevLines}`;
  }

  let userNotesSection = '';
  if (customContext && customContext.trim()) {
    userNotesSection = `
=== 4. GHI CHÚ BỔ SUNG ===
${customContext.trim()}`;
  }

  const subtitleItems = subtitles.map((s) => {
    if (optimizeForTts) {
      const durSec = Math.max(0.5, ((s.endTime || 0) - (s.startTime || 0)) || 2.0);
      return {
        id: s.id,
        originalText: s.originalText,
        targetDurationSec: Number(durSec.toFixed(1)),
      };
    }
    return {
      id: s.id,
      originalText: s.originalText,
    };
  });

  const prompt = `You are a professional film and video dialogue translator.
Translate the following list of subtitles into ${targetLang}.${globalGenreSection}${glossarySection}${prevContextSection}${userNotesSection}${ttsInstruction}

MANDATORY OUTPUT CONSTRAINTS:
1. "translatedText" must contain ONLY the spoken dialogue sentence in ${targetLang}.
2. Output strictly a JSON array or JSON object matching: {"translations": [{"id": string, "translatedText": string}]}.
3. DO NOT output markdown explanation outside JSON.

=== SUBTITLES TO TRANSLATE ===
${JSON.stringify(subtitleItems)}`;

  const result = await executeGeminiWebPromptHybrid(prompt, {
    cookie: options.cookie,
    snlm0e: options.snlm0e,
  });

  if (!result.success || !result.text) {
    return {
      success: false,
      translations: [],
      error: result.error || 'Không nhận được kết quả từ Gemini Web',
    };
  }

  let cleanText = result.text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Parse JSON structure
  let parsed: any = null;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    // Try regex array search
    const arrMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) {
      try {
        parsed = JSON.parse(arrMatch[0]);
      } catch (_) {}
    }
  }

  const translationsList: { id: string; translatedText: string }[] = [];
  const rawList = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.translations) ? parsed.translations : []);

  if (Array.isArray(rawList) && rawList.length > 0) {
    rawList.forEach((item: any) => {
      if (item && item.id) {
        translationsList.push({
          id: String(item.id),
          translatedText: String(item.translatedText || item.translation || '').trim(),
        });
      }
    });
  }

  // If parsed list is empty, fallback to 1-to-1 line mapping
  if (translationsList.length === 0) {
    const lines = cleanText.split('\n').filter((l) => l.trim().length > 0);
    subtitles.forEach((s, idx) => {
      translationsList.push({
        id: s.id,
        translatedText: lines[idx] || s.originalText,
      });
    });
  }

  return {
    success: true,
    translations: translationsList,
    newEntities: Array.isArray(parsed?.newEntities) ? parsed.newEntities : [],
  };
}

/**
 * Step 3 - Request 1: AI Screens subtitle blocks that are genuinely overloaded for TTS
 */
export async function screenTtsOverloadWithGeminiWeb(
  subtitles: { id: string | number; text?: string; translatedText?: string; originalText?: string; duration?: number; startTime?: number; endTime?: number }[],
  options: {
    cookie: string;
    snlm0e?: string;
  }
): Promise<{ success: boolean; overloadedItems: { id: string | number; text: string; duration: number; reason: string; targetWords?: number }[]; error?: string }> {
  if (!subtitles || subtitles.length === 0) {
    return { success: true, overloadedItems: [] };
  }

  const inputFormatted = subtitles.map((s) => {
    const durSec = Math.max(0.3, Number(s.duration || ((s.endTime || 0) - (s.startTime || 0))) || 1.5);
    const text = String(s.text || s.translatedText || s.originalText || '').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return {
      id: s.id,
      text: text,
      durationSec: Number(durSec.toFixed(2)),
      wordCount: wordCount,
    };
  });

  const prompt = `You are a professional film voiceover director, dubbing supervisor, and subtitle timing editor for Vietnamese Text-To-Speech (TTS).
Analyze the following subtitle blocks and their display durations in seconds ("durationSec").
Identify ONLY the subtitle blocks whose dialogue is genuinely OVERLOADED for Vietnamese voiceover — meaning there are too many words/syllables to be spoken naturally, clearly, and comfortably within its durationSec without rushing, clipping, or unnatural speedups.

CRITERIA:
- Natural Vietnamese voiceover tempo is approx 2.5 to 3.5 words per second.
- A block of 1.0s with 7-8 words is heavily overloaded.
- A block of 2.5s with 6-7 words is NOT overloaded.
- Do NOT flag sentences that can be comfortably spoken within the durationSec.

For each genuinely overloaded block, return its "id", a brief "reason" in Vietnamese, and recommended "targetWords".
Return strictly a JSON array:
[
  {
    "id": 1,
    "reason": "Thời lượng 1.2s quá ngắn cho câu 8 từ, nhịp đọc bị dồn",
    "targetWords": 4
  }
]
If NO subtitles are overloaded, return strictly: [].

Input Subtitles:
${JSON.stringify(inputFormatted, null, 2)}`;

  const result = await executeGeminiWebPromptHybrid(prompt, {
    cookie: options.cookie,
    snlm0e: options.snlm0e,
  });

  if (!result.success || !result.text) {
    return {
      success: false,
      overloadedItems: [],
      error: result.error || 'Lỗi nhận dữ liệu từ Gemini Web',
    };
  }

  let cleanText = result.text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: any[] = [];
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const arrMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) {
      try { parsed = JSON.parse(arrMatch[0]); } catch (_) {}
    }
  }

  const list: { id: string | number; text: string; duration: number; reason: string; targetWords?: number }[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && item.id !== undefined) {
        const orig = inputFormatted.find((c) => String(c.id) === String(item.id));
        if (orig) {
          list.push({
            id: orig.id,
            text: orig.text,
            duration: orig.durationSec,
            reason: item.reason || 'Quá tải thời lượng đọc TTS',
            targetWords: item.targetWords,
          });
        }
      }
    }
  }

  return {
    success: true,
    overloadedItems: list,
  };
}

/**
 * Step 3 - Request 2: AI Optimizes and rewrites screened overloaded subtitle lines for TTS voiceover
 */
export async function optimizeTtsOverloadWithGeminiWeb(
  overloadedBlocks: { id: string | number; text: string; duration: string | number; reason?: string; targetWords?: number }[],
  options: {
    cookie: string;
    snlm0e?: string;
  }
): Promise<{ success: boolean; optimizedBlocks: { id: string | number; text: string }[]; error?: string }> {
  if (!overloadedBlocks || overloadedBlocks.length === 0) {
    return { success: true, optimizedBlocks: [] };
  }

  const inputFormatted = overloadedBlocks.map((b) => {
    let durStr = String(b.duration || '1.5').replace('.', ',');
    return {
      id: b.id,
      text: String(b.text || ''),
      durationSec: durStr,
      issue: b.reason || 'Quá dài so với thời lượng',
      targetWords: b.targetWords,
    };
  });

  const prompt = `You are a master dialogue localizer and voiceover adapter for Vietnamese film dubbing and Text-To-Speech (TTS).
The following subtitle blocks were screened by the voiceover director as OVERLOADED for their display duration.
Rewrite and optimize the "text" of each block following these professional voiceover dubbing rules:

1. RÚT GỌN TỰ NHIÊN, CÔ ĐỌNG: Viết lại câu thoại ngắn gọn, súc tích, gãy gọn, giàu cảm xúc để giọng đọc TTS phát âm thoải mái, tự nhiên trong đúng thời lượng hiển thị (durationSec).
2. GIỮ NGUYÊN 100% Ý NGHĨA & CẢM XÚC: Không thêm thắt điều bịa đặt, không làm biến đổi nghĩa gốc hay làm câu cộc lốc, vô nghĩa.
3. TUYỆT ĐỐI BẢO LƯU ĐẠI TỪ XƯNG HÔ (PRONOUNS): Giữ nguyên quan hệ xưng hô của nhân vật (chú/cháu, anh/em, tôi/cô, ta/ngươi, sếp/em...) y như câu gốc.
4. KHÔNG DÙNG DẤU NGOẶC KÉP, KHÔNG CHÚ THÍCH: Chỉ trả về duy nhất lời thoại lồng tiếng hoàn chỉnh.

Format: [{"id": 1, "text": "câu thoại ngắn gọn đã tối ưu"}]

Input Blocks to Optimize:
${JSON.stringify(inputFormatted, null, 2)}`;

  const result = await executeGeminiWebPromptHybrid(prompt, {
    cookie: options.cookie,
    snlm0e: options.snlm0e,
  });

  if (!result.success || !result.text) {
    return {
      success: false,
      optimizedBlocks: [],
      error: result.error || 'Lỗi nhận dữ liệu từ Gemini Web',
    };
  }

  let cleanText = result.text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: any[] = [];
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const arrMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) {
      try {
        parsed = JSON.parse(arrMatch[0]);
      } catch (_) {}
    }
  }

  const list: { id: string | number; text: string }[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && item.id !== undefined && item.text) {
        let t = String(item.text).trim();
        t = t.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();
        list.push({
          id: item.id,
          text: t,
        });
      }
    }
  }

  return {
    success: true,
    optimizedBlocks: list,
  };
}

