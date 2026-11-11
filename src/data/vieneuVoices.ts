export interface VieNeuVoice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'bac' | 'trung' | 'nam';
  style: string;
  description: string;
  recommended?: boolean;
  isCustom?: boolean;
  speakerEmb?: number[];
  codes?: number[][];
}

/**
  * Official VieNeu-TTS v3 Turbo Voice Presets
  * Mapped 1:1 with keys in models/voices_v3_turbo.json
  */
export const VIENEU_VOICES: VieNeuVoice[] = [
  // --- Giọng Nam (Male Voices) ---
  {
    id: 'Minh Đức',
    name: 'Minh Đức',
    gender: 'male',
    accent: 'bac',
    style: 'Tin tức & Thời sự',
    description: 'Nam miền Bắc, truyền cảm, dõng dạc, chuyên tin tức và review',
    recommended: true,
  },
  {
    id: 'Phạm Tuyên',
    name: 'Phạm Tuyên',
    gender: 'male',
    accent: 'bac',
    style: 'Trầm ấm & Truyền cảm',
    description: 'Nam miền Bắc, chất giọng trầm ấm, đọc truyện & thuyết minh',
    recommended: true,
  },
  {
    id: 'Thái Sơn',
    name: 'Thái Sơn',
    gender: 'male',
    accent: 'bac',
    style: 'Dõng dạc & Phóng sự',
    description: 'Nam miền Bắc, phát thanh viên chững chạc, tư liệu & phóng sự',
  },
  {
    id: 'Xuân Vĩnh',
    name: 'Xuân Vĩnh',
    gender: 'male',
    accent: 'bac',
    style: 'Trẻ trung & Tự nhiên',
    description: 'Nam miền Bắc trẻ, giọng đọc tự nhiên như trò chuyện',
  },
  {
    id: 'Thanh Bình',
    name: 'Thanh Bình',
    gender: 'male',
    accent: 'bac',
    style: 'Điềm tĩnh & Nhẹ nhàng',
    description: 'Nam miền Bắc, giọng đọc điềm đạm, suy ngẫm & triết lý',
  },
  {
    id: 'Minh Triết',
    name: 'Minh Triết',
    gender: 'male',
    accent: 'bac',
    style: 'Tri thức & Sách nói',
    description: 'Nam miền Bắc, chất giọng trí tuệ, đọc sách & chia sẻ kiến thức',
  },
  {
    id: 'Mạnh Dũng',
    name: 'Mạnh Dũng',
    gender: 'male',
    accent: 'bac',
    style: 'Trầm sâu & Nam tính',
    description: 'Nam miền Bắc giọng rất trầm, nam tính, phóng sự tài liệu',
  },
  {
    id: 'Quang Sơn',
    name: 'Quang Sơn',
    gender: 'male',
    accent: 'nam',
    style: 'Hào sảng & Phóng khoáng',
    description: 'Nam miền Nam, hào sảng, phong cách du lịch & ẩm thực',
    recommended: true,
  },
  {
    id: 'Đức Trí',
    name: 'Đức Trí',
    gender: 'male',
    accent: 'nam',
    style: 'Hiện đại & Review',
    description: 'Nam miền Nam, tự tin, review công nghệ & sản phẩm',
  },
  {
    id: 'Minh Quân',
    name: 'Minh Quân',
    gender: 'male',
    accent: 'nam',
    style: 'Ấm áp & Thân thiện',
    description: 'Nam miền Nam, chất giọng ấm, kể chuyện & trò chuyện',
  },
  {
    id: 'Anh Khôi',
    name: 'Anh Khôi',
    gender: 'male',
    accent: 'nam',
    style: 'Sôi nổi & Quảng cáo',
    description: 'Nam miền Nam, năng động, thu hút, lồng tiếng TVC & Shorts',
  },
  {
    id: 'Adam',
    name: 'Adam',
    gender: 'male',
    accent: 'bac',
    style: 'Song ngữ & Tiếng Anh',
    description: 'Giọng Nam phát âm Tiếng Anh chuẩn & từ ngữ quốc tế',
  },

  // --- Giọng Nữ (Female Voices) ---
  {
    id: 'Mai Anh',
    name: 'Mai Anh',
    gender: 'female',
    accent: 'bac',
    style: 'Truyền cảm & Trong trẻo',
    description: 'Nữ miền Bắc, trong trẻo, thích hợp đọc truyện, vlog & blog',
    recommended: true,
  },
  {
    id: 'Ngọc Huyền',
    name: 'Ngọc Huyền',
    gender: 'female',
    accent: 'bac',
    style: 'Review phim & Kể chuyện',
    description: 'Nữ miền Bắc, lôi cuốn, chuyên review phim & tóm tắt kịch bản',
    recommended: true,
  },
  {
    id: 'Trúc Ly',
    name: 'Trúc Ly',
    gender: 'female',
    accent: 'bac',
    style: 'Ngọt ngào & Dịu dàng',
    description: 'Nữ miền Bắc, giọng đọc ngọt ngào, tâm sự & hướng dẫn',
  },
  {
    id: 'Ngọc Linh',
    name: 'Ngọc Linh',
    gender: 'female',
    accent: 'bac',
    style: 'Tươi tắn & Năng động',
    description: 'Nữ miền Bắc, tươi tắn, năng lượng cao, hợp video giải trí',
  },
  {
    id: 'Đoan Trang',
    name: 'Đoan Trang',
    gender: 'female',
    accent: 'bac',
    style: 'Sâu lắng & Cảm xúc',
    description: 'Nữ miền Bắc sâu lắng, diễn cảm, đọc thơ & truyện ngắn',
  },
  {
    id: 'Thục Đoan',
    name: 'Thục Đoan',
    gender: 'female',
    accent: 'bac',
    style: 'Dịu dàng & Nhẹ nhàng',
    description: 'Nữ miền Bắc, dịu dàng, phát thanh văn học & thơ ca',
  },
  {
    id: 'Thùy Dung',
    name: 'Thùy Dung',
    gender: 'female',
    accent: 'bac',
    style: 'Phát thanh viên tin tức',
    description: 'Nữ miền Bắc chuẩn đài truyền hình, tự nhiên, gãy gọn',
  },
  {
    id: 'Ngọc Trân',
    name: 'Ngọc Trân',
    gender: 'female',
    accent: 'nam',
    style: 'Sắc sảo & Năng động',
    description: 'Nữ miền Nam, chất giọng sắc sảo, tự tin, hợp tin tức & Shorts',
    recommended: true,
  },
  {
    id: 'Mỹ Duyên',
    name: 'Mỹ Duyên',
    gender: 'female',
    accent: 'nam',
    style: 'Duyên dáng & Giải trí',
    description: 'Nữ miền Nam duyên dáng, đáng yêu, hợp clip hài & đời sống',
  },
  {
    id: 'Quỳnh Anh',
    name: 'Quỳnh Anh',
    gender: 'female',
    accent: 'nam',
    style: 'Trẻ trung & TikTok/Shorts',
    description: 'Nữ miền Nam trẻ, bắt trend, cuốn hút cho video ngắn',
  },
  {
    id: 'Kim Thanh',
    name: 'Kim Thanh',
    gender: 'female',
    accent: 'nam',
    style: 'Ấm áp & Tâm sự',
    description: 'Nữ miền Nam ấm áp, nhẹ nhàng, lắng đọng',
  },
];

const CUSTOM_VOICES_STORAGE_KEY = 'vieneu_custom_cloned_voices';

export function getLocalCustomVoices(): VieNeuVoice[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_VOICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[vieneuVoices] Failed to parse local custom voices:', e);
    return [];
  }
}

export function saveLocalCustomVoice(voice: VieNeuVoice): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalCustomVoices();
    const updated = [voice, ...existing.filter((v) => v.id !== voice.id && v.name !== voice.name)];
    localStorage.setItem(CUSTOM_VOICES_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('[vieneuVoices] Failed to save custom voice to localStorage:', e);
  }
}

export function deleteLocalCustomVoice(voiceId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalCustomVoices();
    const updated = existing.filter((v) => v.id !== voiceId && v.name !== voiceId);
    localStorage.setItem(CUSTOM_VOICES_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('[vieneuVoices] Failed to delete custom voice from localStorage:', e);
  }
}

export function getAllVieNeuVoices(): VieNeuVoice[] {
  const custom = getLocalCustomVoices();
  return [...custom, ...VIENEU_VOICES];
}

