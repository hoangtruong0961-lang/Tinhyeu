import React, { useState, useRef, useEffect } from 'react';
import {
  Film,
  Play,
  Download,
  Scissors,
  Sparkles,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Key,
  Layers,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Clock,
  CheckCircle2,
  CheckSquare,
  Square,
  ListFilter,
  Sliders,
  Terminal,
  StopCircle,
  FileCheck,
} from 'lucide-react';
import {
  analyzeDouyinHandoffSeriesApi,
  resolveDouyinHandoffMediaApi,
  createDirectSessionApi,
  createGuestAutoSessionApi,
} from '../services/apiService';

interface DouyinMiniAppDownloaderProps {
  onSelectForEditing: (videoUrl: string, title: string) => void;
  initialUrl?: string;
}

interface EpisodeItem {
  episode: number;
  videoId: number;
  title: string;
  durationSeconds: number;
  access: 'free' | 'paid' | 'unpaid';
  previewSeconds: number;
  mediaUrl?: string;
}

interface SeriesAnalysisResult {
  adapter: string;
  appId: string;
  appName: string;
  title: string;
  totalEpisodes: number;
  currentEpisode: number;
  coverUrl?: string;
  descriptor?: {
    appId: string;
    appName: string;
    route: string;
    seriesId: number;
    videoId: number;
    episode: number;
    seriesTitle: string;
    coverUrl?: string;
    appVersion?: string;
  };
  episodes: EpisodeItem[];
}

interface BatchDownloadStatus {
  isRunning: boolean;
  isCancelled: boolean;
  total: number;
  doneCount: number;
  failedCount: number;
  activeWorkers: number;
  progressPercent: number;
  currentMessage: string;
  logs: string[];
  downloadedFiles: { episode: number; title: string; url: string }[];
}

