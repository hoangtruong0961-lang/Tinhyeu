import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Search,
  Save,
  RotateCcw,
  Smartphone,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  Mail,
  Calendar,
  Sparkles,
  Crown,
  Key,
  X,
  Plus,
  Trash2
} from 'lucide-react';
import {
  lookupMemberInFirestore,
  updateMemberInFirestore,
  resetMemberDevicesInFirestore,
  CloudUserProfileRecord
} from '../../services/firebaseLicenseService';

interface MemberAdjustTabProps {
  initialMember?: CloudUserProfileRecord | null;
}

export const MemberAdjustTab: React.FC<MemberAdjustTabProps> = ({ initialMember }) => {
  const [queryText, setQueryText] = useState(
    initialMember?.memberCode || initialMember?.email || initialMember?.uid || ''
  );
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState<CloudUserProfileRecord | null>(initialMember || null);
  const [saving, setSaving] = useState(false);
  const [resettingDevices, setResettingDevices] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [role, setRole] = useState<'user' | 'pro' | 'admin'>('user');
  const [plan, setPlan] = useState<'free' | 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'admin'>('trial');
  const [status, setStatus] = useState<'active' | 'expired' | 'suspended' | 'inactive'>('active');
  const [maxDevices, setMaxDevices] = useState<number>(2);
  const [isLifetime, setIsLifetime] = useState<boolean>(false);
  const [expiryDateString, setExpiryDateString] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');

  const populateFormWithMember = (m: CloudUserProfileRecord) => {
    setMember(m);
    setRole(m.role || 'user');
    setPlan(m.plan || 'trial');
    setStatus(m.status || 'active');
    setMaxDevices(m.maxDevices || 2);
    setNote(m.note || '');
    setDisplayName(m.displayName || '');
    if (m.plan === 'lifetime' || m.plan === 'admin' || !m.expiresAt) {
      setIsLifetime(true);
      setExpiryDateString('');
    } else {
      setIsLifetime(false);
      const d = new Date(m.expiresAt);
      setExpiryDateString(d.toISOString().split('T')[0]);
    }
  };

  useEffect(() => {
    if (initialMember) {
      populateFormWithMember(initialMember);
      setQueryText(initialMember.memberCode || initialMember.email || initialMember.uid);
    }
  }, [initialMember]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!queryText.trim()) return;

    setSearching(true);
    setStatusMsg(null);
    try {
      const res = await lookupMemberInFirestore(queryText.trim());
      if (res) {
        populateFormWithMember(res);
      } else {
        setMember(null);
        setStatusMsg({ type: 'error', text: `Không tìm thấy thành viên: "${queryText}"` });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Lỗi tra cứu: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setSearching(false);
    }
  };

  const handleAddDays = (days: number) => {
    setIsLifetime(false);
    const baseTime = expiryDateString ? new Date(expiryDateString).getTime() : Date.now();
    const newTime = Math.max(Date.now(), baseTime) + days * 24 * 60 * 60 * 1000;
    const d = new Date(newTime);
    setExpiryDateString(d.toISOString().split('T')[0]);
  };

  const handleSetLifetime = () => {
    setIsLifetime(true);
    setPlan('lifetime');
    setRole('pro');
    setStatus('active');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;

    setSaving(true);
    setStatusMsg(null);

    try {
      let finalExpiresAt: number | null = null;
      if (!isLifetime && expiryDateString) {
        finalExpiresAt = new Date(expiryDateString + 'T23:59:59.999Z').getTime();
      }

      const res = await updateMemberInFirestore(member.uid, {
        role,
        plan: isLifetime ? 'lifetime' : plan,
        status,
        maxDevices: Number(maxDevices) || 2,
        expiresAt: isLifetime ? null : finalExpiresAt,
        note,
        displayName
      });

      if (res.success) {
        const fresh = await lookupMemberInFirestore(member.uid);
        if (fresh) populateFormWithMember(fresh);
        setStatusMsg({ type: 'success', text: res.message });
      } else {
        setStatusMsg({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Lỗi lưu dữ liệu: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDevices = async () => {
    if (!member) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ liên kết thiết bị của ${member.displayName || member.memberCode}?`)) {
      return;
    }

    setResettingDevices(true);
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
      setStatusMsg({ type: 'error', text: 'Lỗi: ' + (err.message || 'Lỗi mạng') });
    } finally {
      setResettingDevices(false);
    }
  };

  return (
    <div id="member-adjust-tab" className="space-y-5">
      {/* 1. SELECT MEMBER FOR ADJUST */}
      <div className="bg-slate-850 border border-slate-750 p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg space-y-3">
        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
          Chọn Thành Viên Cần Điều Chỉnh
        </label>
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4 text-amber-400" />
            </div>
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Nhập Mã thành viên, Email hoặc UID..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs sm:text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !queryText.trim()}
            className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Tìm Hồ Sơ</span>
          </button>
        </form>
      </div>

      {/* TOAST MESSAGE */}
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

      {/* 2. FORM ĐIỀU CHỈNH CHI TIẾT */}
      {member ? (
        <form onSubmit={handleSave} className="bg-slate-850 border border-slate-750 p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-xl space-y-5">
          {/* Header Thông Tin Người Dùng */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-750 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm shadow">
                {(member.displayName || member.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">{member.displayName || member.email}</h4>
                <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
                  <span>Mã: <span className="text-amber-300 font-bold">{member.memberCode || 'N/A'}</span></span>
                  <span>•</span>
                  <span>UID: {member.uid.slice(0, 8)}...</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetDevices}
              disabled={resettingDevices || (member.boundDevices?.length || 0) === 0}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:border-rose-500/40 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-rose-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              title="Xóa danh sách thiết bị đã gán"
            >
              {resettingDevices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />}
              <span>Reset Thiết Bị ({member.boundDevices?.length || 0} máy)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tên hiển thị */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Tên Hiển Thị (Display Name)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tên người dùng..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Trạng Thái Tài Khoản */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Trạng Thái Tài Khoản</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="active">Active (Đang hoạt động bình thường)</option>
                <option value="suspended">Suspended (Tạm khóa / Đình chỉ)</option>
                <option value="expired">Expired (Hết hạn)</option>
                <option value="inactive">Inactive (Chưa kích hoạt)</option>
              </select>
            </div>

            {/* Quyền Hạn (Role) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Phân Quyền (Role)</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="pro">Pro Member (VIP đầy đủ quyền)</option>
                <option value="user">Standard User (Người dùng thường / Dùng thử)</option>
                <option value="admin">Administrator (Quản trị viên cấp cao)</option>
              </select>
            </div>

            {/* Gói Dịch Vụ (Plan) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Gói Dịch Vụ (Plan)</label>
              <select
                value={plan}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setPlan(val);
                  if (val === 'lifetime' || val === 'admin') {
                    setIsLifetime(true);
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="lifetime">VIP Vĩnh Viễn (Lifetime)</option>
                <option value="year">VIP 1 Năm (Yearly)</option>
                <option value="quarter">VIP 3 Tháng (Quarterly)</option>
                <option value="month">VIP 1 Tháng (Monthly)</option>
                <option value="trial">Dùng Thử (Trial)</option>
                <option value="free">Miễn Phí (Free)</option>
                <option value="admin">Admin Master</option>
              </select>
            </div>

            {/* Số thiết bị tối đa */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Số Thiết Bị Tối Đa Được Đăng Nhập</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxDevices}
                  onChange={(e) => setMaxDevices(Number(e.target.value))}
                  className="w-24 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-center text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400">máy (mặc định 2 thiết bị)</span>
              </div>
            </div>

            {/* Ghi chú quản trị */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Ghi Chú Admin (Internal Note)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Khách hàng VIP qua Zalo, mã HĐ 123..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Cấu Hình Thời Hạn Sử Dụng */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>Thời Hạn & Ngày Hết Hạn</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isLifetime}
                  onChange={(e) => {
                    setIsLifetime(e.target.checked);
                    if (e.target.checked) setPlan('lifetime');
                  }}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-xs font-bold text-amber-300">VIP Vĩnh Viễn (Không giới hạn)</span>
              </label>
            </div>

            {!isLifetime && (
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="date"
                    value={expiryDateString}
                    onChange={(e) => setExpiryDateString(e.target.value)}
                    className="flex-1 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleAddDays(7)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 cursor-pointer"
                    >
                      +7 Ngày
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDays(30)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 cursor-pointer"
                    >
                      +30 Ngày
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDays(90)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 cursor-pointer"
                    >
                      +90 Ngày
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDays(365)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 cursor-pointer"
                    >
                      +365 Ngày
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Nút Submit Lưu */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="py-3 px-8 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm transition flex items-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Đang Lưu Thay Đổi...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Lưu Hồ Sơ Thành Viên</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="py-12 border border-slate-800 rounded-2xl bg-slate-850/40 flex flex-col items-center justify-center text-center px-4 space-y-2">
          <Sliders className="w-8 h-8 text-slate-600 mb-1" />
          <p className="text-sm font-bold text-slate-300">Chưa chọn hồ sơ thành viên</p>
          <p className="text-xs text-slate-500 max-w-sm">
            Vui lòng nhập Mã thành viên hoặc Email ở trên để tải dữ liệu và điều chỉnh quyền hạn.
          </p>
        </div>
      )}
    </div>
  );
};
