/**
 * VieNeu-TTS v3 Turbo Text Normalization, IPA G2P Dictionary Lookup, and BPE Tokenizer
 * 100% Client-side & Offline compatible for Capacitor Android and Web browser fallback.
 */

export function numberToVietnameseWords(num: number): string {
  if (isNaN(num)) return '';
  if (num === 0) return 'không';

  const units = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  function readGroupThree(n: number, showZeroHundred: boolean = true): string {
    const hundred = Math.floor(n / 100);
    const ten = Math.floor((n % 100) / 10);
    const unit = n % 10;
    let res = '';

    if (hundred > 0 || showZeroHundred) {
      res += `${units[hundred]} trăm`;
    }

    if (ten > 1) {
      res += (res ? ' ' : '') + `${units[ten]} mươi`;
      if (unit === 1) res += ' mốt';
      else if (unit === 5) res += ' lăm';
      else if (unit > 0) res += ` ${units[unit]}`;
    } else if (ten === 1) {
      res += (res ? ' ' : '') + 'mười';
      if (unit === 5) res += ' lăm';
      else if (unit > 0) res += ` ${units[unit]}`;
    } else if (unit > 0) {
      if (res) res += ' lẻ';
      res += ` ${units[unit]}`;
    }

    return res.trim();
  }

  const absNum = Math.abs(num);
  const billion = Math.floor(absNum / 1000000000);
  let remain = absNum % 1000000000;
  const million = Math.floor(remain / 1000000);
  remain %= 1000000;
  const thousand = Math.floor(remain / 1000);
  const groupOne = remain % 1000;

  let result = '';
  if (billion > 0) {
    result += `${numberToVietnameseWords(billion)} tỷ`;
  }
  if (million > 0) {
    const showZero = result.length > 0;
    result += (result ? ' ' : '') + `${readGroupThree(million, showZero)} triệu`;
  }
  if (thousand > 0) {
    const showZero = result.length > 0;
    result += (result ? ' ' : '') + `${readGroupThree(thousand, showZero)} nghìn`;
  }
  if (groupOne > 0 || result.length === 0) {
    const showZero = result.length > 0;
    result += (result ? ' ' : '') + readGroupThree(groupOne, showZero);
  }

  return (num < 0 ? 'âm ' : '') + result.trim();
}

/**
 * Normalizes numbers, decimals, percentages, and common Vietnamese abbreviations in text.
 */
export function normalizeVietnameseText(text: string): string {
  if (!text) return '';
  let normalized = text;

  // Common abbreviations expansion
  const abbrMap: Record<string, string> = {
    'tp.': 'thành phố',
    'tp': 'thành phố',
    'hcm': 'hồ chí minh',
    'hn': 'hà nội',
    'sp': 'sản phẩm',
    'nv': 'nhân viên',
    'vnd': 'đồng',
    'đ': 'đồng',
    'kg': 'ki lô gam',
    'km': 'ki lô mét',
    'cm': 'xen ti mét',
    'mm': 'mi li mét',
    'stt': 'số thứ tự',
    'vd': 'ví dụ',
    'tts': 't t s',
  };

  // Replace percentage %
  normalized = normalized.replace(/(\d+)\s*%/g, (_, p1) => {
    return `${numberToVietnameseWords(parseInt(p1, 10))} phần trăm`;
  });

  // Replace version/letter numbers like v3, v3.0, v12
  normalized = normalized.replace(/\bv(\d+)(?:\.(\d+))?\b/gi, (_, p1, p2) => {
    let res = `v ${numberToVietnameseWords(parseInt(p1, 10))}`;
    if (p2 !== undefined) {
      res += ` chấm ${numberToVietnameseWords(parseInt(p2, 10))}`;
    }
    return res;
  });

  // Replace numbers with 'k' (e.g. 10k -> 10 nghìn)
  normalized = normalized.replace(/(\d+)\s*k\b/gi, (_, p1) => {
    return `${numberToVietnameseWords(parseInt(p1, 10))} nghìn`;
  });

  // Replace decimals (e.g., 3.5 -> ba phẩy năm)
  normalized = normalized.replace(/(\d+)[.,](\d+)/g, (_, p1, p2) => {
    const w1 = numberToVietnameseWords(parseInt(p1, 10));
    const w2 = numberToVietnameseWords(parseInt(p2, 10));
    return `${w1} phẩy ${w2}`;
  });

  // Replace integers
  normalized = normalized.replace(/\b\d+\b/g, (match) => {
    return numberToVietnameseWords(parseInt(match, 10));
  });

  // Replace words matching abbreviations map
  const words = normalized.split(/\s+/);
  const replacedWords = words.map((w) => {
    const lower = w.toLowerCase().replace(/[.,!?;:]$/, '');
    if (abbrMap[lower]) {
      const punct = w.match(/[.,!?;:]$/)?.[0] || '';
      return abbrMap[lower] + punct;
    }
    return w;
  });

  return replacedWords.join(' ');
}

// GPT-2 Standard ByteLevel byte to unicode character mapping
function getBytesToUnicode(): Record<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);

  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }

  const b2u: Record<number, string> = {};
  for (let i = 0; i < bs.length; i++) {
    b2u[bs[i]] = String.fromCharCode(cs[i]);
  }
  return b2u;
}

const b2u = getBytesToUnicode();

function stringToByteLevel(str: string): string {
  const bytes = Buffer.from(str, 'utf-8');
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += b2u[bytes[i]];
  }
  return result;
}

