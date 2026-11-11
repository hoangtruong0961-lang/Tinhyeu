import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  Crown,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Shield,
  Smartphone,
  Calendar,
  Lock,
  Trash2,
  Loader2,
  Filter,
  Sliders,
  User,
  Zap,
  Mail,
  Download,
  ShieldAlert,
  ChevronRight,
  RotateCcw,
  ExternalLink,
  Plus,
  Globe
} from 'lucide-react';
import {
  getAllCloudUsersFromFirestore,
  renewOrExtendMemberInFirestore,
  revokeUserVipInFirestore,
  resetMemberDevicesInFirestore,
  CloudUserProfileRecord
} from '../../services/firebaseLicenseService';

interface MemberListTabProps {
  onSelectMemberForAdjust?: (member: CloudUserProfileRecord) => void;
  onOpenLookupRenew?: (memberCodeOrEmail: string) => void;
}

export const MemberListTab: React.FC<MemberListTabProps> = ({
  onSelectMemberForAdjust,
  onOpenLookupRenew
}) => {
  const [members, setMembers] = useState<CloudUserProfileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'lifetime' | 'active_pro' | 'trial' | 'expiring_soon' | 'expired'>('all');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedMember, setSelectedMember] = useState<CloudUserProfileRecord | null>(null);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const list = await getAllCloudUsersFromFirestore();
      setMembers(list);
    } catch (err) {
      console.error('[MemberListTab] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleQuickAction = async (
    member: CloudUserProfileRecord,
    action: 'extend_trial' | 'pro_month' | 'pro_year' | 'pro_lifetime' | 'revoke' | 'reset_devices'
  ) => {
    setActionLoadingId(member.uid);
    setToastMsg(null);
    try {
      if (action === 'revoke') {
        if (!confirm(`Bạn có chắc muốn thu hồi quyền VIP của thành viên: ${member.displayName || member.email || member.memberCode}?`)) {
          setActionLoadingId(null);
          return;
        }
        const res = await revokeUserVipInFirestore(member.uid);
        if (res.success) {
          setToastMsg({ type: 'success', text: res.message });
          await fetchMembers();
        } else {
          setToastMsg({ type: 'error', text: res.message });
        }
      } else if (action === 'reset_devices') {
        if (!confirm(`Xóa toàn bộ liên kết thiết bị của ${member.displayName || member.memberCode}? Người dùng có thể đăng nhập trên máy mới.`)) {
          setActionLoadingId(null);
          return;
        }
        const res = await resetMemberDevicesInFirestore(member.uid);
        if (res.success) {
          setToastMsg({ type: 'success', text: res.message });
          await fetchMembers();
        } else {
          setToastMsg({ type: 'error', text: res.message });
        }
      } else {
        const res = await renewOrExtendMemberInFirestore({
          targetUidOrCode: member.uid,
          action: action as any,
          customDays: action === 'extend_trial' ? 7 : undefined
        });
        if (res.success) {
          setToastMsg({ type: 'success', text: res.message });
          await fetchMembers();
        } else {
          setToastMsg({ type: 'error', text: res.message });
        }
      }
    } catch (err: any) {
      setToastMsg({ type: 'error', text: 'Lỗi: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setActionLoadingId(null);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

  // Analytics Metrics
  const totalMembers = members.length;
  const lifetimeCount = members.filter((m) => m.plan === 'lifetime' || m.plan === 'admin' || m.role === 'admin').length;
  const activeProCount = members.filter((m) => (m.plan === 'month' || m.plan === 'quarter' || m.plan === 'year' || m.role === 'pro') && m.expiresAt && m.expiresAt > now && m.status === 'active').length;
  const trialCount = members.filter((m) => m.plan === 'trial' && (!m.expiresAt || m.expiresAt > now)).length;
  const expiringSoonCount = members.filter((m) => m.expiresAt && m.expiresAt > now && m.expiresAt - now <= threeDaysMs && m.plan !== 'lifetime' && m.plan !== 'admin').length;
  const expiredCount = members.filter((m) => (m.expiresAt && now > m.expiresAt && m.plan !== 'lifetime' && m.plan !== 'admin') || m.status === 'expired' || m.status === 'suspended').length;

  // Filtered members
  const filtered = useMemo(() => {
    return members.filter((m) => {
      const isExpired = m.expiresAt ? (now > m.expiresAt && m.plan !== 'lifetime' && m.plan !== 'admin') : false;
      const isLifetime = m.plan === 'lifetime' || m.plan === 'admin' || m.role === 'admin';
      const isExpiringSoon = m.expiresAt ? (m.expiresAt > now && m.expiresAt - now <= threeDaysMs && !isLifetime) : false;
      const isActivePro = (m.plan === 'month' || m.plan === 'quarter' || m.plan === 'year' || m.role === 'pro') && !isExpired && !isLifetime;
      const isTrial = m.plan === 'trial';

      if (filterTab === 'lifetime' && !isLifetime) return false;
      if (filterTab === 'active_pro' && !isActivePro) return false;
      if (filterTab === 'trial' && !isTrial) return false;
      if (filterTab === 'expiring_soon' && !isExpiringSoon) return false;
      if (filterTab === 'expired' && (!isExpired && m.status !== 'expired' && m.status !== 'suspended')) return false;

      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        (m.memberCode && m.memberCode.toLowerCase().includes(s)) ||
        (m.email && m.email.toLowerCase().includes(s)) ||
        (m.displayName && m.displayName.toLowerCase().includes(s)) ||
        m.uid.toLowerCase().includes(s) ||
        m.boundDevices?.some((b) => b.deviceId.toLowerCase().includes(s))
      );
    });
  }, [members, filterTab, search, now]);

  // Export Data to CSV
  const exportToCSV = () => {
    if (members.length === 0) return;
    const headers = ['UID', 'MemberCode', 'Email', 'DisplayName', 'Role', 'Plan', 'Status', 'ExpiresAt', 'DeviceCount'];
    const rows = members.map((m) => [
      `"${m.uid}"`,
      `"${m.memberCode || ''}"`,
      `"${m.email || ''}"`,
      `"${m.displayName || ''}"`,
      `"${m.role}"`,
      `"${m.plan}"`,
      `"${m.status}"`,
      `"${m.expiresAt ? new Date(m.expiresAt).toISOString() : 'Lifetime'}"`,
      `"${m.boundDevices?.length || 0}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `members_backup_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="member-list-tab" className="space-y-4 sm:space-y-5">
      {/* 1. EXECUTIVE METRICS DASHBOARD */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button
          type="button"
          onClick={() => setFilterTab('all')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'all'
              ? 'bg-slate-800 border-amber-500/60 shadow-lg shadow-amber-500/10'
              : 'bg-slate-850/80 border-slate-750 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-medium">Tổng Tài Khoản</span>
            <Users className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-black text-white mt-1.5">{totalMembers}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab('lifetime')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'lifetime'
              ? 'bg-amber-500/15 border-amber-500 shadow-lg shadow-amber-500/10'
              : 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-amber-300 font-medium">VIP Vĩnh Viễn</span>
            <Crown className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-black text-amber-400 mt-1.5">{lifetimeCount}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab('active_pro')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'active_pro'
              ? 'bg-emerald-500/15 border-emerald-500 shadow-lg shadow-emerald-500/10'
              : 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-300 font-medium">PRO Đang Chạy</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400 mt-1.5">{activeProCount}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab('trial')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'trial'
              ? 'bg-indigo-500/15 border-indigo-500 shadow-lg shadow-indigo-500/10'
              : 'bg-indigo-500/5 border-indigo-500/20 hover:border-indigo-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-indigo-300 font-medium">Dùng Thử</span>
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-black text-indigo-400 mt-1.5">{trialCount}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab('expiring_soon')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'expiring_soon'
              ? 'bg-orange-500/15 border-orange-500 shadow-lg shadow-orange-500/10'
              : 'bg-orange-500/5 border-orange-500/20 hover:border-orange-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-orange-300 font-medium">Sắp Hết Hạn (&le;3d)</span>
            <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
          </div>
          <div className="text-xl font-black text-orange-400 mt-1.5">{expiringSoonCount}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab('expired')}
          className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
            filterTab === 'expired'
              ? 'bg-rose-500/15 border-rose-500 shadow-lg shadow-rose-500/10'
              : 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-rose-300 font-medium">Đã Hết Hạn / Khóa</span>
            <Lock className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-black text-rose-400 mt-1.5">{expiredCount}</div>
        </button>
      </div>

      {/* 2. TOOLBAR: OMNI SEARCH, ACTION BUTTONS, REFRESH */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4 text-amber-400" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo Mã thành viên, Email, Tên, UID hoặc Device ID..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchMembers}
            disabled={loading}
            className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Làm mới danh sách từ Firestore"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
            <span className="hidden sm:inline">Làm Mới</span>
          </button>

          <button
            type="button"
            onClick={exportToCSV}
            disabled={members.length === 0}
            className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Xuất file CSV sao lưu"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Xuất CSV</span>
          </button>
        </div>
      </div>

      {/* TOAST MESSAGE */}
      {toastMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 animate-in fade-in ${
            toastMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{toastMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* 3. SMART DATA TABLE / CARD LIST */}
      <div className="border border-slate-800 rounded-2xl bg-slate-850/60 overflow-hidden shadow-xl">
        {loading && members.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            <p className="text-xs text-slate-400 font-medium">Đang đồng bộ dữ liệu người dùng từ Firebase...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 px-4">
            <Users className="w-10 h-10 text-slate-600 mb-1" />
            <p className="text-sm font-bold text-slate-300">Không tìm thấy thành viên nào</p>
            <p className="text-xs text-slate-500 max-w-sm">
              {search ? `Không có kết quả khớp với từ khóa "${search}".` : 'Chưa có dữ liệu thành viên trong danh mục này.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filtered.map((m) => {
              const isExpired = m.expiresAt ? (now > m.expiresAt && m.plan !== 'lifetime' && m.plan !== 'admin') : false;
              const isLifetime = m.plan === 'lifetime' || m.plan === 'admin' || m.role === 'admin';
              const daysLeft = m.expiresAt ? Math.ceil((m.expiresAt - now) / (1000 * 60 * 60 * 24)) : null;
              const isSuspended = m.status === 'suspended';
              const isLoadingThis = actionLoadingId === m.uid;

              return (
                <div
                  key={m.uid}
                  className={`p-3.5 sm:p-4 hover:bg-slate-800/60 transition flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5 ${
                    isSuspended ? 'opacity-60 bg-rose-950/10' : ''
                  }`}
                >
                  {/* Left: User Identity & Plan */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Avatar / Initial */}
                    <div className="relative shrink-0">
                      {m.photoURL ? (
                        <img
                          src={m.photoURL}
                          alt={m.displayName || 'Avatar'}
                          className="w-10 h-10 rounded-xl object-cover border border-slate-700 shadow"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-750 to-slate-850 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-sm shadow">
                          {(m.displayName || m.email || m.memberCode || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}

                      {/* Status dot */}
                      <span
                        className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                          isLifetime
                            ? 'bg-amber-400'
                            : isExpired || isSuspended
                            ? 'bg-rose-500'
                            : 'bg-emerald-500'
                        }`}
                        title={isLifetime ? 'Vĩnh viễn' : isExpired ? 'Hết hạn' : 'Đang hoạt động'}
                      />
                    </div>

                    {/* Information */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs sm:text-sm text-white truncate max-w-[200px] sm:max-w-xs">
                          {m.displayName || m.email?.split('@')[0] || 'Chưa đặt tên'}
                        </span>

                        {/* Role & Plan Badge */}
                        {isLifetime ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide flex items-center gap-1">
                            <Crown className="w-3 h-3 text-amber-400" />
                            <span>LIFETIME VIP</span>
                          </span>
                        ) : m.plan === 'trial' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            DÙNG THỬ
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                            VIP {m.plan}
                          </span>
                        )}

                        {isSuspended && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            TẠM KHÓA
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                        {m.email && (
                          <span className="flex items-center gap-1 truncate max-w-[220px]">
                            <Mail className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="truncate">{m.email}</span>
                          </span>
                        )}

                        {m.memberCode && (
                          <button
                            type="button"
                            onClick={() => copyCode(m.memberCode!)}
                            className="flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700/80 transition cursor-pointer"
                            title="Sao chép Mã Thành Viên"
                          >
                            <span>{m.memberCode}</span>
                            {copiedCode === m.memberCode ? (
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 text-slate-400" />
                            )}
                          </button>
                        )}

                        <span className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                          <Smartphone className="w-3 h-3 text-slate-500" />
                          <span>{m.boundDevices?.length || 0}/{m.maxDevices || 2} máy</span>
                        </span>

                        {(m.lastIp || m.boundDevices?.[0]?.ip) && (
                          <span className="flex items-center gap-1 text-[11px] text-cyan-400 font-mono bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40" title="Địa chỉ IP kết nối">
                            <Globe className="w-3 h-3 text-cyan-400" />
                            <span>IP: {m.lastIp || m.boundDevices?.[0]?.ip}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Expiry Date & Countdown */}
                  <div className="w-full lg:w-48 shrink-0 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80 text-xs">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>Hạn Dùng:</span>
                      </span>
                      <span className="font-bold font-mono">
                        {isLifetime ? (
                          <span className="text-amber-300">Vĩnh Viễn</span>
                        ) : isExpired ? (
                          <span className="text-rose-400">Đã Hết Hạn</span>
                        ) : (
                          <span className="text-emerald-400">Còn {daysLeft} ngày</span>
                        )}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-slate-400 font-mono truncate">
                      {isLifetime
                        ? 'Không giới hạn thời gian'
                        : m.expiresAt
                        ? new Date(m.expiresAt).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'Chưa kích hoạt'}
                    </div>
                  </div>

                  {/* Right: Quick Action Buttons */}
                  <div className="flex items-center gap-1.5 w-full lg:w-auto justify-end flex-wrap">
                    {/* Quick Extend: +1 Month */}
                    <button
                      type="button"
                      onClick={() => handleQuickAction(m, 'pro_month')}
                      disabled={isLoadingThis}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600/20 hover:border-emerald-500/50 border border-slate-700 text-slate-200 hover:text-emerald-300 text-xs font-semibold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Gia hạn thêm 30 ngày VIP"
                    >
                      <Plus className="w-3 h-3 text-emerald-400" />
                      <span>+1 Tháng</span>
                    </button>

                    {/* Quick Extend: +1 Year */}
                    <button
                      type="button"
                      onClick={() => handleQuickAction(m, 'pro_year')}
                      disabled={isLoadingThis}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-600/20 hover:border-amber-500/50 border border-slate-700 text-slate-200 hover:text-amber-300 text-xs font-semibold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Gia hạn 1 năm (365 ngày)"
                    >
                      <Plus className="w-3 h-3 text-amber-400" />
                      <span>+1 Năm</span>
                    </button>

                    {/* Quick Lifetime */}
                    {!isLifetime && (
                      <button
                        type="button"
                        onClick={() => handleQuickAction(m, 'pro_lifetime')}
                        disabled={isLoadingThis}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        title="Nâng cấp VIP Vĩnh Viễn"
                      >
                        <Crown className="w-3 h-3 text-amber-400" />
                        <span>Vĩnh Viễn</span>
                      </button>
                    )}

                    {/* Reset Devices Button */}
                    <button
                      type="button"
                      onClick={() => handleQuickAction(m, 'reset_devices')}
                      disabled={isLoadingThis || (m.boundDevices?.length || 0) === 0}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-40"
                      title="Reset toàn bộ liên kết máy khi người dùng đổi thiết bị"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                    </button>

                    {/* Deep Edit Drawer */}
                    {onSelectMemberForAdjust && (
                      <button
                        type="button"
                        onClick={() => onSelectMemberForAdjust(m)}
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold transition flex items-center gap-1 shadow-md shadow-amber-500/10 active:scale-95 cursor-pointer"
                        title="Mở bảng điều chỉnh toàn diện"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Sửa Chi Tiết</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
