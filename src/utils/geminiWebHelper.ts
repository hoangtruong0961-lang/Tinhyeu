import NativeGeminiWebView, { isNativeGeminiWebViewSupported } from '../plugins/geminiWebView';
import { resolveApiUrl } from './apiUrl';

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

  // 2. Fallback or Web Mode: Call /api/gemini-web/execute-prompt (with resolveApiUrl for APK)
  try {
    addLog('[GeminiWeb Service] Gửi yêu cầu qua máy chủ proxy...');
    const res = await fetch(resolveApiUrl('/api/gemini-web/execute-prompt'), {
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
 * Extracts Global Movie Context & Entity Glossary via Gemini Web RPC (with stratified full-script sampling)
 */
export async function extractGlobalContextWithGeminiWeb(
  subtitles: { originalText?: string; text?: string; startTime?: number }[],
  targetLang: string,
  options: {
    cookie: string;
    snlm0e?: string;
    customContext?: string;
    existingGlossary?: any[];
  }
): Promise<{ success: boolean; globalContext?: any; error?: string }> {
  if (!subtitles || subtitles.length === 0) {
    return { success: false, error: 'Missing subtitles' };
  }

  const scriptLines = subtitles
    .map((s, idx) => {
      const text = String(s.originalText || s.text || '').trim();
      const start = typeof s.startTime === 'number' ? s.startTime.toFixed(1) : '0';
      return `[#${idx + 1} | ${start}s] ${text}`;
    })
    .filter((line) => !line.endsWith('] '));

  let fullScriptSample = '';
  if (scriptLines.length > 480) {
    const head = scriptLines.slice(0, 160);
    const tail = scriptLines.slice(scriptLines.length - 160);
    const middlePool = scriptLines.slice(160, scriptLines.length - 160);
    const middle: string[] = [];
    const step = middlePool.length / 160;
    for (let i = 0; i < 160; i++) {
      const pick = middlePool[Math.min(middlePool.length - 1, Math.floor(i * step))];
      if (pick) middle.push(pick);
    }
    fullScriptSample = [
      ...head,
      `... [SAMPLED MIDDLE SECTION across ${middlePool.length} lines] ...`,
      ...middle,
      `... [FINAL ACT / ENDING] ...`,
      ...tail,
    ].join('\n');
  } else {
    fullScriptSample = scriptLines.join('\n');
  }

  const userNotes = options.customContext?.trim()
    ? `\nADDITIONAL USER-PROVIDED CONTEXT:\n${options.customContext.trim()}\n`
    : '';
  const existingNote = Array.isArray(options.existingGlossary) && options.existingGlossary.length > 0
    ? `\nPRE-EXISTING GLOSSARY:\n${options.existingGlossary.slice(0, 60).map((g: any) => `- "${g.original}" -> "${g.translated}"`).join('\n')}\n`
    : '';

  const prompt = `You are a film script analyst and subtitle localization director for translating into ${targetLang}.
Analyze the following video script and return STRICT JSON ONLY (no markdown outside JSON):
{
  "movieGenre": "Thể loại phim (VD: Cổ trang/Kiếm hiệp, Hiện đại/Đô thị, Học đường...)",
  "eraAndSetting": "Bối cảnh & thời đại",
  "characterPronounGuide": "Quy tắc xưng hô linh hoạt theo quan hệ nhân vật (TUYỆT ĐỐI không dịch máy móc 1 đại từ cho mọi người)",
  "summary": "Tóm tắt ngắn gọn 2-3 câu cốt truyện & tông phim",
  "knownEntityGlossary": [
    {"original": "Tên gốc", "translated": "Bản dịch chuẩn ${targetLang}", "type": "character|location|organization|term", "description": "Vai trò"}
  ]
}${userNotes}${existingNote}

SUBTITLE SCRIPT:
${fullScriptSample}`;

  const result = await executeGeminiWebPromptHybrid(prompt, {
    cookie: options.cookie,
    snlm0e: options.snlm0e,
  });

  if (!result.success || !result.text) {
    return { success: false, error: result.error || 'Lỗi Gemini Web RPC' };
  }

  let cleanText = result.text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const objMatch = cleanText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Gemini Web không trả về JSON ngữ cảnh hợp lệ' };
  }

  return { success: true, globalContext: parsed };
}

/**
 * Translates a chunk of subtitles using Gemini Web (Direct RPC Native / Proxy fallback)
 */
export async function translateSubtitleChunkWithGeminiWeb(
  subtitles: { id: string; originalText: string; startTime?: number; endTime?: number; syncedEntities?: string[] }[],
  targetLang: string,
  options: {
    cookie: string;
    snlm0e?: string;
    globalContext?: any;
    glossary?: any[];
    previousContext?: any[];
    nextContext?: any[];
    customContext?: string;
    optimizeForTts?: boolean;
    avoidTikTokPolicy?: boolean;
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

  const {
    globalContext,
    glossary,
    previousContext,
    nextContext,
    customContext,
    optimizeForTts = false,
    avoidTikTokPolicy = false,
  } = options;

  const ttsInstruction = optimizeForTts
    ? `
=== CHỈ THỊ DỊCH THOẠI CHO THUYẾT MINH / LỒNG TIẾNG (DUBBING TIMING) ===
1. ƯU TIÊN CÂN BẰNG THỜI LƯỢNG ĐỌC ("targetDurationSec"): Câu thoại ${targetLang} phải tự nhiên, tròn vành rõ chữ, có đầu có đuôi, đúng tâm lý nhân vật và khớp nhịp hình.
2. TUYỆT ĐỐI KHÔNG cắt xén bừa bãi làm câu què, cộc lốc, vô lễ, khó hiểu hay mất đi các chi tiết quan trọng của câu thoại gốc.
3. Diễn đạt súc tích thông minh với các câu có targetDurationSec ngắn nhưng VẪN GIỮ ĐỦ 100% Ý NGHĨA.
4. Giữ trọn ngữ khí, đại từ xưng hô và trợ từ tình thái tự nhiên.`
    : `
=== NGUYÊN TẮC DỊCH THUẬT: TỰ NHIÊN, MƯỢT MÀ, TRỌN VẸN 100% Ý NGHĨA PHIM ===
1. GIỮ TRỌN VẸN Ý NGHĨA & CẢM XÚC: Dịch đầy đủ, chính xác, không lược bớt bất kỳ thông tin, chi tiết hay hàm ý nào của câu thoại gốc. TUYỆT ĐỐI KHÔNG tóm tắt hay cắt giảm câu chữ.
2. KHẨU KHÍ ĐIỆN ẢNH TỰ NHIÊN: Lời thoại phải tự nhiên như người bản xứ giao tiếp hàng ngày ngoài đời thực, câu cú mượt mà, trôi chảy, đúng phong cách phim ảnh.
3. TRỢ TỪ NGỮ KHÍ PHONG PHÚ & XƯNG HÔ LINH HOẠT THEO TÌNH HUỐNG.`;

  const policyInstruction = avoidTikTokPolicy
    ? `\n=== CHẾ ĐỘ LỌC CHÍNH SÁCH NỀN TẢNG (TIKTOK SAFE) ===\n- Làm mềm các từ thô tục nặng, bạo lực trực diện hoặc từ nhạy cảm dễ bị nền tảng bóp tương tác, nhưng vẫn giữ trọn ý nghĩa & cảm xúc cảnh phim.`
    : `\n=== CHẾ ĐỘ DỊCH NGUYÊN VĂN ===\n- Giữ nguyên khẩu khí và mức độ gai góc/nhạy cảm sát nguyên tác, không tự ý làm dịu hay kiểm duyệt.`;

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
=== 2. KNOWN ENTITY GLOSSARY (BẮT BUỘC DỊCH ĐÚNG, KHÔNG ĐỔI) ===
${entries}`;
  }

  let prevContextSection = '';
  if (Array.isArray(previousContext) && previousContext.length > 0) {
    const prevLines = previousContext
      .map((p: any) => `[Câu trước] Gốc: "${p.originalText || ''}" -> Đã dịch: "${p.translatedText || ''}"`)
      .join('\n');
    prevContextSection = `
=== 3. PREVIOUS CONTEXT (THAM KHẢO, KHÔNG DỊCH LẠI) ===
${prevLines}`;
  }

  let nextContextSection = '';
  if (Array.isArray(nextContext) && nextContext.length > 0) {
    const nextLines = nextContext
      .map((n: any) => `[Câu sau] Gốc: "${n.originalText || ''}"`)
      .join('\n');
    nextContextSection = `
=== 4. NEXT CONTEXT (CÂU SAU - THAM KHẢO MẠCH CÂU, KHÔNG DỊCH LẠI) ===
${nextLines}`;
  }

  let userNotesSection = '';
  if (customContext && customContext.trim()) {
    userNotesSection = `
=== 5. GHI CHÚ BỔ SUNG ===
${customContext.trim()}`;
  }

  const subtitleItems = subtitles.map((s) => {
    const item: any = {
      id: s.id,
      originalText: s.originalText,
    };
    if (optimizeForTts) {
      const durSec = Math.max(0.5, ((s.endTime || 0) - (s.startTime || 0)) || 2.0);
      item.targetDurationSec = Number(durSec.toFixed(1));
    }
    if (Array.isArray(s.syncedEntities) && s.syncedEntities.length > 0) {
      item.requiredEntities = s.syncedEntities;
    }
    return item;
  });

  const prompt = `You are a professional film and video dialogue translator.
Translate EVERY item in the following list of subtitles into ${targetLang}.${globalGenreSection}${glossarySection}${prevContextSection}${nextContextSection}${userNotesSection}${ttsInstruction}${policyInstruction}

MANDATORY OUTPUT CONSTRAINTS:
1. Return a translation for EVERY single "id" in the input list — NEVER omit or merge items.
2. "translatedText" must contain ONLY the spoken dialogue sentence in ${targetLang}.
3. Output strictly JSON matching:
{
  "translations": [{"id": string, "translatedText": string}],
  "newEntities": [{"original": string, "translated": string, "type": "character" | "location" | "organization" | "term"}]
}
4. DO NOT output markdown explanation outside JSON.

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

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const objMatch = cleanText.match(/\{[\s\S]*\}/);
    const arrMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    const raw = objMatch ? objMatch[0] : (arrMatch ? arrMatch[0] : '');
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {}
    }
  }

  const translationsList: { id: string; translatedText: string }[] = [];
  const rawList = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.translations) ? parsed.translations : []);

  if (Array.isArray(rawList) && rawList.length > 0) {
    const matchedIds = new Set<string>();
    rawList.forEach((item: any) => {
      const itemId = item?.id !== undefined ? String(item.id).trim() : '';
      const orig = subtitles.find((s) => String(s.id).trim() === itemId);
      const trans = String(item?.translatedText || item?.translation || '').trim();
      if (orig && trans && !matchedIds.has(orig.id)) {
        matchedIds.add(orig.id);
        translationsList.push({ id: orig.id, translatedText: trans });
      }
    });

    if (matchedIds.size < subtitles.length && rawList.length === subtitles.length) {
      subtitles.forEach((orig, idx) => {
        if (!matchedIds.has(orig.id)) {
          const cand = rawList[idx];
          const trans = String(cand?.translatedText || cand?.translation || '').trim();
          if (trans) {
            matchedIds.add(orig.id);
            translationsList.push({ id: orig.id, translatedText: trans });
          }
        }
      });
    }
  }

  return {
    success: translationsList.length > 0,
    translations: translationsList,
    newEntities: Array.isArray(parsed?.newEntities) ? parsed.newEntities : [],
    error: translationsList.length === 0 ? 'Gemini Web không trả về danh sách bản dịch JSON hợp lệ.' : undefined,
  };
}