export class VieNeuBPETokenizer {
  private vocab: Record<string, number>;
  private bpeRanks: Map<string, number>;

  constructor(tokenizerJson: any) {
    this.vocab = tokenizerJson.model.vocab;
    this.bpeRanks = new Map();

    const merges: (string | [string, string])[] = tokenizerJson.model.merges;
    merges.forEach((m, idx) => {
      if (typeof m === 'string') {
        const parts = m.split(' ');
        this.bpeRanks.set(`${parts[0]} ${parts[1]}`, idx);
      } else if (Array.isArray(m)) {
        this.bpeRanks.set(`${m[0]} ${m[1]}`, idx);
      }
    });
  }

  private getPairs(word: string[]): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < word.length - 1; i++) {
      pairs.push([word[i], word[i + 1]]);
    }
    return pairs;
  }

  private bpeTokenizeWord(wordStr: string): number[] {
    const blStr = stringToByteLevel(wordStr);
    let word = blStr.split('');
    if (word.length === 0) return [];

    let pairs = this.getPairs(word);
    if (pairs.length === 0) {
      const id = this.vocab[word.join('')];
      return id !== undefined ? [id] : [];
    }

    while (true) {
      let minRank = Infinity;
      let minPair: [string, string] | null = null;

      for (const pair of pairs) {
        const key = `${pair[0]} ${pair[1]}`;
        const rank = this.bpeRanks.get(key);
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minPair = pair;
        }
      }

      if (!minPair || minRank === Infinity) break;

      const [first, second] = minPair;
      const newWord: string[] = [];
      let i = 0;

      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) {
          newWord.push(...word.slice(i));
          break;
        }
        newWord.push(...word.slice(i, j));
        i = j;

        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          newWord.push(first + second);
          i += 2;
        } else {
          newWord.push(word[i]);
          i += 1;
        }
      }

      word = newWord;
      if (word.length === 1) break;
      pairs = this.getPairs(word);
    }

    const resultIds: number[] = [];
    for (const subword of word) {
      if (this.vocab[subword] !== undefined) {
        resultIds.push(this.vocab[subword]);
      }
    }
    return resultIds;
  }

  public encode(text: string): number[] {
    const regex = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
    const matches = text.match(regex) || [text];
    const tokenIds: number[] = [];

    for (const match of matches) {
      if (match) {
        tokenIds.push(...this.bpeTokenizeWord(match));
      }
    }
    return tokenIds;
  }
}

let cachedTokenizer: VieNeuBPETokenizer | null = null;
let cachedG2pDict: Record<string, string> | null = null;

export async function loadVieNeuResources(): Promise<{
  tokenizer: VieNeuBPETokenizer;
  g2pDict: Record<string, string>;
}> {
  if (cachedTokenizer && cachedG2pDict) {
    return { tokenizer: cachedTokenizer, g2pDict: cachedG2pDict };
  }

  try {
    const [tokRes, g2pRes] = await Promise.all([
      fetch('/api/vieneu-models/tokenizer.json'),
      fetch('/api/vieneu-models/vieneu_vi_g2p.json'),
    ]);

    if (tokRes.ok && g2pRes.ok) {
      const tokenizerJson = await tokRes.json();
      const g2pDict = await g2pRes.json();
      cachedTokenizer = new VieNeuBPETokenizer(tokenizerJson);
      cachedG2pDict = g2pDict;
      return { tokenizer: cachedTokenizer, g2pDict };
    }
  } catch (err) {
    console.warn('[VieNeuTextProcessor] Remote model fetch failed, trying local fallback:', err);
  }

  // Fallback: fetch from /models/ directly
  const [tokRes, g2pRes] = await Promise.all([
    fetch('/models/tokenizer.json'),
    fetch('/models/vieneu_vi_g2p.json'),
  ]);

  if (!tokRes.ok || !g2pRes.ok) {
    throw new Error('Không thể nạp tệp tokenizer.json hoặc vieneu_vi_g2p.json từ máy chủ.');
  }

  const tokenizerJson = await tokRes.json();
  const g2pDict = await g2pRes.json();
  cachedTokenizer = new VieNeuBPETokenizer(tokenizerJson);
  cachedG2pDict = g2pDict;
  return { tokenizer: cachedTokenizer, g2pDict };
}

/**
 * Converts raw Vietnamese text into full VieNeu-TTS token IDs array.
 */
export async function convertTextToTokenIds(
  text: string,
  styleId: number = 16
): Promise<number[]> {
  const { tokenizer, g2pDict } = await loadVieNeuResources();

  // 1. Text normalization & abbreviation expansion
  const normalized = normalizeVietnameseText(text);

  // 2. Word-level IPA G2P conversion with punctuation preservation
  const tokensRaw = normalized.toLowerCase().match(/[\p{L}\p{N}']+|[.,!?;:]/gu) || [];
  const words: string[] = [];

  for (const t of tokensRaw) {
    if (['.', ',', '!', '?', ';', ':'].includes(t)) {
      words.push(t);
    } else if (g2pDict[t]) {
      words.push(g2pDict[t]);
    } else {
      words.push(t);
    }
  }

  let phonemes = words.join(' ');
  if (!/[.!?]$/.test(phonemes)) {
    phonemes += ' .';
  }

  // 3. BPE Tokenization
  const phoneIds = tokenizer.encode(phonemes);

  // 4. Wrap with special tokens: [style_id, TEXT_PROMPT_START(3), ...phoneIds, TEXT_PROMPT_END(4)]
  return [styleId, 3, ...phoneIds, 4];
}
