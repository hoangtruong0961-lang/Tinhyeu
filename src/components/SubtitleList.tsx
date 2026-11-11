import React, { useState } from 'react';
import {
  List,
  Search,
  Play,
  Volume2,
  Trash2,
  Plus,
  Edit3,
  Check,
  X,
  Sparkles,
  ArrowUpDown,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { SubtitleItem } from '../types';
import { formatTimeShort } from '../utils/srtParser';

interface SubtitleListProps {
  subtitles: SubtitleItem[];
  currentTime: number;
  onSeekToTime: (time: number) => void;
  onUpdateSubtitle: (updated: SubtitleItem) => void;
  onDeleteSubtitle: (id: string) => void;
  onAddSubtitle: (time?: number) => void;
  onClearAll: () => void;
  onPlayTTS: (text: string) => void;
  onReTranslateAll: () => void;
  isTranslatingBatch: boolean;
  translationProgressMsg?: string;
  onNormalizeSubtitles?: () => void;
  onAiRefineSubtitles?: () => void;
  onReScanSubtitle?: (sub: SubtitleItem) => void;
}

interface SubtitleCardProps {
  sub: SubtitleItem;
  isActive: boolean;
  isEditing: boolean;
  editForm: Partial<SubtitleItem>;
  onSeekToTime: (time: number) => void;
  onUpdateSubtitle: (updated: SubtitleItem) => void;
  onDeleteSubtitle: (id: string) => void;
  onPlayTTS: (text: string) => void;
  onReScanSubtitle?: (sub: SubtitleItem) => void;
  onSetStartToPlayhead: (sub: SubtitleItem) => void;
  onSetEndToPlayhead: (sub: SubtitleItem) => void;
  startEditing: (sub: SubtitleItem) => void;
  cancelEditing: () => void;
  saveEditing: () => void;
  setEditForm: (form: Partial<SubtitleItem>) => void;
}

const SubtitleCard: React.FC<SubtitleCardProps> = React.memo(
  ({
    sub,
    isActive,
    isEditing,
    editForm,
    onSeekToTime,
    onUpdateSubtitle,
    onDeleteSubtitle,
    onPlayTTS,
    onReScanSubtitle,
    onSetStartToPlayhead,
    onSetEndToPlayhead,
    startEditing,
    cancelEditing,
    saveEditing,
    setEditForm,
  }) => {
    return (
      <div
        className={`p-3.5 rounded-xl border transition-all ${
          isActive
            ? 'bg-indigo-950/40 border-indigo-500/60 shadow-lg shadow-indigo-950/50'
            : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
        }`}
      >
        {isEditing ? (
          /* Edit Form Mode */
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-slate-400">Thời gian (s):</span>
              <input
                type="number"
                step="0.1"
                value={editForm.startTime || 0}
                onChange={(e) =>
                  setEditForm({ ...editForm, startTime: parseFloat(e.target.value) || 0 })
                }
                className="w-20 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-200 font-mono"
              />
              <span className="text-slate-500">→</span>
              <input
                type="number"
                step="0.1"
                value={editForm.endTime || 0}
                onChange={(e) =>
                  setEditForm({ ...editForm, endTime: parseFloat(e.target.value) || 0 })
                }
                className="w-20 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">
                Gốc (OCR):
              </label>
              <input
                type="text"
                value={editForm.originalText || ''}
                onChange={(e) => setEditForm({ ...editForm, originalText: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-xs px-2.5 py-1.5 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">
                Bản dịch (Hiển thị &amp; Đọc TTS):
              </label>
              <input
                type="text"
                value={editForm.translatedText || ''}
                onChange={(e) =>
                  setEditForm({ ...editForm, translatedText: e.target.value })
                }
                className="w-full bg-slate-900 border border-slate-700 text-xs px-2.5 py-1.5 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-1">
              <button
                onClick={cancelEditing}
                className="px-2.5 py-1 bg-slate-800 text-slate-300 rounded text-xs hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                onClick={saveEditing}
                className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-500"
              >
                Lưu
              </button>
            </div>
          </div>
        ) : (
          /* Standard Display Mode */
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              {/* Badge Time */}
              <button
                onClick={() => onSeekToTime(sub.startTime)}
                className="flex items-center space-x-1.5 bg-slate-900 hover:bg-indigo-900/50 text-indigo-300 border border-slate-800 px-2.5 py-1 rounded-lg text-[11px] font-mono transition"
                title="Tới thời điểm này trên video"
              >
                <Play className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                <span>
                  {formatTimeShort(sub.startTime)} → {formatTimeShort(sub.endTime)}
                </span>
              </button>

              {/* Line actions & Quick Timeline Alignment */}
              <div className="flex items-center space-x-1 flex-wrap gap-y-1">
                <button
                  onClick={() => onSetStartToPlayhead(sub)}
                  className="text-[10px] bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded transition"
                  title="Gắn mốc bắt đầu đúng vị trí con trỏ video hiện tại"
                >
                  Start=Playhead
                </button>

                <button
                  onClick={() => onSetEndToPlayhead(sub)}
                  className="text-[10px] bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded transition"
                  title="Gắn mốc kết thúc đúng vị trí con trỏ video hiện tại"
                >
                  End=Playhead
                </button>

                <button
                  onClick={() =>
                    onUpdateSubtitle({
                      ...sub,
                      startTime: Number(Math.max(0, sub.startTime - 0.2).toFixed(2)),
                      endTime: Number(Math.max(0.3, sub.endTime - 0.2).toFixed(2)),
                    })
                  }
                  className="text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded transition font-mono"
                  title="Lùi mốc giờ lại 0.2 giây"
                >
                  -0.2s
                </button>

                <button
                  onClick={() =>
                    onUpdateSubtitle({
                      ...sub,
                      startTime: Number((sub.startTime + 0.2).toFixed(2)),
                      endTime: Number((sub.endTime + 0.2).toFixed(2)),
                    })
                  }
                  className="text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded transition font-mono"
                  title="Tăng mốc giờ thêm 0.2 giây"
                >
                  +0.2s
                </button>

                {onReScanSubtitle && (
                  <button
                    onClick={() => onReScanSubtitle(sub)}
                    className="p-1.5 text-slate-400 hover:text-teal-400 hover:bg-slate-900 rounded-lg transition"
                    title="Quét Lại (OCR lại đoạn thời gian này)"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onPlayTTS(sub.translatedText || sub.originalText)}
                  className={`p-1.5 rounded-lg transition ${
                    sub.audioUrl 
                      ? 'text-cyan-400 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30' 
                      : 'text-slate-400 hover:text-amber-400 hover:bg-slate-900'
                  }`}
                  title={sub.audioUrl ? "Đã tạo audio - Bấm để nghe lại" : "Chưa tạo audio - Nghe thử TTS"}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => startEditing(sub)}
                  className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-900 rounded-lg transition"
                  title="Chỉnh sửa"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDeleteSubtitle(sub.id)}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-900 rounded-lg transition"
                  title="Xóa dòng này"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Texts */}
            <div className="space-y-1 pl-1">
              {sub.originalText && (
                <p className="text-xs text-slate-400 italic font-mono bg-slate-900/50 p-1.5 rounded border border-slate-900">
                  Gốc: {sub.originalText}
                </p>
              )}
              <p className="text-xs font-semibold text-slate-100 leading-normal">
                {sub.translatedText || sub.originalText}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.isActive === next.isActive &&
      prev.isEditing === next.isEditing &&
      prev.sub.originalText === next.sub.originalText &&
      prev.sub.translatedText === next.sub.translatedText &&
      prev.sub.startTime === next.sub.startTime &&
      prev.sub.endTime === next.sub.endTime &&
      prev.sub.audioUrl === next.sub.audioUrl &&
      prev.editForm?.startTime === next.editForm?.startTime &&
      prev.editForm?.endTime === next.editForm?.endTime &&
      prev.editForm?.originalText === next.editForm?.originalText &&
      prev.editForm?.translatedText === next.editForm?.translatedText
    );
  }
);

export const SubtitleList: React.FC<SubtitleListProps> = ({
  subtitles,
  currentTime,
  onSeekToTime,
  onUpdateSubtitle,
  onDeleteSubtitle,
  onAddSubtitle,
  onClearAll,
  onPlayTTS,
  onReTranslateAll,
  isTranslatingBatch,
  translationProgressMsg,
  onNormalizeSubtitles,
  onAiRefineSubtitles,
  onReScanSubtitle,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubtitleItem>>({});

  // Keep stable ref for currentTime to prevent child cards from unnecessary re-renders on playhead updates
  const currentTimeRef = React.useRef(currentTime);
  React.useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const handleSetStartToPlayhead = React.useCallback(
    (sub: SubtitleItem) => {
      const t = currentTimeRef.current;
      onUpdateSubtitle({
        ...sub,
        startTime: Number(t.toFixed(2)),
        endTime: Math.max(Number(t.toFixed(2)) + 0.5, sub.endTime),
      });
    },
    [onUpdateSubtitle]
  );

  const handleSetEndToPlayhead = React.useCallback(
    (sub: SubtitleItem) => {
      const t = currentTimeRef.current;
      onUpdateSubtitle({
        ...sub,
        endTime: Math.max(sub.startTime + 0.3, Number(t.toFixed(2))),
      });
    },
    [onUpdateSubtitle]
  );

  // Filter subtitles by search query
  const filteredSubtitles = subtitles.filter(
    (s) =>
      s.originalText.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.translatedText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEditing = (sub: SubtitleItem) => {
    setEditingId(sub.id);
    setEditForm({ ...sub });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEditing = () => {
    if (editingId && editForm) {
      onUpdateSubtitle(editForm as SubtitleItem);
      setEditingId(null);
      setEditForm({});
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-full min-h-[500px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <List className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-bold text-slate-100">
            Danh Sách Phụ Đề Đồng Bộ ({subtitles.length})
          </h2>
        </div>

        {/* Global actions */}
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          <button
            onClick={() => onAddSubtitle(currentTime)}
            className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm</span>
          </button>

          {onNormalizeSubtitles && (
            <button
              onClick={onNormalizeSubtitles}
              disabled={subtitles.length === 0}
              className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-teal-300 border border-teal-500/30 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition"
              title="Khử đè thời gian & tự động căn chỉnh mốc giờ"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Đồng Bộ Giờ</span>
            </button>
          )}

          {onAiRefineSubtitles && (
            <button
              onClick={onAiRefineSubtitles}
              disabled={subtitles.length === 0 || isTranslatingBatch}
              className="flex items-center space-x-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition shadow-sm"
              title="AI Sàng Lọc: Sửa Lỗi Chính Tả OCR, Lọc Rác & Gộp Câu Trùng"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>AI Lọc Trùng & Sửa Lỗi</span>
            </button>
          )}

          <button
            onClick={onReTranslateAll}
            disabled={subtitles.length === 0 || isTranslatingBatch}
            className={`flex items-center space-x-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition ${
              subtitles.length > 0
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-slate-800/50 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
            title="Dịch lại tất cả bằng Gemini AI"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isTranslatingBatch ? (translationProgressMsg || 'Đang dịch...') : 'Dịch Lại'}</span>
          </button>

          <button
            onClick={onClearAll}
            disabled={subtitles.length === 0}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
            title="Xóa tất cả"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="mt-3 relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
        <input
          type="text"
          placeholder="Tìm kiếm nội dung phụ đề..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Subtitles Scrollable List */}
      <div className="mt-4 flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[550px]">
        {filteredSubtitles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-center">
            <Clock className="w-10 h-10 mb-2 opacity-40 text-indigo-400" />
            <p className="text-xs font-medium text-slate-400">Chưa có phụ đề nào được tạo</p>
            <p className="text-[11px] text-slate-500 max-w-xs mt-1">
              Bấm nút "Bóc Tách Khung Hiện Tại" hoặc "Chạy Bóc Tách OCR Tự Động" để tạo phụ đề đồng bộ.
            </p>
          </div>
        ) : (
          filteredSubtitles.map((sub) => {
            const isActive = currentTimeRef.current >= sub.startTime && currentTimeRef.current <= sub.endTime;
            const isEditing = editingId === sub.id;

            return (
              <SubtitleCard
                key={sub.id}
                sub={sub}
                isActive={isActive}
                isEditing={isEditing}
                editForm={editForm}
                onSeekToTime={onSeekToTime}
                onUpdateSubtitle={onUpdateSubtitle}
                onDeleteSubtitle={onDeleteSubtitle}
                onPlayTTS={onPlayTTS}
                onReScanSubtitle={onReScanSubtitle}
                onSetStartToPlayhead={handleSetStartToPlayhead}
                onSetEndToPlayhead={handleSetEndToPlayhead}
                startEditing={startEditing}
                cancelEditing={cancelEditing}
                saveEditing={saveEditing}
                setEditForm={setEditForm}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
