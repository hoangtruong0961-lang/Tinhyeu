import React, { useState } from 'react';
import {
  ArrowLeft,
  Folder,
  Pencil,
  Globe,
  Sparkles,
  Film,
} from 'lucide-react';
import { AppSettings } from '../types';
import { DownloadForm } from './DownloadForm';
import { DouyinMiniAppDownloader } from './DouyinMiniAppDownloader';

interface MultiPlatformDownloaderViewProps {
  onBack: () => void;
  onCreateProject: (videoUrl: string, title?: string, roi?: any, videoFile?: File) => void;
  appSettings: AppSettings;
  onOpenConfig?: () => void;
  initialTab?: 'standard' | 'miniapp';
}

export const MultiPlatformDownloaderView: React.FC<MultiPlatformDownloaderViewProps> = ({
  onBack,
  onCreateProject,
  initialTab = 'standard',
}) => {
  const [activeTab, setActiveTab] = useState<'standard' | 'miniapp'>(initialTab);
  const [miniappUrl, setMiniappUrl] = useState<string>('');
  const [downloadFolder, setDownloadFolder] = useState<string>('Chưa chọn thư mục (Bấm vào đây để chọn)');

  // Choose folder handler
  const handleSelectFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          setDownloadFolder(`Thư mục: ${dirHandle.name}`);
        }
      } else {
        const customName = prompt('Nhập tên thư mục muốn lưu trữ:', 'Videos_vTranslate');
        if (customName) {
          setDownloadFolder(`Thư mục: ${customName}`);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Directory picker error:', err);
      }
    }
  };

  const handleSwitchToMiniApp = (targetUrl: string) => {
    setMiniappUrl(targetUrl);
    setActiveTab('miniapp');
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in text-slate-100 text-xs pb-10 max-w-5xl mx-auto w-full">
      
      {/* Top Navigation Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800/80 gap-3">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 bg-[#18181c] hover:bg-slate-800 text-slate-200 rounded-full transition border border-slate-800 active:scale-95 cursor-pointer"
            title="Quay lại Trang Chủ"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center space-x-2">
              <Globe className="w-5 h-5 text-sky-400" />
              <span>Trung Tâm Tải Video Đa Nền Tảng</span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Hỗ trợ tải video chất lượng cao từ Douyin, YouTube, TikTok, Bilibili, Facebook, và Douyin Mini-Apps
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[#18181c] p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('standard')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'standard'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Video Đa Nền Tảng</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('miniapp')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'miniapp'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span>Douyin Mini-App (Kịch Ngắn)</span>
            <span className="px-1.5 py-0.2 bg-purple-500/30 text-purple-200 text-[10px] rounded font-bold uppercase tracking-wider">
              Mới
            </span>
          </button>
        </div>
      </div>

      {/* ACTIVE TAB CONTENT */}
      {activeTab === 'miniapp' ? (
        <DouyinMiniAppDownloader
          initialUrl={miniappUrl}
          onSelectForEditing={(videoUrl, title) => onCreateProject(videoUrl, title)}
        />
      ) : (
        <div className="space-y-4">
          <DownloadForm
            onSelectVideoForEditor={(url, title) => onCreateProject(url, title)}
            onSwitchToMiniApp={handleSwitchToMiniApp}
          />

          {/* CARD: THƯ MỤC LƯU TRỮ VIDEO */}
          <div className="bg-metallic-card border-metallic rounded-2xl p-4 shadow-xl space-y-2.5">
            <div className="flex items-center space-x-2">
              <Folder className="w-5 h-5 text-slate-300 fill-slate-300/20" />
              <h2 className="text-sm font-bold text-metallic-silver tracking-wide">
                Thư mục lưu trữ video
              </h2>
            </div>

            <p className="text-xs text-slate-400">
              Vui lòng chọn thư mục để lưu video tải về:
            </p>

            <div
              onClick={handleSelectFolder}
              className="bg-slate-900/80 border border-slate-700/70 rounded-2xl p-3 flex items-center justify-between cursor-pointer hover:border-slate-500 transition"
            >
              <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                <Folder className="w-5 h-5 text-amber-400 fill-amber-400/20 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-200 truncate">
                  {downloadFolder}
                </span>
              </div>
              <Pencil className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </div>
          </div>

          {/* CARD: HƯỚNG DẪN SỬ DỤNG */}
          <div className="bg-metallic-card border-metallic rounded-2xl p-4 shadow-xl space-y-3">
            <div className="text-[11px] font-bold text-metallic-gold uppercase tracking-wider">
              HƯỚNG DẪN SỬ DỤNG
            </div>

            <h3 className="text-sm font-bold text-white">
              Cách tải video đa nền tảng:
            </h3>

            <ol className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
              <li className="flex items-start space-x-2">
                <span className="font-bold text-sky-400 flex-shrink-0">1.</span>
                <span>
                  Mở ứng dụng <strong className="text-slate-100">Douyin, Bilibili, YouTube, Facebook, TikTok, Instagram...</strong> sao chép liên kết (URL) của video bạn muốn tải.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-bold text-sky-400 flex-shrink-0">2.</span>
                <span>
                  Dán liên kết vào ô nhập liệu ở trên.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-bold text-sky-400 flex-shrink-0">3.</span>
                <span>
                  Nhấn nút <strong className="text-slate-100">Lấy Link</strong> để hệ thống tìm các định dạng file tương thích.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-bold text-sky-400 flex-shrink-0">4.</span>
                <span>
                  Chọn định dạng phù hợp (Video có hình, hoặc Audio tách nhạc) và nhấn Tải về hoặc Biên tập.
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

    </div>
  );
};