/**
 * Step 3 - Request 1: AI Screens subtitle blocks that are genuinely overloaded for TTS (Pre-filtered & Chunked)
 */
export async function screenTtsOverloadWithGeminiWeb(
  subtitles: { id: string | number; text?: string; translatedText?: string; originalText?: string; duration?: number; startTime?: number; endTime?: number }[],
  options: {
    cookie: string;
    snlm0e?: string;
    targetLang?: string;
  }
): Promise<{ success: boolean; overloadedItems: { id: string | number; text: string; duration: number; reason: string; targetWords?: number }[]; error?: string }> {
  if (!subtitles || subtitles.length === 0) {
    return { success: true, overloadedItems: [] };
  }

  const targetLang = options.targetLang || 'Tiếng Việt';
  const lowerLang = targetLang.toLowerCase();
  const isCjkOrThai = /trung|zh|chinese|nhật|ja|japanese|hàn|ko|korean|thái|th|thai/i.test(lowerLang);
  const isEnglishOrLatin = /english|tiếng anh|en|pháp|french|fr/i.test(lowerLang);

  const candidates: any[] = [];
  for (const s of subtitles) {
    const durSec = Math.max(0.3, Number(s.duration || ((s.endTime || 0) - (s.startTime || 0))) || 1.5);
    const text = String(s.text || s.translatedText || s.originalText || '').trim();
    if (!text) continue;
    const cleanUnitStr = text.replace(/[\s.,!?;:'"()\-–—~…]+/g, '');
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const unitCount = isCjkOrThai ? cleanUnitStr.length : wordCount;
    const maxPerSec = isCjkOrThai ? 4.5 : (isEnglishOrLatin ? 2.8 : 3.3);
    const comfortableMax = Math.max(isCjkOrThai ? 4 : 3, durSec * maxPerSec);

    if (unitCount > comfortableMax * 0.92) {
      candidates.push({
        id: s.id,
        text,
        durationSec: Number(durSec.toFixed(2)),
        unitCount,
        recommendedMaxUnits: Math.max(isCjkOrThai ? 3 : 2, Math.floor(durSec * maxPerSec * 0.9)),
      });
    }
  }

  if (candidates.length === 0) {
    return { success: true, overloadedItems: [] };
  }

  const BATCH_SIZE = 40;
  const list: { id: string | number; text: string; duration: number; reason: string; targetWords?: number }[] = [];
  const tempoRule = isCjkOrThai
    ? `Natural ${targetLang} voiceover tempo is approx 4.0 to 4.5 characters/syllables per second.`
    : (isEnglishOrLatin
      ? `Natural ${targetLang} voiceover tempo is approx 2.5 to 3.0 words per second.`
      : `Natural ${targetLang} voiceover tempo is approx 2.8 to 3.4 words/syllables per second.`);

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const chunk = candidates.slice(i, i + BATCH_SIZE);
    const prompt = `You are a professional film voiceover director and subtitle timing editor for ${targetLang} Text-To-Speech (TTS).
Analyze the following pre-screened candidate subtitle blocks and their display durations ("durationSec").
Identify ONLY blocks genuinely OVERLOADED for ${targetLang} voiceover.

CRITERIA:
- ${tempoRule}
- Do NOT flag sentences that fit comfortably within durationSec.

Return strictly a JSON array:
[{"id": "...", "reason": "lý do ngắn", "targetWords": 5}]
If NONE are overloaded, return strictly: [].

Candidate Subtitles:
${JSON.stringify(chunk, null, 2)}`;

    const result = await executeGeminiWebPromptHybrid(prompt, {
      cookie: options.cookie,
      snlm0e: options.snlm0e,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        overloadedItems: list,
        error: result.error || 'Lỗi nhận dữ liệu từ Gemini Web',
      };
    }

    let cleanText = result.text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsed: any = [];
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      const arrMatch = cleanText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (arrMatch) {
        try { parsed = JSON.parse(arrMatch[0]); } catch (_) {}
      }
    }

    const items = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.overloadedItems) ? parsed.overloadedItems : []);

    for (const item of items) {
      if (item && item.id !== undefined) {
        const orig = chunk.find((c) => String(c.id) === String(item.id));
        if (orig) {
          list.push({
            id: orig.id,
            text: orig.text,
            duration: orig.durationSec,
            reason: item.reason || 'Quá tải thời lượng đọc TTS',
            targetWords: item.targetWords || orig.recommendedMaxUnits,
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
 * Step 3 - Request 2: AI Optimizes and rewrites screened overloaded subtitle lines for TTS voiceover (Context & Pronoun Safe)
 */
export async function optimizeTtsOverloadWithGeminiWeb(
  overloadedBlocks: { id: string | number; text: string; duration: string | number; reason?: string; targetWords?: number; prevText?: string; nextText?: string }[],
  options: {
    cookie: string;
    snlm0e?: string;
    targetLang?: string;
    globalContext?: any;
    glossary?: any[];
  }
): Promise<{ success: boolean; optimizedBlocks: { id: string | number; text: string }[]; error?: string }> {
  if (!overloadedBlocks || overloadedBlocks.length === 0) {
    return { success: true, optimizedBlocks: [] };
  }

  const targetLang = options.targetLang || 'Tiếng Việt';
  let contextSection = '';
  if (options.globalContext && (options.globalContext.movieGenre || options.globalContext.characterPronounGuide)) {
    contextSection += `\n=== NGỮ CẢNH PHIM & XƯNG HÔ BẮT BUỘC ===\n- Thể loại: ${options.globalContext.movieGenre || 'Tự động'}\n- Quy tắc xưng hô: ${options.globalContext.characterPronounGuide || 'Giữ nguyên như câu gốc'}`;
  }
  if (Array.isArray(options.glossary) && options.glossary.length > 0) {
    const entries = options.glossary.slice(0, 80).map((g: any) => `"${g.original}" -> "${g.translated}"`).join(', ');
    contextSection += `\n- Tên riêng/thuật ngữ chuẩn (KHÔNG ĐỔI): ${entries}`;
  }

  const BATCH_SIZE = 25;
  const list: { id: string | number; text: string }[] = [];

  for (let i = 0; i < overloadedBlocks.length; i += BATCH_SIZE) {
    const chunk = overloadedBlocks.slice(i, i + BATCH_SIZE);
    const inputFormatted = chunk.map((b) => ({
      id: b.id,
      text: String(b.text || ''),
      durationSec: Number(b.duration || 1.5),
      issue: b.reason || 'Quá dài so với thời lượng',
      targetWords: b.targetWords,
      ...(b.prevText ? { prevLineContext: b.prevText } : {}),
      ...(b.nextText ? { nextLineContext: b.nextText } : {}),
    }));

    const prompt = `You are a master dialogue localizer and voiceover adapter for ${targetLang} film dubbing and Text-To-Speech (TTS).
The following subtitle blocks were screened as OVERLOADED for their display duration.${contextSection}
Rewrite and optimize ONLY the "text" of each block in ${targetLang} following these rules:

1. RÚT GỌN TỰ NHIÊN, CÔ ĐỌNG: Viết lại câu thoại ngắn gọn, súc tích, giàu cảm xúc để giọng đọc TTS phát âm thoải mái trong đúng durationSec.
2. GIỮ NGUYÊN 100% Ý NGHĨA, TÊN RIÊNG & CẢM XÚC: Không bịa đặt, không biến đổi nghĩa gốc.
3. TUYỆT ĐỐI BẢO LƯU ĐẠI TỪ XƯNG HÔ (PRONOUNS): Giữ nguyên quan hệ xưng hô y như câu gốc và bảng quy tắc xưng hô.
4. KHÔNG DÙNG DẤU NGOẶC KÉP, KHÔNG CHÚ THÍCH.

Format strictly JSON array: [{"id": "...", "text": "câu thoại ngắn gọn đã tối ưu"}]

Input Blocks to Optimize:
${JSON.stringify(inputFormatted, null, 2)}`;

    const result = await executeGeminiWebPromptHybrid(prompt, {
      cookie: options.cookie,
      snlm0e: options.snlm0e,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        optimizedBlocks: list,
        error: result.error || 'Lỗi nhận dữ liệu từ Gemini Web',
      };
    }

    let cleanText = result.text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsed: any = [];
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      const arrMatch = cleanText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (arrMatch) {
        try { parsed = JSON.parse(arrMatch[0]); } catch (_) {}
      }
    }

    const items = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.optimizedBlocks) ? parsed.optimizedBlocks : []);

    for (const item of items) {
      if (item && item.id !== undefined && item.text) {
        let t = String(item.text).trim();
        t = t.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();
        if (t) {
          list.push({ id: item.id, text: t });
        }
      }
    }
  }

  return {
    success: true,
    optimizedBlocks: list,
  };
}

/**
 * Step 2 OCR Post-Processing: Refine, fix OCR typos, remove watermarks/noise, and merge duplicate OCR lines via Gemini Web
 */
export async function deduplicateSubtitlesWithGeminiWeb(
  subtitles: { startTime: number; endTime: number; originalText: string; sourceLang?: string; translatedText?: string; boundingBox?: any }[],
  options: {
    cookie: string;
    snlm0e?: string;
    targetLang?: string;
  }
): Promise<{
  success: boolean;
  subtitles: { startTime: number; endTime: number; originalText: string; sourceLang?: string; translatedText?: string; boundingBox?: any }[];
  error?: string;
}> {
  if (!subtitles || subtitles.length === 0) {
    return { success: true, subtitles: [] };
  }

  const BATCH_SIZE = 50;
  const cleanedAll: { startTime: number; endTime: number; originalText: string; sourceLang?: string; translatedText?: string; boundingBox?: any }[] = [];

  for (let i = 0; i < subtitles.length; i += BATCH_SIZE) {
    const chunk = subtitles.slice(i, i + BATCH_SIZE);
    const compactChunk = chunk.map((s) => ({
      startTime: typeof s.startTime === 'number' ? Number(s.startTime.toFixed(2)) : 0,
      endTime: typeof s.endTime === 'number' ? Number(s.endTime.toFixed(2)) : 0,
      originalText: String(s.originalText || '').trim(),
      ...(s.sourceLang ? { sourceLang: s.sourceLang } : {}),
      ...(s.translatedText ? { translatedText: s.translatedText } : {}),
    }));

    const prompt = `You are GeminiSubtitleRefiner, an expert AI video subtitle post-processor.
You are given a raw list of extracted OCR video subtitles with timestamps.

YOUR 4 STRICT WORKFLOW MANDATES:
1. CONTEXTUAL DIALOGUE REPAIR & OCR TYPO FIXING:
   - Fix common OCR misreads and distorted characters in its NATIVE SOURCE LANGUAGE so originalText is natural and accurate.
2. FILTER OUT OCR TRASH & NOISE:
   - Remove UI icons, watermark text, floating gibberish, or unreadable background artifacts.
3. MERGE DUPLICATE & FRAGMENTED SUBTITLES STRICTLY (NEVER DROP SHORT REPEATING PHRASES):
   - Merge identical consecutive sentences or cumulative typing fragments belonging to the same dialogue line, preserving earliest startTime and natural endTime.
   - Keep separate short spoken phrases as distinct timeline items.
4. DO NOT TRANSLATE:
   - Keep "originalText" strictly in its native source language. Leave "translatedText" empty ("") unless preserving an existing translation.

Return strictly a raw JSON array matching:
[{"startTime": number, "endTime": number, "originalText": string, "sourceLang": string, "translatedText": string}]

Raw Subtitles Input:
${JSON.stringify(compactChunk)}`;

    const result = await executeGeminiWebPromptHybrid(prompt, {
      cookie: options.cookie,
      snlm0e: options.snlm0e,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        subtitles: cleanedAll,
        error: result.error || 'Lỗi kết nối Gemini Web khi tinh lọc OCR',
      };
    }

    let cleanText = result.text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      const arrMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrMatch) {
        try { parsed = JSON.parse(arrMatch[0]); } catch (_) {}
      }
    }

    const items = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.subtitles) ? parsed.subtitles : []);

    for (const item of items) {
      const origText = String(item?.originalText || '').trim();
      if (!origText) continue;
      const sT = typeof item.startTime === 'number' ? item.startTime : 0;
      const eT = typeof item.endTime === 'number' ? item.endTime : sT + 1.0;

      // Inherit boundingBox & fallback sourceLang from best-overlapping raw item in chunk
      let bestMatch: any = null;
      let bestOverlap = -1;
      for (const raw of chunk) {
        const overlap = Math.min(eT, raw.endTime) - Math.max(sT, raw.startTime);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestMatch = raw;
        }
      }

      cleanedAll.push({
        startTime: Number(sT.toFixed(2)),
        endTime: Number(Math.max(sT + 0.2, eT).toFixed(2)),
        originalText: origText,
        sourceLang: item.sourceLang || bestMatch?.sourceLang,
        translatedText: typeof item.translatedText === 'string' ? item.translatedText.trim() : (bestMatch?.translatedText || ''),
        boundingBox: bestMatch?.boundingBox,
      });
    }
  }

  // Non-overlap sanitizer
  cleanedAll.sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < cleanedAll.length; i++) {
    const prev = cleanedAll[i - 1];
    const curr = cleanedAll[i];
    if (prev.endTime >= curr.startTime) {
      if (curr.startTime > prev.startTime + 0.02) {
        prev.endTime = Number(Math.max(prev.startTime + 0.05, curr.startTime - 0.02).toFixed(2));
      } else {
        prev.endTime = Number((prev.startTime + 0.10).toFixed(2));
        curr.startTime = Number((prev.endTime + 0.02).toFixed(2));
      }
      if (curr.endTime < curr.startTime + 0.20) {
        curr.endTime = Number((curr.startTime + 0.20).toFixed(2));
      }
    }
  }

  return {
    success: cleanedAll.length > 0,
    subtitles: cleanedAll,
    error: cleanedAll.length === 0 ? 'Gemini Web không trả về danh sách phụ đề OCR hợp lệ.' : undefined,
  };
}