export const DouyinMiniAppDownloader: React.FC<DouyinMiniAppDownloaderProps> = ({
  onSelectForEditing,
  initialUrl = '',
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SeriesAnalysisResult | null>(null);

  // Session state
  const [sessionToken, setSessionToken] = useState<string>('');
  const [showSessionConfig, setShowSessionConfig] = useState(false);
  const [customCookieInput, setCustomCookieInput] = useState('');
  const [sessionStatus, setSessionStatus] = useState<'guest' | 'custom' | 'ready'>('ready');

  // Resolving single video state
  const [resolvingEpisode, setResolvingEpisode] = useState<number | null>(null);
  const [resolvedMedia, setResolvedMedia] = useState<{
    episode: number;
    url: string;
    title: string;
  } | null>(null);

  // Pagination for episodes
  const [activeRange, setActiveRange] = useState<number>(0); // 0 = 1-25, 1 = 26-50...

  // Multi-Selection state (matches VutuyenTools / Launcher V17 batch toolbar)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set());
  const [workersCount, setWorkersCount] = useState<number>(2);

  // Batch Download State
  const [batchStatus, setBatchStatus] = useState<BatchDownloadStatus>({
    isRunning: false,
    isCancelled: false,
    total: 0,
    doneCount: 0,
    failedCount: 0,
    activeWorkers: 0,
    progressPercent: 0,
    currentMessage: '',
    logs: [],
    downloadedFiles: [],
  });

  const cancelBatchRef = useRef<boolean>(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Quick Samples
  const sampleLinks = [
    {
      name: '星语超前点播 (Xingyu)',
      appId: 'ttea779cca741307d601',
      version: '0.0.1',
      link: 'https://www.iesdouyin.com/share/microapp/?token=RDA5NzU3QzE1MkFBNzZqcWZkMDZl&share_channel=copy',
    },
    {
      name: '星斗漫故事 (Xingdou)',
      appId: 'tt21fb5746bef109ff01',
      version: '1.52.2',
      link: 'https://www.iesdouyin.com/share/microapp/?token=RjMwMEIzODI1QkE2NzZqcDNxcHRx&share_channel=copy',
    },
    {
      name: '小果繁星 (Xiaoguo)',
      appId: 'tt48293e94d71caebe01',
      version: '3.9.41',
      link: 'https://www.iesdouyin.com/share/microapp/?token=tt48293e94d71caebe01_sample&share_channel=copy',
    },
  ];

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [batchStatus.logs]);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('vi-VN');
    setBatchStatus((prev) => ({
      ...prev,
      logs: [...prev.logs.slice(-200), `[${timestamp}] ${msg}`],
    }));
  };

  const handleApplySample = (sampleUrl: string) => {
    setUrl(sampleUrl);
    setError(null);
  };

  const handleSaveCustomSession = async () => {
    if (!customCookieInput.trim()) {
      setError('Vui lòng nhập mã sessionid_ss hoặc token Douyin của bạn.');
      return;
    }
    setLoading(true);
    try {
      const res = await createDirectSessionApi(customCookieInput.trim(), 'user_custom');
      if (res.success && res.downloadSession) {
        setSessionToken(res.downloadSession);
        setSessionStatus('custom');
        setShowSessionConfig(false);
        setError(null);
      } else {
        setError('Không thể kích hoạt phiên. Hãy kiểm tra lại chuỗi cookie.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi lưu phiên Douyin.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetToGuestSession = async () => {
    setLoading(true);
    try {
      const res = await createGuestAutoSessionApi();
      if (res.success && res.downloadSession) {
        setSessionToken(res.downloadSession);
        setSessionStatus('guest');
        setCustomCookieInput('');
        setShowSessionConfig(false);
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi đặt lại phiên.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!url.trim()) {
      setError('Vui lòng dán liên kết chia sẻ Tiểu Trình Tự (Douyin Mini-App).');
      return;
    }

    setLoading(true);
    setError(null);
    setResolvedMedia(null);
    setSelectedEpisodes(new Set());

    try {
      const res = await analyzeDouyinHandoffSeriesApi(sessionToken, url.trim());
      if (res.success) {
        setAnalysis(res);
        setActiveRange(0);
        // Default select all episodes
        setSelectedEpisodes(new Set(res.episodes.map((e: EpisodeItem) => e.episode)));
      } else {
        setError(res.error || 'Không thể bóc tách dữ liệu từ link Mini-App.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Lỗi khi kết nối với hệ thống bóc tách kịch ngắn Douyin.');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveEpisode = async (ep: EpisodeItem, autoAction?: 'edit' | 'download' | 'preview') => {
    if (!analysis) return;
    setResolvingEpisode(ep.episode);
    setError(null);

    try {
      const seriesId = analysis.descriptor?.seriesId || 0;
      const res = await resolveDouyinHandoffMediaApi(
        sessionToken,
        seriesId,
        ep.episode,
        ep.videoId,
        analysis.appId
      );

      if (res.success && res.url) {
        setResolvedMedia({
          episode: ep.episode,
          url: res.url,
          title: ep.title || `${analysis.title} - Tập ${ep.episode}`,
        });

        if (autoAction === 'edit') {
          onSelectForEditing(res.url, ep.title || `${analysis.title} - Tập ${ep.episode}`);
        } else if (autoAction === 'download') {
          const a = document.createElement('a');
          a.href = res.url;
          a.download = `${analysis.title}_Tap_${String(ep.episode).padStart(2, '0')}.mp4`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } else {
        setError(res.error || `Không thể lấy luồng video tập ${ep.episode}.`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || `Lỗi bóc tách luồng tập ${ep.episode}.`);
    } finally {
      setResolvingEpisode(null);
    }
  };

  // --- BATCH SELECTION HELPERS (Matching Reference Python Toolbar) ---
  const handleSelectAll = () => {
    if (!analysis) return;
    setSelectedEpisodes(new Set(analysis.episodes.map((e) => e.episode)));
  };

  const handleSelectFullUnlocked = () => {
    if (!analysis) return;
    // Bypass: all episodes considered FULL
    setSelectedEpisodes(new Set(analysis.episodes.map((e) => e.episode)));
  };

  const handleSelectPreviewOnly = () => {
    if (!analysis) return;
    const previewList = analysis.episodes
      .filter((e) => e.access === 'unpaid' || e.previewSeconds > 0)
      .map((e) => e.episode);
    setSelectedEpisodes(new Set(previewList.length > 0 ? previewList : [1, 2, 3]));
  };

  const handleClearSelection = () => {
    setSelectedEpisodes(new Set());
  };

  const toggleEpisodeSelect = (epNum: number) => {
    const next = new Set(selectedEpisodes);
    if (next.has(epNum)) {
      next.delete(epNum);
    } else {
      next.add(epNum);
    }
    setSelectedEpisodes(next);
  };

  // --- MULTI-THREADED BATCH DOWNLOAD ENGINE ---
  const handleStartBatchDownload = async () => {
    if (!analysis || selectedEpisodes.size === 0 || batchStatus.isRunning) return;

    const episodesToDownload = analysis.episodes
      .filter((e) => selectedEpisodes.has(e.episode))
      .sort((a, b) => a.episode - b.episode);

    if (episodesToDownload.length === 0) return;

    cancelBatchRef.current = false;
    setBatchStatus({
      isRunning: true,
      isCancelled: false,
      total: episodesToDownload.length,
      doneCount: 0,
      failedCount: 0,
      activeWorkers: workersCount,
      progressPercent: 0,
      currentMessage: `Bắt đầu tải ${episodesToDownload.length} tập bằng ${workersCount} luồng...`,
      logs: [],
      downloadedFiles: [],
    });

    addLog(`Bắt đầu hàng đợi ${episodesToDownload.length} tập • ${workersCount} luồng • Bypass Full`);

    const seriesTitle = analysis.title || analysis.appName || 'Douyin';
    const seriesId = analysis.descriptor?.seriesId || 0;
    const appId = analysis.appId;

    const queue = [...episodesToDownload];
    const downloaded: { episode: number; title: string; url: string }[] = [];
    let done = 0;
    let failed = 0;

    const worker = async (workerId: number) => {
      while (queue.length > 0 && !cancelBatchRef.current) {
        const ep = queue.shift();
        if (!ep) break;

        const epTitle = `${seriesTitle} - Tập ${String(ep.episode).padStart(2, '0')}`;
        addLog(`[Luồng ${workerId}] Tập ${ep.episode}: Bắt đầu bóc tách & lấy luồng FULL...`);

        try {
          const res = await resolveDouyinHandoffMediaApi(
            sessionToken,
            seriesId,
            ep.episode,
            ep.videoId,
            appId
          );

          if (cancelBatchRef.current) break;

          if (res.success && res.url) {
            downloaded.push({
              episode: ep.episode,
              title: epTitle,
              url: res.url,
            });
            done++;
            addLog(`[Luồng ${workerId}] Tập ${ep.episode}: Đã lấy link stream FULL thành công!`);

            // Trigger direct download
            const a = document.createElement('a');
            a.href = res.url;
            a.download = `${epTitle}.mp4`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } else {
            failed++;
            addLog(`[Luồng ${workerId}] Tập ${ep.episode}: Lỗi — ${res.error || 'Không lấy được luồng video'}`);
          }
        } catch (err: any) {
          failed++;
          addLog(`[Luồng ${workerId}] Tập ${ep.episode}: Lỗi mạng — ${err.message}`);
        }

        const pct = Math.round(((done + failed) / episodesToDownload.length) * 100);
        setBatchStatus((prev) => ({
          ...prev,
          doneCount: done,
          failedCount: failed,
          progressPercent: pct,
          currentMessage: `Đang tải tập ${ep.episode} (${done}/${episodesToDownload.length} tập)`,
          downloadedFiles: [...downloaded],
        }));

        // Small spacing between requests to be gentle with upstream
        await new Promise((r) => setTimeout(r, 400));
      }
    };

    const workerPromises = Array.from({ length: Math.min(workersCount, episodesToDownload.length) }).map(
      (_, idx) => worker(idx + 1)
    );

    await Promise.all(workerPromises);

    const isCancelled = cancelBatchRef.current;
    addLog(
      isCancelled
        ? `Đã dừng hàng đợi tải. Hoàn tất: ${done}/${episodesToDownload.length} tập.`
        : `Hoàn tất toàn bộ: ${done} thành công, ${failed} lỗi trong tổng số ${episodesToDownload.length} tập.`
    );

    setBatchStatus((prev) => ({
      ...prev,
      isRunning: false,
      isCancelled,
      currentMessage: isCancelled ? 'Đã hủy tải hàng loạt' : 'Hoàn tất tải toàn bộ tập đã chọn!',
      downloadedFiles: [...downloaded],
    }));
  };

  const handleCancelBatchDownload = () => {
    cancelBatchRef.current = true;
    addLog('Đang yêu cầu dừng các luồng tải...');
    setBatchStatus((prev) => ({
      ...prev,
      currentMessage: 'Đang hủy hàng đợi tải...',
    }));
  };

  // Episode range slicing
  const episodesPerTab = 25;
  const totalEpisodes = analysis?.episodes.length || 0;
  const totalTabs = Math.ceil(totalEpisodes / episodesPerTab);
  const currentEpisodes = analysis
    ? analysis.episodes.slice(activeRange * episodesPerTab, (activeRange + 1) * episodesPerTab)
    : [];

  const selectedCount = selectedEpisodes.size;

  return (
    <div id="douyin-mini-app-downloader" className="space-y-6 animate-fade-in">
      {/* Mini App Supported Badges */}
      <div className="bg-[#18181c]/90 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/70">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>Bóc Tách Tiểu Trình Tự Douyin (Mini-App Kịch Ngắn)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Hỗ trợ tự động nhận diện metadata, bypass full tất cả tập phim và tải hàng loạt đa luồng về máy
            </p>
          </div>

          {/* Session Indicator */}
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Phiên DouyinPhien: UID 1910298425165403</span>
            </span>
            <button
              type="button"
              onClick={() => setShowSessionConfig(!showSessionConfig)}
              className="px-3 py-1.5 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800/40 text-purple-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <Key className="w-3.5 h-3.5 text-purple-400" />
              <span>Tùy chỉnh</span>
              {showSessionConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Supported Mini Apps List */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 text-[11px] font-medium">Hỗ trợ ưu tiên:</span>
          <span className="px-2.5 py-1 bg-sky-950/50 text-sky-300 border border-sky-800/40 rounded-md font-mono text-[11px] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
            星语超前点播 (ttea779cca741307d601)
          </span>
          <span className="px-2.5 py-1 bg-amber-950/50 text-amber-300 border border-amber-800/40 rounded-md font-mono text-[11px] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            星斗漫故事 (tt21fb5746bef109ff01)
          </span>
          <span className="px-2.5 py-1 bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 rounded-md font-mono text-[11px]">
            小果繁星 (tt48293e94d71caebe01)
          </span>
          <span className="px-2.5 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded-md font-mono text-[11px]">
            怪脑魔方 (tt0abe7c0395b0a48101)
          </span>
        </div>

        {/* Collapsible Session Configuration Drawer */}
        {showSessionConfig && (
          <div className="mt-4 p-3.5 bg-black/40 border border-slate-800 rounded-xl space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Cấu hình Phiên Ủy Quyền Douyin</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Bạn có thể dán cookie <code className="text-purple-300 font-mono">sessionid_ss=...</code>, chuỗi Cookie header, hoặc dán trực tiếp nội dung văn bản của file <code className="text-purple-300 font-mono">ttnetCookieStore.xml</code>.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customCookieInput}
                onChange={(e) => setCustomCookieInput(e.target.value)}
                placeholder="Dán sessionid_ss=... hoặc nội dung ttnetCookieStore.xml"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-purple-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCustomCookieInput('sessionid=a8e9d1361f4069df67f6b4977d990f61; sessionid_ss=a8e9d1361f4069df67f6b4977d990f61; passport_csrf_token=bc1ed3b037464d180effb6b4ac6401af; odin_tt=508f7f7bb8d158fcc476a200dbb56e36c86e9c31353ac20e74bd0159b8f57f304344794b9f5e113419e873e82f6d99ef8850e54a84f1b5beb569b01c143a6b0554967720776020e19b0f641531ad4f9f; d_ticket=cc5ee97c28189edc2ec708ee0889c0c3a6b0e; uid_tt=4d9dc40e6021a95344112a737c9d8aef; uid_tt_ss=4d9dc40e6021a95344112a737c9d8aef');
                  }}
                  className="px-3 py-2 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 rounded-lg transition text-xs cursor-pointer"
                >
                  Nạp Mặc Định DouyinPhien
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustomSession}
                  disabled={loading}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition cursor-pointer"
                >
                  Áp Dụng
                </button>
                <button
                  type="button"
                  onClick={handleResetToGuestSession}
                  disabled={loading}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                >
                  Đặt Lại
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Input Card */}
      <div className="bg-[#18181c]/90 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-md space-y-4">
        <div>
          <label htmlFor="douyin-share-url-input" className="block text-xs font-semibold text-slate-300 mb-2">
            Đường Dẫn Chia Sẻ Tiểu Trình Tự Douyin (Share Link / Mini-App URL):
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                id="douyin-share-url-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                placeholder="Dán link https://www.iesdouyin.com/share/microapp/?token=... hoặc v.douyin.com/..."
                className="w-full px-3.5 py-2.5 bg-[#0e0e11] border border-slate-700/80 focus:border-purple-500 text-white text-xs sm:text-sm rounded-xl outline-none placeholder:text-slate-500 transition shadow-inner"
              />
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading || !url.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang Bóc Tách...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Bóc Tách Bộ Kịch</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Sample Link Buttons */}
        <div className="pt-1 flex flex-wrap items-center gap-2">
          <span className="text-slate-400 text-xs">Mẫu thử nghiệm nhanh:</span>
          {sampleLinks.map((sample, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleApplySample(sample.link)}
              className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3 text-purple-400" />
              <span>{sample.name}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-red-200 text-xs flex items-start gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-300">Lỗi bóc tách:</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Analysis Results View */}
      {analysis && (
        <div className="space-y-5 animate-fade-in">
          {/* Series Overview Header Card */}
          <div className="bg-[#18181c]/90 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-md">
            <div className="flex flex-col sm:flex-row gap-5">
              {/* Cover poster */}
              {analysis.coverUrl ? (
                <div className="w-24 sm:w-28 h-32 sm:h-36 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shrink-0 shadow">
                  <img
                    src={analysis.coverUrl}
                    alt={analysis.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-24 sm:w-28 h-32 sm:h-36 rounded-xl bg-purple-950/30 border border-purple-800/40 flex items-center justify-center shrink-0">
                  <Film className="w-8 h-8 text-purple-400/60" />
                </div>
              )}

              {/* Series Info */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-md font-semibold text-[11px]">
                    {analysis.appName}
                  </span>
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded-md text-[11px] font-mono">
                    Series CID: {analysis.descriptor?.seriesId || 'N/A'}
                  </span>
                  <span className="px-2 py-0.5 bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 rounded-md text-[11px] font-medium">
                    {analysis.totalEpisodes} Tập Phim
                  </span>
                  <span className="px-2 py-0.5 bg-sky-950/40 text-sky-300 border border-sky-800/40 rounded-md text-[11px] font-medium">
                    Bypass FULL (Tất cả tập)
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-bold text-white tracking-wide truncate">
                  {analysis.title}
                </h3>

                <p className="text-xs text-slate-400 line-clamp-2">
                  Link gốc: <span className="font-mono text-slate-500">{analysis.descriptor?.route || 'detail'}</span>
                </p>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-slate-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Tập chia sẻ: <strong>Tập {analysis.currentEpisode}</strong></span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const cur = analysis.episodes.find((e) => e.episode === analysis.currentEpisode) || analysis.episodes[0];
                      if (cur) handleResolveEpisode(cur, 'edit');
                    }}
                    disabled={resolvingEpisode !== null}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Mở Ngay Tập {analysis.currentEpisode} Vào Editor</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Active Preview Player if an episode is resolved */}
          {resolvedMedia && (
            <div className="bg-[#18181c]/90 border border-purple-500/40 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3 animate-fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs sm:text-sm font-bold text-white">
                    Đang xem trước: {resolvedMedia.title}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectForEditing(resolvedMedia.url, resolvedMedia.title)}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Đưa Vào Editor</span>
                  </button>
                  <a
                    href={resolvedMedia.url}
                    download={`${resolvedMedia.title}.mp4`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải Về</span>
                  </a>
                </div>
              </div>
              <div className="aspect-video max-w-xl mx-auto rounded-xl overflow-hidden bg-black border border-slate-800">
                <video
                  src={resolvedMedia.url}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* BATCH DOWNLOAD TOOLBAR (Matching VutuyenTools / Launcher V17) */}
          <div className="bg-[#18181c]/90 border border-purple-800/50 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Batch Filter Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mr-1">
                  <ListFilter className="w-3.5 h-3.5 text-purple-400" />
                  <span>Bộ chọn:</span>
                </span>
                <button
                  type="button"
                  onClick={handleSelectFullUnlocked}
                  className="px-3 py-1.5 bg-purple-900/40 hover:bg-purple-800/60 border border-purple-700/50 text-purple-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  FULL
                </button>
                <button
                  type="button"
                  onClick={handleSelectPreviewOnly}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
                >
                  Xem thử
                </button>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
                >
                  Tất cả
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
                >
                  Bỏ chọn
                </button>

                <span className="ml-2 text-xs font-mono text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-md border border-purple-800/40">
                  Đã chọn: <strong>{selectedCount}</strong> / {analysis.totalEpisodes} tập
                </span>
              </div>

              {/* Workers & Main Download Button */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Sliders className="w-3.5 h-3.5 text-slate-400" />
                  <span>Luồng:</span>
                  <select
                    value={workersCount}
                    onChange={(e) => setWorkersCount(Number(e.target.value))}
                    disabled={batchStatus.isRunning}
                    className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none"
                  >
                    <option value={1}>1 luồng</option>
                    <option value={2}>2 luồng</option>
                    <option value={3}>3 luồng</option>
                    <option value={4}>4 luồng</option>
                  </select>
                </div>

                {batchStatus.isRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelBatchDownload}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-red-900/30"
                  >
                    <StopCircle className="w-4 h-4" />
                    <span>Dừng Tải</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartBatchDownload}
                    disabled={selectedCount === 0}
                    className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-purple-900/40"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {selectedCount === 0
                        ? 'CHỌN TẬP CẦN TẢI'
                        : selectedCount === 1
                        ? `TẢI TẬP ${Array.from(selectedEpisodes)[0]} • FULL (ĐÃ MỞ KHÓA)`
                        : `TẢI ${selectedCount} TẬP ĐÃ CHỌN • FULL`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Batch Progress Bar and Status */}
            {batchStatus.isRunning && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                    <span>{batchStatus.currentMessage}</span>
                  </span>
                  <span className="font-mono text-purple-300 font-bold">
                    {batchStatus.progressPercent}% ({batchStatus.doneCount}/{batchStatus.total} tập)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all duration-300"
                    style={{ width: `${batchStatus.progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Real-time Analysis Logs Console (Similar to Python Tkinter Log) */}
            {batchStatus.logs.length > 0 && (
              <div className="bg-black/60 border border-slate-800/90 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 pb-1 border-b border-slate-800">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-purple-300">
                    <Terminal className="w-3.5 h-3.5 text-purple-400" />
                    <span>Nhật ký phân tích & luồng tải Douyin</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {batchStatus.doneCount} hoàn tất / {batchStatus.failedCount} lỗi
                  </span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300 pr-1">
                  {batchStatus.logs.map((log, index) => (
                    <div
                      key={index}
                      className={
                        log.includes('Lỗi') || log.includes('error')
                          ? 'text-red-400'
                          : log.includes('thành công') || log.includes('Hoàn tất')
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>

          {/* Episodes List Section */}
          <div className="bg-[#18181c]/90 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <h4 className="text-sm font-bold text-white">
                  Danh Sách Tập Phim ({analysis.totalEpisodes} Tập)
                </h4>
              </div>

              {/* Range Tabs (e.g. 1-25, 26-50...) */}
              {totalTabs > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from({ length: totalTabs }).map((_, idx) => {
                    const start = idx * episodesPerTab + 1;
                    const end = Math.min((idx + 1) * episodesPerTab, totalEpisodes);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveRange(idx)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                          activeRange === idx
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Tập {start} - {end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Episode Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {currentEpisodes.map((ep) => {
                const isSelectedForBatch = selectedEpisodes.has(ep.episode);
                const isResolving = resolvingEpisode === ep.episode;
                const isCurrentShared = ep.episode === analysis.currentEpisode;

                return (
                  <div
                    key={ep.episode}
                    className={`p-3 rounded-xl border transition flex flex-col justify-between gap-2.5 ${
                      isSelectedForBatch
                        ? 'bg-purple-950/30 border-purple-500/60 shadow-sm'
                        : isCurrentShared
                        ? 'bg-slate-900/60 border-purple-500/40'
                        : 'bg-[#121215] border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {/* Checkbox for batch selection */}
                        <button
                          type="button"
                          onClick={() => toggleEpisodeSelect(ep.episode)}
                          className="mt-0.5 text-purple-400 hover:text-purple-300 transition cursor-pointer"
                        >
                          {isSelectedForBatch ? (
                            <CheckSquare className="w-4 h-4 text-purple-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-xs sm:text-sm">
                              Tập {ep.episode}
                            </span>
                            {isCurrentShared && (
                              <span className="px-1.5 py-0.2 bg-purple-500/30 text-purple-300 text-[10px] rounded font-medium">
                                Link gốc
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {ep.title}
                          </p>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded shrink-0 bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                        FULL
                      </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                      <button
                        type="button"
                        onClick={() => handleResolveEpisode(ep, 'preview')}
                        disabled={isResolving}
                        className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                        title="Xem trước tập phim"
                      >
                        {isResolving ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3 text-purple-400" />
                        )}
                        <span>Xem</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleResolveEpisode(ep, 'download')}
                        disabled={isResolving}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs transition cursor-pointer"
                        title="Tải tập phim về máy"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-400" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleResolveEpisode(ep, 'edit')}
                        disabled={isResolving}
                        className="px-2.5 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded-lg text-xs font-medium transition flex items-center gap-1 cursor-pointer"
                        title="Đưa vào CapCut Editor để dịch và lồng tiếng"
                      >
                        <Scissors className="w-3 h-3 text-purple-300" />
                        <span>Biên Tập</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
