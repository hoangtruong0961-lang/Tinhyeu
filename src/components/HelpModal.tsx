import React from 'react';
import { HelpCircle, X, Crop, Sparkles, Languages, CheckCircle2 } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-slate-100">Hướng Dẫn Sử Dụng BachTranslate</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs text-slate-300 leading-relaxed overflow-y-auto max-h-[75vh]">
          <div className="flex items-start space-x-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="bg-amber-500/20 text-amber-400 p-2 rounded-lg font-bold">1</div>
            <div>
              <h4 className="font-bold text-slate-100 mb-0.5">Chọn Vùng Phụ Đề OCR Khung Hình</h4>
              <p className="text-slate-400 text-[11px]">
                Kéo thả khung chữ nhật màu vàng trên màn hình video tới đúng vùng xuất hiện phụ đề (thường ở 20% phía dưới video) để đảm bảo bóc tách chính xác nhất.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="bg-indigo-500/20 text-indigo-400 p-2 rounded-lg font-bold">2</div>
            <div>
              <h4 className="font-bold text-slate-100 mb-0.5">Chọn AI Model & Ngôn Ngữ Dịch</h4>
              <p className="text-slate-400 text-[11px]">
                Mặc định sử dụng model <strong>Gemini 3.6 Flash</strong> cho tốc độ xử lý nhanh & chính xác. Bạn có thể chọn ngôn ngữ đích mong muốn (Tiếng Việt, Tiếng Anh, Nhật, Hàn, Trung...).
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="bg-emerald-500/20 text-emerald-400 p-2 rounded-lg font-bold">3</div>
            <div>
              <h4 className="font-bold text-slate-100 mb-0.5">Quét OCR Tự Động Toàn Đoạn</h4>
              <p className="text-slate-400 text-[11px]">
                Bấm nút "Chạy Bóc Tách OCR Tự Động". Hệ thống sẽ trích xuất chữ theo từng khung hình, tự động ghép các khung giống nhau thành phụ đề hoàn chỉnh có mốc thời gian bắt đầu & kết thúc.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="bg-cyan-500/20 text-cyan-400 p-2 rounded-lg font-bold">4</div>
            <div>
              <h4 className="font-bold text-slate-100 mb-0.5">Che Phụ Đề Gốc & Xuất File SRT</h4>
              <p className="text-slate-400 text-[11px]">
                Bật tính năng "Che phụ đề gốc" để phủ lớp nền đè lên chữ cũ trong video. Sau khi xong, tải về file <strong>.srt</strong> hoặc <strong>.vtt</strong> để ghép vào video.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
