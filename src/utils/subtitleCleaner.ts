/**
 * Subtitle Sanitizer & AI Artifact Cleaner
 * Filters out LLM hallucinations, reflection tags, spellcheck/correction logs,
 * character count limits, proxy debug notes, and repetitive sentence duplications.
 */

export function cleanTranslatedSubtitleText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText.trim();

  // 1. Remove surrounding wrapping quotes or markdown backticks
  text = text.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();

  // 2. Remove common AI prompt/role echo prefixes
  text = text
    .replace(/^(?:Bản\s*dịch|Dịch|Translation|Translated|Subtitle|Tiếng\s*Việt)\s*:\s*/i, '')
    .replace(/^Output\s*:\s*/i, '')
    .trim();

  // 3. Remove spellcheck / correction logs like:
  // "拼写错误: Vâng thưa anh. (OK) -> Vâng thưa anh. (13 chars) - Limit 16. (Correction: Vâng thưa anh.)"
  // If there is a clean sentence BEFORE "拼写错误:" or "Correction:", preserve the sentence
  if (/拼写错误|拼写|Correction:/i.test(text)) {
    // Check if there is valid text before the spellcheck tag
    const splitMatch = text.split(/拼写错误|拼写|Correction:/i);
    if (splitMatch[0] && splitMatch[0].trim().length >= 2) {
      text = splitMatch[0].trim();
    } else if (splitMatch[1]) {
      text = splitMatch[1].trim();
    }
  }

  // 4. Strip Chinese reasoning / balance tags & ID echoes
  // e.g. "平衡-909a1-ok-19/20-chars.Về-909a1." or "平衡-.*?-chars" or "Về-909a1"
  text = text.replace(/(?:平衡|Cân\s*bằng|Balance)-[a-zA-Z0-9_\-]+(?:-ok-[0-9/]+-chars)?(?:\.(?:Về|About)-[a-zA-Z0-9_\-]+)?\.?/gi, ' ');
  text = text.replace(/(?:Về|About|ID)-[a-zA-Z0-9_\-]+\.?/gi, ' ');
  text = text.replace(/[a-zA-Z0-9_\-]+-ok-[0-9/]+-chars\.?/gi, ' ');
  text = text.replace(/平衡-[^\s.,!?]+/gi, ' ');

  // 5. Strip character count, length limits, and OK verification notes
  // e.g. "(13 chars) - Limit 16", "(13 chars)", "- Limit 16", "(OK)", "(Correction: ...)"
  text = text.replace(/\([0-9]+\s*chars?\s*-\s*Limit\s*[0-9]+\)/gi, '');
  text = text.replace(/\([0-9]+\s*chars?\)/gi, '');
  text = text.replace(/-\s*Limit\s*[0-9]+/gi, '');
  text = text.replace(/\bLimit\s*[0-9]+\b/gi, '');
  text = text.replace(/\b[0-9]+\/[0-9]+\s*chars?\b/gi, '');
  text = text.replace(/\([a-zA-Z0-9_\-]*\s*ok\s*[a-zA-Z0-9_\-]*\)/gi, '');
  text = text.replace(/\[\s*ok\s*\]/gi, '');
  text = text.replace(/\(Correction:[^)]*\)/gi, '');
  text = text.replace(/\(OK\)/gi, '');
  text = text.replace(/->\s*[^.,!?]+/gi, '');

  // 6. Strip Chinese notes / bracketed explanations when target is Vietnamese/English
  text = text.replace(/[（(【\[](?:注|Note|Ghi chú|Lưu ý)[^）)】\]]*[）)】\]]/gi, '');

  // 7. Normalize multi-spaces & dangling punctuation from removed tokens
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[.,;:!?\-–—\s]+/, '').trim();
  text = text.replace(/[.,;:!?\-–—\s]+$/, (match) => match.trim());

  // 8. Deduplicate identical duplicated phrases/sentences caused by reflection loops
  // e.g. "Này chú em, cầm lấy. Này chú em, cầm lấy." -> "Này chú em, cầm lấy."
  text = deduplicateRepeatedPhrases(text);

  return text.trim();
}

/**
 * Deduplicates exact repeated consecutive sentences or halves
 */
export function deduplicateRepeatedPhrases(text: string): string {
  if (!text || text.length < 4) return text;

  // Check if string is formed by repeating the exact same sentence 2 or more times
  // e.g. "Này chú em, cầm lấy. Này chú em, cầm lấy."
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length >= 2) {
    const uniqueSentences: string[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const curr = sentences[i];
      const prev = uniqueSentences[uniqueSentences.length - 1];
      if (!prev || prev.toLowerCase() !== curr.toLowerCase()) {
        uniqueSentences.push(curr);
      }
    }
    text = uniqueSentences.join(' ');
  }

  // Check if string is split into 2 identical halves without terminal punctuation
  // e.g. "Hello world Hello world"
  const len = text.length;
  if (len >= 6) {
    const half = Math.floor(len / 2);
    for (let offset = -2; offset <= 2; offset++) {
      const splitIdx = half + offset;
      if (splitIdx > 2 && splitIdx < len - 2) {
        const left = text.substring(0, splitIdx).trim();
        const right = text.substring(splitIdx).trim();
        if (left && right && left.toLowerCase() === right.toLowerCase()) {
          return left;
        }
      }
    }
  }

  return text;
}
