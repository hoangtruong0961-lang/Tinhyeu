import React, { useState } from 'react';
import { fetchDownloadLinks } from '../apiService';
import { GenDownloadResponse, SubtitleTrack, VideoMedia } from '../types';
import { Download, Film, Loader2, Play, AlertCircle, Sparkles, ExternalLink, CheckCircle2, MessageSquare, Subtitles } from 'lucide-react';
import { resolveApiUrl } from '../utils/apiUrl';

interface DownloadFormProps {
  onSelectVideoForEditor?: (videoUrl: string, title?: string) => void;
  onSwitchToMiniApp?: (url: string) => void;
}

export const DownloadForm: React.FC<DownloadFormProps> = ({ onSelectVideoForEditor, onSwitchToMiniApp }) => {
  const [inputUrl, setInputUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<GenDownloadResponse | null>(null);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setLoading(true);
    setResult(null);

    const data = await fetchDownloadLinks(inputUrl.trim());
    setResult(data);
    setLoading(false);
  };

  // Helper to separate video vs audio formats
  const videoMedias = result?.medias?.filter(
    (m) => !m.isAudioOnly && m.extension.toLowerCase() !== 'mp3' && !m.quality.toLowerCase().includes('audio')
  ) || [];

  const audioMedias = result?.medias?.filter(
    (m) => m.isAudioOnly || m.extension.toLowerCase() === 'mp3' || m.quality.toLowerCase().includes('audio')
  ) || [];

  // Fallback if filter leaves empty video list
  const displayVideoMedias = videoMedias.length > 0 ? videoMedias : (result?.medias || []);

  // Separate Subtitles into: Official (Chuẩn), Auto (Tự động), and Danmaku (Đạn mạc)
  const officialSubtitles = result?.subtitles?.filter(
    (s) => s.type === 'official' || (!s.isAuto && !s.isDanmaku && !s.name?.toLowerCase().includes('danmaku') && !s.name?.includes('Đạn mạc') && !s.name?.includes('Bình luận bay'))
  ) || [];

  const autoSubtitles = result?.subtitles?.filter(
    (s) => (s.type === 'auto' || s.isAuto) && !s.isDanmaku && !s.name?.toLowerCase().includes('danmaku') && !s.name?.includes('Đạn mạc') && !s.name?.includes('Bình luận bay')
  ) || [];

  const danmakuTracks = result?.subtitles?.filter(
    (s) => s.type === 'danmaku' || s.isDanmaku || s.name?.toLowerCase().includes('danmaku') || s.name?.includes('Đạn mạc') || s.name?.includes('Bình luận bay')
  ) || [];

  return (
    <div className="max-w-xl mx-auto my-3 p-4 sm:p-5 bg-metallic-card border-metallic rounded-2xl shadow-2xl font-sans text-slate-100">
      {/* Form Input URL */}
      <form onSubmit={handleDownload} className="mb-5 space-y-2.5">
        <label className="text-xs font-bold text-metallic-silver uppercase tracking-wider flex items-center space-x-1.5">
          <Film className="w-4 h-4 text-slate-300" />
          <span>Nhập URL Video (TikTok, YouTube, Facebook...)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Dán link video tại đây..."
            className="flex-1 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-400 transition shadow-inner"
          />
          <button
            type="submit"
            disabled={loading || !inputUrl.trim()}
            className="btn-metallic active:scale-95 disabled:opacity-50 text-slate-950 font-black px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5 text-xs flex-shrink-0 shadow-lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Lấy Link</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error Display */}
      {result && !result.success && (
        <div className="space-y-2 mb-4">
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{result.error || 'Không thể lấy link tải video.'}</span>
          </div>

          {inputUrl.includes('microapp') || inputUrl.includes('iesdouyin.com') ? (
            <div className="p-3.5 bg-purple-950/40 border border-purple-500/40 text-purple-200 rounded-xl text-xs space-y-2.5 animate-fade-in">
              <p className="font-bold flex items-center space-x-1.5 text-purple-300">
                <span>💡 Phát hiện liên kết Tiểu Trình Tự Douyin (Mini-App Kịch Ngắn)</span>
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Đường dẫn bạn vừa dán là thẻ Mini-App của Douyin (như 星语超前点播, 星斗漫故事, 怪脑魔方). Dùng công cụ bóc tách chuyên biệt để lấy trọn bộ toàn bộ các tập phim!
              </p>
              {onSwitchToMiniApp && (
                <button
                  type="button"
                  onClick={() => onSwitchToMiniApp(inputUrl.trim())}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>⚡ Mở Ngay Bằng Trình Bóc Tách Mini-App</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Result UI matching screenshot */}
      {result && result.success && (
        <div className="space-y-4 animate-fade-in">
          {/* Badge: KẾT QUẢ PHÂN TÍCH */}
          <div className="text-[11px] font-bold text-[#0088ff] uppercase tracking-wider">
            KẾT QUẢ PHÂN TÍCH
          </div>

          {/* Media Header Info Card */}
          <div className="bg-[#1a1b20] border border-slate-800 rounded-xl p-3 flex space-x-3 items-center">
            {/* Thumbnail with central play button overlay */}
            <div className="relative w-28 h-20 bg-gradient-to-br from-slate-900 to-indigo-950 rounded-lg overflow-hidden flex-shrink-0 border border-slate-800 flex items-center justify-center">
              {result.thumbnail ? (
                <img
                  src={result.thumbnail}
                  alt="Thumbnail"
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : null}
              <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-[#0088ff] flex items-center justify-center shadow-lg shadow-sky-500/30 text-white">
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                </div>
              </div>
            </div>

            {/* Video Details */}
            <div className="flex-1 min-w-0 space-y-1">
              <h3 className="text-xs sm:text-sm font-bold text-white leading-snug line-clamp-2">
                {result.title || 'Video Tải Từ Link'}
              </h3>
              <p className="text-[11px] text-slate-400 line-clamp-1">
                Nguồn: <span className="text-slate-300 font-medium">{result.source || 'ONLINE'}</span>
                {result.author && <span> · {result.author}</span>}
              </p>
              <p className="text-[11px] text-slate-400">
                {result.duration && <span>Thời lượng: {result.duration}</span>}
                {result.views && <span> · {result.views}</span>}
              </p>
            </div>
          </div>

          {/* Section: BẢN VIDEO (Có hình & tiếng) */}
          {displayVideoMedias.length > 0 && (
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-bold text-slate-200">
                BẢN VIDEO (Có hình & tiếng)
              </h4>
              <div className="space-y-2">
                {displayVideoMedias.map((media, index) => {
                  const safeTitle = (result.title || 'video')
                    .replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9.\-_]/gi, '_')
                    .trim()
                    .substring(0, 80);
                  const filename = `${safeTitle}_${media.quality.replace(/\s+/g, '_')}.${media.extension || 'mp4'}`;
                  const streamUrl = media.directUrl ? resolveApiUrl(media.directUrl) : resolveApiUrl(`/api/proxy-video?url=${encodeURIComponent(media.url)}`);
                  const downloadUrl = resolveApiUrl(`/api/download-media?pageUrl=${encodeURIComponent(inputUrl.trim())}&formatId=${encodeURIComponent(media.formatId || '')}&filename=${encodeURIComponent(filename)}&fallbackUrl=${encodeURIComponent(media.url)}`);

                  return (
                    <div
                      key={index}
                      className="bg-[#18191e] border border-slate-800/90 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">
                          {media.quality.includes('p') || media.quality.includes('MP4')
                            ? media.quality
                            : `${media.quality} (${media.extension.toUpperCase()})`}
                        </div>
                        {media.size && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{media.size}</div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        {onSelectVideoForEditor && (
                          <button
                            type="button"
                            onClick={() => onSelectVideoForEditor(streamUrl, result.title)}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition border border-slate-700 active:scale-95 cursor-pointer"
                          >
                            Biên Tập
                          </button>
                        )}
                        <a
                          href={downloadUrl}
                          download={filename}
                          className="bg-[#0088ff] hover:bg-sky-400 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition flex items-center space-x-1 shadow-md active:scale-95 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải về</span>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section: BẢN AUDIO (Chỉ âm thanh) */}
          {audioMedias.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-slate-200">
                BẢN AUDIO (Chỉ âm thanh)
              </h4>
              <div className="space-y-2">
                {audioMedias.map((media, index) => {
                  const safeTitle = (result.title || 'audio')
                    .replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9.\-_]/gi, '_')
                    .trim()
                    .substring(0, 80);
                  const filename = `${safeTitle}_Audio.${media.extension || 'mp3'}`;
                  const streamUrl = media.directUrl ? resolveApiUrl(media.directUrl) : resolveApiUrl(`/api/proxy-video?url=${encodeURIComponent(media.url)}`);
                  const downloadUrl = resolveApiUrl(`/api/download-media?pageUrl=${encodeURIComponent(inputUrl.trim())}&audioOnly=1&filename=${encodeURIComponent(filename)}&fallbackUrl=${encodeURIComponent(media.url)}`);

                  return (
                    <div
                      key={index}
                      className="bg-[#18191e] border border-slate-800/90 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">
                          {media.quality.toLowerCase().includes('audio') ? media.quality : `Audio (${media.extension.toUpperCase()})`}
                        </div>
                        {media.size && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{media.size}</div>
                        )}
                      </div>

                      <a
                        href={downloadUrl}
                        download={filename}
                        className="bg-[#0088ff] hover:bg-sky-400 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition flex items-center space-x-1 shadow-md active:scale-95 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải về</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section: KHI VIDEO CHƯA CÓ PHỤ ĐỀ GỐC HOẶC CHỈ CÓ ĐẠN MẠC */}
          {officialSubtitles.length === 0 && autoSubtitles.length === 0 && (
            <div className="bg-gradient-to-r from-indigo-950/50 via-slate-900/90 to-sky-950/50 border border-sky-500/40 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-start space-x-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-inner">
                  <Sparkles className="w-5 h-5 text-sky-400" />
                </div>
                <div className="flex-1 space-y-1">
                  <h4 className="text-xs font-bold text-sky-200 flex items-center space-x-1.5">
                    <span>Chưa có phụ đề lời thoại từ kênh gốc (Chỉ có Video, Âm thanh & Đạn mạc)</span>
                  </h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Tác giả/chủ kênh video này chưa tải lên file phụ đề CC chuẩn. Bạn có thể bấm nút bên dưới để hệ thống <strong className="text-white">AI Gemini Speech-to-Text</strong> tự động nghe âm thanh, nhận diện giọng nói và tạo file phụ đề tiếng Việt chuẩn xác!
                  </p>
                </div>
              </div>

              {onSelectVideoForEditor && (
                <button
                  type="button"
                  onClick={() => {
                    const streamUrl = displayVideoMedias[0]?.directUrl || displayVideoMedias[0]?.url || '';
                    if (streamUrl) {
                      onSelectVideoForEditor(streamUrl, result.title);
                    }
                  }}
                  className="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-black py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition shadow-lg shadow-sky-900/30 active:scale-98 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-white animate-pulse" />
                  <span>🎙️ Tự Động Tạo & Dịch Phụ Đề Bằng AI (Gemini Auto-Subtitles)</span>
                </button>
              )}
            </div>
          )}

          {/* Section 1: PHỤ ĐỀ CHUẨN (--write-subs / Lời thoại gốc do Uploader đăng tải) */}
          {officialSubtitles.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center space-x-1.5">
                    <span>PHỤ ĐỀ CHUẨN (Lời Thoại Gốc / CC)</span>
                    <span className="text-[9px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded font-mono font-normal">
                      --write-subs
                    </span>
                  </h4>
                </div>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                  {officialSubtitles.length} ngôn ngữ chuẩn
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Phụ đề lời thoại nhân vật do chủ kênh tải lên hệ thống (<code className="text-emerald-400 text-[10px]">yt-dlp --write-subs</code>). Tự động chuyển đổi sang chuẩn <strong className="text-slate-200">.SRT</strong> để dịch hoặc chèn vào video.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {officialSubtitles.map((sub, index) => {
                  const srtDownloadUrl = sub.downloadUrl ? resolveApiUrl(sub.downloadUrl) : resolveApiUrl(`/api/proxy-subtitle?url=${encodeURIComponent(sub.url)}&lang=${encodeURIComponent(sub.lang)}&type=official`);
                  return (
                    <div
                      key={index}
                      className="bg-[#151e18] border border-emerald-900/60 rounded-xl p-2.5 flex items-center justify-between hover:border-emerald-700/80 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-semibold text-emerald-200 truncate flex items-center space-x-1">
                          <span>{sub.name || sub.lang}</span>
                        </div>
                        <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-mono flex items-center space-x-1">
                          <span>SRT · {sub.lang}</span>
                          <span className="text-[9px] text-emerald-500/80 font-mono">(--write-subs)</span>
                        </div>
                      </div>

                      <a
                        href={srtDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        download={`sub_${sub.lang}.srt`}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg text-[11px] transition flex items-center space-x-1 flex-shrink-0 shadow"
                        title="Tải phụ đề chuẩn định dạng SRT"
                      >
                        <Download className="w-3 h-3" />
                        <span>Tải SRT</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: PHỤ ĐỀ TỰ ĐỘNG (--write-auto-subs / AI CC) */}
          {autoSubtitles.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Subtitles className="w-4 h-4 text-sky-400" />
                  <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wide flex items-center space-x-1.5">
                    <span>PHỤ ĐỀ TỰ ĐỘNG (AI Auto CC)</span>
                    <span className="text-[9px] bg-sky-950/80 text-sky-300 border border-sky-500/40 px-1.5 py-0.5 rounded font-mono font-normal">
                      --write-auto-subs
                    </span>
                  </h4>
                </div>
                <span className="text-[10px] text-sky-400 font-normal">{autoSubtitles.length} ngôn ngữ</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Phụ đề do hệ thống tự động nhận dạng giọng nói ASR (<code className="text-sky-400 text-[10px]">yt-dlp --write-auto-subs</code>).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {autoSubtitles.map((sub, index) => {
                  const srtDownloadUrl = sub.downloadUrl ? resolveApiUrl(sub.downloadUrl) : resolveApiUrl(`/api/proxy-subtitle?url=${encodeURIComponent(sub.url)}&lang=${encodeURIComponent(sub.lang)}&type=auto`);
                  return (
                    <div
                      key={index}
                      className="bg-[#18191e] border border-slate-800/90 rounded-xl p-2.5 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-semibold text-slate-200 truncate">
                          {sub.name || sub.lang}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                          SRT · {sub.lang}
                        </div>
                      </div>

                      <a
                        href={srtDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        download={`sub_${sub.lang}_auto.srt`}
                        className="bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 font-bold px-2.5 py-1 rounded-lg text-[11px] transition flex items-center space-x-1 flex-shrink-0"
                      >
                        <Download className="w-3 h-3" />
                        <span>Tải SRT</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 3: ĐẠN MẠC (Danmaku / Bình luận người xem) */}
          {danmakuTracks.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <MessageSquare className="w-4 h-4 text-amber-400" />
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                    ĐẠN MẠC (Danmaku - Bình Luận Người Xem)
                  </h4>
                </div>
                <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">
                  {danmakuTracks.length} luồng đạn mạc
                </span>
              </div>
              <p className="text-[11px] text-amber-300/80">
                Lưu ý: Đây là văn bản bình luận bay của người xem trên màn hình (không phải lời thoại nhân vật).
              </p>
              <div className="grid grid-cols-1 gap-2">
                {danmakuTracks.map((sub, index) => {
                  const srtDanmakuUrl = resolveApiUrl(`/api/proxy-subtitle?url=${encodeURIComponent(sub.url)}&lang=danmaku&type=danmaku`);
                  return (
                    <div
                      key={index}
                      className="bg-[#201c15] border border-amber-900/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-amber-700/70 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-semibold text-amber-200 truncate">
                          {sub.name || 'Bình Luận Đạn Mạc (Danmaku)'}
                        </div>
                        <div className="text-[10px] text-amber-400/70 uppercase tracking-wider font-mono flex items-center space-x-1.5 mt-0.5">
                          <span>{sub.ext?.toUpperCase() || 'XML'} · Hỗ trợ xuất SRT</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <a
                          href={srtDanmakuUrl}
                          target="_blank"
                          rel="noreferrer"
                          download={`danmaku_${sub.lang || 'comments'}.srt`}
                          className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-2.5 py-1.5 rounded-lg text-[11px] transition flex items-center space-x-1 shadow cursor-pointer"
                          title="Tự động chuyển đổi XML sang chuẩn phụ đề SRT"
                        >
                          <Download className="w-3 h-3" />
                          <span>Xuất SRT</span>
                        </a>

                        <a
                          href={sub.downloadUrl || sub.url}
                          target="_blank"
                          rel="noreferrer"
                          download={`danmaku_${sub.lang || 'comments'}.${sub.ext || 'xml'}`}
                          className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-900/60 font-medium px-2.5 py-1.5 rounded-lg text-[11px] transition flex items-center space-x-1"
                          title="Tải file XML gốc"
                        >
                          <span>XML Gốc</span>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer attribution */}
          <div className="text-center pt-3 border-t border-slate-800/60">
            <span className="text-[11px] text-slate-500">
              Công nghệ tải đa nền tảng tốc độ cao hỗ trợ YouTube 4K/8K, TikTok, Douyin, Facebook, Bilibili & hơn 1800+ trang web.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
