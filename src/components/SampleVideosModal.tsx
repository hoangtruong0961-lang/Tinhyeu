import React, { useState } from 'react';
import { Film, Upload, Link as LinkIcon, X, Check, Play } from 'lucide-react';
import { SAMPLE_VIDEOS } from '../data/sampleVideos';
import { SampleVideo } from '../types';

interface SampleVideosModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSample: (sample: SampleVideo) => void;
  onSelectCustomUrl: (url: string) => void;
  onSelectLocalFile: (file: File) => void;
}

export const SampleVideosModal: React.FC<SampleVideosModalProps> = ({
  isOpen,
  onClose,
  onSelectSample,
  onSelectCustomUrl,
  onSelectLocalFile,
}) => {
  const [customUrl, setCustomUrl] = useState<string>('');

  if (!isOpen) return null;

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim()) {
      onSelectCustomUrl(customUrl.trim());
      onClose();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectLocalFile(file);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Film className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-slate-100">Chọn Nguồn Video Dịch Thuật</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5 overflow-y-auto max-h-[80vh]">
          {/* Upload Local File */}
          <div className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-5 text-center bg-slate-950/40 transition">
            <Upload className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
            <h4 className="text-xs font-semibold text-slate-200 mb-1">Tải video từ máy tính của bạn</h4>
            <p className="text-[11px] text-slate-400 mb-3">Hỗ trợ định dạng MP4, WebM, MOV</p>
            <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition shadow-md inline-block">
              <span>Chọn File Video</span>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {/* Custom URL */}
          <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">Hoặc dán URL Video MP4/WebM trực tiếp:</label>
            <div className="flex space-x-2">
              <input
                type="url"
                placeholder="https://example.com/video.mp4"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-700 transition"
              >
                Mở URL
              </button>
            </div>
          </form>

          {/* Sample Videos List */}
          <div>
            <h4 className="text-xs font-bold text-slate-300 mb-2.5">Hoặc chọn Video Mẫu có sẵn để thử ngay:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_VIDEOS.map((sample) => (
                <div
                  key={sample.id}
                  onClick={() => {
                    onSelectSample(sample);
                    onClose();
                  }}
                  className="bg-slate-950 border border-slate-800 hover:border-indigo-500/80 rounded-xl p-3 cursor-pointer transition flex flex-col justify-between group hover:shadow-lg hover:shadow-indigo-950/40"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                        {sample.language}
                      </span>
                      <Play className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-125 transition-transform" />
                    </div>
                    <h5 className="text-xs font-bold text-slate-100 mb-1 group-hover:text-indigo-300 transition">
                      {sample.title}
                    </h5>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{sample.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
