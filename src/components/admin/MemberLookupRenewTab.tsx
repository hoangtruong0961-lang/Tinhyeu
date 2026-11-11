import React, { useState } from 'react';
import {
  Search,
  Zap,
  Crown,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  Mail,
  Smartphone,
  ShieldCheck,
  Sparkles,
  Copy,
  Check,
  X,
  RefreshCw,
  Plus,
  RotateCcw,
  Sliders,
  ShieldAlert,
  Globe
} from 'lucide-react';
import {
  lookupMemberInFirestore,
  renewOrExtendMemberInFirestore,
  resetMemberDevicesInFirestore,
  revokeUserVipInFirestore,
  CloudUserProfileRecord
} from '../../services/firebaseLicenseService';

interface MemberLookupRenewTabProps {
  onSelectForAdjust?: (member: CloudUserProfileRecord) => void;
  initialQuery?: string;
}

export const MemberLookupRenewTab: React.FC<MemberLookupRenewTabProps> = ({
  onSelectForAdjust,
  initialQuery = ''
}) => {
  const [queryText, setQueryText] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState<CloudUserProfileRecord | null>(null);
  const [searched, setSearched] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState('7');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!queryText.trim()) return;

    setSearching(true);
    setStatusMsg(null);
    try {
      const res = await lookupMemberInFirestore(queryText.trim());
      setMember(res);
      setSearched(true);
      if (!res) {
        setStatusMsg({
          type: 'error',
          text: `Không tìm thấy tài khoản với mã/email: "${queryText}". Bạn có thể cấp quyền trực tiếp bằng cách chọn gói bên dưới!`
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Lỗi tra cứu: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setSearching(false);
    }
  };

  const handleAction = async (
    action: 'extend_trial' | 'pro_lifetime' | 'pro_month' | 'pro_quarter' | 'pro_year',
    days?: number
  ) => {
    const target = member ? member.uid : queryText.trim();
    if (!target) {
      setStatusMsg({ type: 'error', text: 'Vui lòng nhập Mã thành viên hoặc Email trước khi thao tác.' });
      return;
    }

    setActionLoading(true);
    setActiveAction(action);
    setStatusMsg(null);
    try {
      const res = await renewOrExtendMemberInFirestore({
        targetUidOrCode: target,
        action,
        customDays: days || (action === 'extend_trial' ? parseInt(customDays) || 7 : undefined)
      });

      if (res.success && res.user) {
        setMember(res.user);
        setStatusMsg({ type: 'success', text: res.message });
      } else {
        setStatusMsg({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Lỗi thực hiện: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setActionLoading(false);
      setActiveAction(null);
    }
  };

  const handleResetDevices = async () => {
    if (!member) return;
    if (!confirm(`Xóa toàn bộ liên kết thiết bị cho ${member.displayName || member.memberCode}?`)) return;

    setActionLoading(true);
    setActiveAction('reset_devices');
    setStatusMsg(null);
    try {
      const res = await resetMemberDevicesInFirestore(member.uid);
      if (res.success) {
        setMember({ ...member, boundDevices: [] });
        setStatusMsg({ type: 'success', text: res.message });
      } else {
        setStatusMsg({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Lỗi reset thiết bị: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setActionLoading(false);
      setActiveAction(null);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const now = Date.now();
  const isExpired = member?.expiresAt ? (now > member.expiresAt && member.plan !== 'lifetime' && member.plan !== 'admin') : false;
  const isLifetime = member?.plan === 'lifetime' || member?.plan === 'admin' || member?.role === 'admin';
  const daysLeft = member?.expiresAt ? Math.ceil((member.expiresAt - now) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div id="member-lookup-renew-tab" className="space-y-5">
      {/* 1. TRA CỨU NHANH */}
      <div className="bg-slate-850 border border-slate-750 p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg space-y-3">
        <div>
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-1.5">
            Nhập Mã Thành Viên (MEM-XXXX-XXXX) Hoặc Email Người Dùng
          </label>
          <p className="text-[11px] text-slate-400">
            Hệ thống hỗ trợ tra cứu trực tiếp theo Member Code, Email đăng nhập hoặc UID Firebase.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4 text-amber-400" />
            </div>
            <input
              type="text"
              value={queryText}
              onChange={(e) => {
                setQueryText(e.target.value);
                setSearched(false);
              }}
              placeholder="VD: MEM-A1B2-C3D4 hoặc user@gmail.com"
              className="w-full pl-10 pr-10 py-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
            />
            {queryText && (
              <button
                type="button"
                onClick={() => {
                  setQueryText('');
                  setMember(null);
                  setSearched(false);
                }}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={searching || !queryText.trim()}
            className="py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 active:scale-95 disabled:opacity-50 cursor-pointer min-h-[44px]"
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Đang Tìm...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>Tra Cứu</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* TOAST ALERT */}
      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2.5 animate-in fade-in ${
            statusMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* 2. THẺ HỒ SƠ THÀNH VIÊN HIỆN TẠI (KHI TÌM THẤY) */}
      {member && (
        <div className="bg-gradient-to-br from-slate-850 to-slate-900 border border-amber-500/30 p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div className="flex items-center gap-3">
              {member.photoURL ? (
                <img
                  src={member.photoURL}
                  alt={member.displayName || 'Avatar'}
                  className="w-12 h-12 rounded-2xl object-cover border-2 border-amber-500/40 shadow-lg"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-extrabold text-base shadow-lg">
                  {(member.displayName || member.email || member.memberCode || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-sm sm:text-base text-white">
                    {member.displayName || member.email?.split('@')[0] || 'Thành viên'}
                  </h4>
                  {isLifetime ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide flex items-center gap-1">
                      <Crown className="w-3 h-3 text-amber-400" />
                      <span>LIFETIME VIP</span>
                    </span>
                  ) : member.plan === 'trial' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">
                      DÙNG THỬ
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                      VIP {member.plan}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                  <Mail className="w-3 h-3 text-slate-500" />
                  <span>{member.email}</span>
                </div>
              </div>
            </div>

            {onSelectForAdjust && (
              <button
                type="button"
                onClick={() => onSelectForAdjust(member)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Chỉnh Sửa Chi Tiết</span>
              </button>
            )}
          </div>

          {/* Chi tiết thông số */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">MÃ THÀNH VIÊN</span>
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-300 truncate">{member.memberCode || 'N/A'}</span>
                {member.memberCode && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(member.memberCode!, 'code')}
                    className="text-slate-400 hover:text-white"
                  >
                    {copiedField === 'code' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">THỜI HẠN DÙNG</span>
              <div className="font-bold font-mono">
                {isLifetime ? (
                  <span className="text-amber-300">Vĩnh Viễn</span>
                ) : isExpired ? (
                  <span className="text-rose-400">Đã Hết Hạn</span>
                ) : (
                  <span className="text-emerald-400">Còn {daysLeft} ngày</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">NGÀY HẾT HẠN</span>
              <div className="font-mono text-slate-200 truncate">
                {isLifetime
                  ? 'Vô thời hạn'
                  : member.expiresAt
                  ? new Date(member.expiresAt).toLocaleDateString('vi-VN')
                  : 'N/A'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 block mb-0.5">THIẾT BỊ LIÊN KẾT</span>
                {(member.boundDevices?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={handleResetDevices}
                    disabled={actionLoading}
                    className="text-[10px] text-cyan-400 hover:underline flex items-center gap-0.5"
                    title="Xóa liên kết máy"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
              <div className="font-mono font-bold text-slate-200">
                {member.boundDevices?.length || 0} / {member.maxDevices || 2} máy
              </div>
            </div>
          </div>

          {/* Chi tiết IP & Thiết bị */}
          <div className="mt-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400 text-[11px] font-medium">Địa chỉ IP kết nối:</span>
                <span className="font-mono font-bold text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                  {member.lastIp || member.boundDevices?.[0]?.ip || 'Chưa ghi nhận (Chờ kết nối)'}
                </span>
              </div>
              {member.registeredIp && (
                <div className="text-[11px] text-slate-400">
                  IP Đăng ký: <span className="font-mono text-slate-300">{member.registeredIp}</span>
                </div>
              )}
            </div>

            {member.boundDevices && member.boundDevices.length > 0 && (
              <div className="pt-2 border-t border-slate-800/60 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                  Danh sách máy đã kết nối:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {member.boundDevices.map((dev, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-[11px]">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium text-slate-200 truncate">{dev.deviceName || `Thiết bị #${idx + 1}`}</div>
                        <div className="font-mono text-[10px] text-slate-400 truncate">{dev.deviceId}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-semibold text-cyan-400 text-[10px] bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-900/50 block">
                          {dev.ip || 'Chưa có IP'}
                        </span>
                        <span className="text-[9px] text-slate-400 block mt-0.5">
                          {dev.lastActiveAt ? new Date(dev.lastActiveAt).toLocaleDateString('vi-VN') : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. BẢNG CẤP QUYỀN & GIA HẠN 1-CLICK */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Chọn Gói Cấp Quyền / Gia Hạn Nhanh</span>
          </h4>
          {member && (
            <span className="text-[11px] text-slate-400">
              Đang áp dụng cho: <span className="text-amber-300 font-bold">{member.displayName || member.memberCode || member.email}</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Gói 1 Tháng */}
          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-750 hover:border-emerald-500/50 transition flex flex-col justify-between space-y-3 shadow-md">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-sm text-white">VIP 1 Tháng</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  +30 Ngày
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Kích hoạt hoặc gia hạn thêm 30 ngày đầy đủ mọi tính năng AI Pro.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAction('pro_month')}
              disabled={actionLoading}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-emerald-600 text-emerald-300 hover:text-white font-bold text-xs border border-emerald-500/30 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {actionLoading && activeAction === 'pro_month' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Cấp VIP 1 Tháng</span>
            </button>
          </div>

          {/* Gói 3 Tháng */}
          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-750 hover:border-indigo-500/50 transition flex flex-col justify-between space-y-3 shadow-md">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-sm text-white">VIP 3 Tháng</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  +90 Ngày
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Gói quý phổ biến, gia hạn nhanh chóng cho tài khoản đang chạy.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAction('pro_quarter')}
              disabled={actionLoading}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-indigo-600 text-indigo-300 hover:text-white font-bold text-xs border border-indigo-500/30 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {actionLoading && activeAction === 'pro_quarter' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Cấp VIP 3 Tháng</span>
            </button>
          </div>

          {/* Gói 1 Năm */}
          <div className="p-4 rounded-2xl bg-slate-850 border border-slate-750 hover:border-amber-500/50 transition flex flex-col justify-between space-y-3 shadow-md">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-sm text-white">VIP 1 Năm</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  +365 Ngày
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Gia hạn cả năm cho thành viên gắn bó lâu dài, không lo gián đoạn.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAction('pro_year')}
              disabled={actionLoading}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-amber-600 text-amber-300 hover:text-slate-950 font-bold text-xs border border-amber-500/30 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {actionLoading && activeAction === 'pro_year' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Cấp VIP 1 Năm</span>
            </button>
          </div>

          {/* Gói Vĩnh Viễn */}
          <div className="p-4 rounded-2xl bg-gradient-to-b from-amber-500/10 to-slate-850 border border-amber-500/40 hover:border-amber-400 transition flex flex-col justify-between space-y-3 shadow-lg shadow-amber-500/5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-sm text-amber-300 flex items-center gap-1">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span>VIP Vĩnh Viễn</span>
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  UNLIMITED
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Mở khóa trọn đời mọi bản cập nhật và tính năng cao cấp nhất.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAction('pro_lifetime')}
              disabled={actionLoading}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {actionLoading && activeAction === 'pro_lifetime' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crown className="w-3.5 h-3.5 text-slate-950" />
              )}
              <span>Cấp VIP Vĩnh Viễn</span>
            </button>
          </div>
        </div>

        {/* Cấp Tùy Chỉnh Số Ngày Dùng Thử */}
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-750 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-indigo-400" />
            <div>
              <span className="text-xs font-bold text-white block">Cấp Thêm Số Ngày Dùng Thử Tùy Chỉnh</span>
              <span className="text-[11px] text-slate-400">Gia hạn thêm số ngày cụ thể (VD: 3, 7, 14 ngày)</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              className="w-20 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-center text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => handleAction('extend_trial', parseInt(customDays) || 7)}
              disabled={actionLoading}
              className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
            >
              + {customDays} Ngày
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
