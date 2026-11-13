import React, { useState, useEffect } from 'react';
import {
  Lock,
  Copy,
  Check,
  Headphones,
  RefreshCw,
  Crown,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  MessageCircle,
  Phone,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  LicenseState,
  ensureAndSyncDeviceLicense,
  isWhitelistedAdminMember
} from '../utils/licenseManager';
import { getOrCreateLocalMemberCode, fetchCurrentClientIp } from '../services/firebaseLicenseService';
import { getDeviceFingerprint, DeviceInfo } from '../utils/deviceFingerprint';

interface LockScreenGateProps {
  licenseState: LicenseState | null;
  onOpenAdmin: () => void;
  onLicenseUpdated: (newState: LicenseState) => void;
}

export const LockScreenGate: React.FC<LockScreenGateProps> = ({
  licenseState,
  onOpenAdmin,
  onLicenseUpdated
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [showContactModal, setShowContactModal] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isIpWhitelisted, setIsIpWhitelisted] = useState<boolean>(false);

  useEffect(() => {
    getDeviceFingerprint().then(setDeviceInfo);
    fetchCurrentClientIp().then((res) => {
      if (res.isWhitelisted) {
        setIsIpWhitelisted(true);
      }
    });
  }, []);

  const displayMemberCode =
    licenseState?.memberCode ||
    deviceInfo?.memberCode ||
    (deviceInfo ? getOrCreateLocalMemberCode(deviceInfo.deviceId) : getOrCreateLocalMemberCode());

  const isWhitelistedAdmin =
    isIpWhitelisted ||
    licenseState?.isWhitelistedAdmin === true ||
    licenseState?.isAdmin === true ||
    isWhitelistedAdminMember(licenseState);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(displayMemberCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setActionMessage(null);
    try {
      const updated = await ensureAndSyncDeviceLicense();
      onLicenseUpdated(updated);
      if (updated.isPro || updated.isAdmin) {
        setActionMessage({ text: '✓ Thiết bị của bạn đã được kích hoạt thành công!', isError: false });
      } else {
        setActionMessage({
          text: 'Chưa tìm thấy gói VIP mới trên máy chủ. Vui lòng nhắn Admin cấp thời gian rồi bấm Kiểm tra lại!',
          isError: true
        });
      }
    } catch (err: any) {
      setActionMessage({ text: 'Lỗi đồng bộ: ' + (err?.message || 'Lỗi mạng'), isError: true });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      id="lock-screen-gate"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-[#0e0e11] text-white select-none overflow-y-auto px-4 min-h-[100dvh]"
      style={{
        paddingTop: 'calc(2rem + var(--app-safe-top))',
        paddingBottom: 'calc(2rem + var(--app-safe-bottom))',
        backgroundImage: 'radial-gradient(circle at 50% 28%, rgba(245, 158, 11, 0.18) 0%, rgba(245, 158, 11, 0.04) 35%, rgba(14, 14, 17, 1) 65%)'
      }}
    >
      {/* Top Whitelisted Admin Button if whitelisted */}
      <div className="w-full max-w-sm sm:max-w-md flex justify-end min-h-[32px] pt-1">
        {isWhitelistedAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="px-3 py-1 text-xs font-bold text-amber-400 bg-[#191922] hover:bg-amber-500/20 border border-amber-500/30 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-md animate-in fade-in"
            title="Dành cho Quản trị viên"
          >
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>Quản trị viên</span>
          </button>
        )}
      </div>

      {/* Main Lock Card Container */}
      <div className="w-full max-w-sm sm:max-w-md my-auto flex flex-col items-center text-center space-y-6 py-2">
        {/* Naked Glowing Amber Lock Icon */}
        <div className="relative flex items-center justify-center my-2">
          <div className="absolute w-28 h-28 rounded-full bg-amber-500/20 blur-2xl animate-pulse" />
          <Lock className="relative w-16 h-16 sm:w-20 sm:h-20 text-amber-500 drop-shadow-[0_0_22px_rgba(245,158,11,0.85)] stroke-[2.2]" />
        </div>

        {/* Header Titles */}
        <div className="space-y-2.5 px-2 text-center max-w-xs sm:max-w-sm mx-auto">
          <h1 className="text-2xl sm:text-3xl font-black tracking-wider text-white uppercase">
            YÊU CẦU KÍCH HOẠT
          </h1>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed font-normal">
            Phiên bản dùng thử của bạn đã hết hạn. Vui lòng gửi mã bên dưới cho quản trị viên để mở khóa vĩnh viễn.
          </p>
        </div>

        {/* Member Code Card Box */}
        <div className="w-full bg-[#1c1c22] border border-[#2b2b36] rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 max-w-sm sm:max-w-md">
          <div className="text-center space-y-1.5">
            <span className="text-[11px] sm:text-xs font-bold text-zinc-400 uppercase tracking-widest block">
              MÃ THÀNH VIÊN CỦA BẠN
            </span>
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="font-mono text-2xl sm:text-3xl font-black text-[#00a2ff] tracking-wider select-all break-all">
                {displayMemberCode}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="p-1.5 text-[#00a2ff] hover:text-white transition cursor-pointer shrink-0 active:scale-90"
                title="Sao chép Mã Thành Viên"
              >
                {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
            {copied && (
              <p className="text-[11px] font-semibold text-emerald-400 animate-in fade-in duration-200">
                ✓ Đã sao chép mã thành viên!
              </p>
            )}
          </div>

          {/* Button 1: LIÊN HỆ QUẢN TRỊ VIÊN */}
          <button
            type="button"
            onClick={() => setShowContactModal(true)}
            className="w-full py-3.5 px-4 bg-[#0088ff] hover:bg-[#0077ee] text-white font-extrabold rounded-2xl text-xs sm:text-sm tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#0088ff]/25 active:scale-[0.98] transition cursor-pointer uppercase"
          >
            <Headphones className="w-4.5 h-4.5 stroke-[2.5]" />
            <span>LIÊN HỆ QUẢN TRỊ VIÊN</span>
          </button>

          {/* Quick Realtime Sync Check */}
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="w-full py-2.5 px-3 bg-[#16161c] hover:bg-[#202028] text-zinc-300 border border-[#262632] rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 active:scale-[0.98]"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00a2ff] ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Đang kiểm tra máy chủ...' : 'Đã được cấp quyền? Bấm để kiểm tra lại'}</span>
          </button>

          {/* Action Message Alert if user interacted */}
          {actionMessage && (
            <div
              className={`p-3 rounded-2xl text-xs font-medium flex items-start gap-2 text-left transition animate-in fade-in ${
                actionMessage.isError
                  ? 'bg-[#281318] border border-rose-900/60 text-rose-200'
                  : 'bg-[#0f281b] border border-emerald-900/60 text-emerald-200'
              }`}
            >
              {actionMessage.isError ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{actionMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer info matching image */}
      <div className="w-full text-center py-4 text-zinc-500 text-xs font-medium">
        vTranslate v8.1 Dùng thử
      </div>

      {/* Modal Liên Hệ Quản Trị Viên */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-[#161622] border border-slate-800 rounded-2xl p-5 shadow-2xl text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Headphones className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-white text-sm">Liên Hệ Quản Trị Viên</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Vui lòng gửi <b>Mã Thành Viên</b> cho Quản trị viên qua các kênh bên dưới để được cấp quyền hoặc gia hạn gói VIP nhanh nhất:
            </p>

            <div className="bg-[#0f0f18] p-3 rounded-xl border border-slate-800 text-center space-y-1">
              <span className="text-[10px] text-slate-400 font-bold block">MÃ THÀNH VIÊN CỦA BẠN:</span>
              <span className="font-mono text-base font-black text-sky-400 block select-all">
                {displayMemberCode}
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <a
                href="https://zalo.me"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Nhắn qua Zalo Quản Trị Viên</span>
              </a>

              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Nhắn qua Telegram</span>
              </a>
            </div>

            <button
              type="button"
              onClick={() => setShowContactModal(false)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
