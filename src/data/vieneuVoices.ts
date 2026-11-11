export interface VieNeuVoice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'bac' | 'trung' | 'nam';
  style: string;
  description: string;
  recommended?: boolean;
}

export const VIENEU_VOICES: VieNeuVoice[] = [
  // --- Giọng Bắc ---
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
    id: 'Mai Anh',
    name: 'Mai Anh',
    gender: 'female',
    accent: 'bac',
    style: 'Truyền cảm & Nhẹ nhàng',
    description: 'Nữ miền Bắc, trong trẻo, tự nhiên, thích hợp đọc truyện & vlog',
    recommended: true,
  },
  {
    id: 'Mạnh Dũng',
    name: 'Mạnh Dũng',
    gender: 'male',
    accent: 'bac',
    style: 'Trầm ấm & Chững chạc',
    description: 'Nam miền Bắc giọng trầm, nam tính, thích hợp phóng sự tài liệu',
  },
  {
    id: 'Lan Nhi',
    name: 'Lan Nhi',
    gender: 'female',
    accent: 'bac',
    style: 'Tươi tắn & Trẻ trung',
    description: 'Nữ miền Bắc, hoạt bát, tràn đầy năng lượng, phù hợp TikTok Shorts',
  },
  {
    id: 'Tuấn Kiệt',
    name: 'Tuấn Kiệt',
    gender: 'male',
    accent: 'bac',
    style: 'Tự nhiên & Hiện đại',
    description: 'Nam miền Bắc trẻ, tự nhiên như trò chuyện hàng ngày',
  },
  {
    id: 'Phương Trang',
    name: 'Phương Trang',
    gender: 'female',
    accent: 'bac',
    style: 'Ngọt ngào & Sâu lắng',
    description: 'Nữ miền Bắc sâu lắng, cảm xúc, hợp sách nói và tâm sự',
  },

  // --- Giọng Nam ---
  {
    id: 'Gia Huy',
    name: 'Gia Huy',
    gender: 'male',
    accent: 'nam',
    style: 'Năng động & Thân thiện',
    description: 'Nam miền Nam, chất giọng ấm, phóng khoáng, review ẩm thực & du lịch',
    recommended: true,
  },
  {
    id: 'Thảo My',
    name: 'Thảo My',
    gender: 'female',
    accent: 'nam',
    style: 'Dễ thương & Duyên dáng',
    description: 'Nữ miền Nam, chất giọng dễ thương, thu hút, hợp video giải trí',
    recommended: true,
  },
  {
    id: 'Quốc Bảo',
    name: 'Quốc Bảo',
    gender: 'male',
    accent: 'nam',
    style: 'Thuyết minh điện ảnh',
    description: 'Nam miền Nam chuẩn phim truyền hình & lồng tiếng kịch bản',
  },
  {
    id: 'Bích Ngọc',
    name: 'Bích Ngọc',
    gender: 'female',
    accent: 'nam',
    style: 'Chuyên nghiệp & Chuẩn mực',
    description: 'Nữ miền Nam, phát thanh viên đài truyền hình, tự nhiên mạch lạc',
  },
  {
    id: 'Hoàng Nam',
    name: 'Hoàng Nam',
    gender: 'male',
    accent: 'nam',
    style: 'Hài hước & Gần gũi',
    description: 'Nam miền Nam dí dỏm, phong cách kể chuyện lôi cuốn',
  },
  {
    id: 'Khánh Vy',
    name: 'Khánh Vy',
    gender: 'female',
    accent: 'nam',
    style: 'Hiện đại & Tự tin',
    description: 'Nữ miền Nam sắc sảo, năng động, hợp tin công nghệ và chia sẻ',
  },

  // --- Giọng Miền Trung & Đặc biệt ---
  {
    id: 'Thanh Thảo',
    name: 'Thanh Thảo',
    gender: 'female',
    accent: 'trung',
    style: 'Dịu dàng xứ Huế',
    description: 'Nữ miền Trung (Huế), ngọt ngào, êm đềm, đọc thơ và câu chuyện xưa',
  },
  {
    id: 'Văn Phong',
    name: 'Văn Phong',
    gender: 'male',
    accent: 'trung',
    style: 'Hào sảng miền Trung',
    description: 'Nam miền Trung rắn rỏi, chân thực, biểu cảm phong phú',
  },
];
