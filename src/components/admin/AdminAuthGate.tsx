import React, { useState } from 'react';
import { Lock, KeyRound, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { verifyAdminPasswordFirebase } from '../../services/firebaseLicenseService';

interface AdminAuthGateProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({ onSuccess, onCancel }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu quản trị viên.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await verifyAdminPasswordFirebase(password.trim());
      if (res.success) {
        setSuccessMsg(res.message);
        setTimeout(() => {
          onSuccess();
        }, 500);
      } else {
        setError(res.message || 'Mật khẩu quản trị viên không chính xác!');
      }
    } catch (err: any) {
      setError('Lỗi kết nối xác thực: ' + (err.message || 'Không thể xác thực'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="admin-auth-gate-container" className="w-full max-w-md mx-auto py-6 sm:py-10 px-4 flex flex-col items-center justify-center text-center">
      {/* Icon Badge */}
      <div className="relative mb-5">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/10">
          <Lock className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-slate-950">
          <ShieldCheck className="w-3.5 h-3.5" />
        </div>
      </div>

      <h3 className="text-lg sm:text-xl font-extrabold text-white tracking-tight mb-2">
        Xác Thực Quản Trị Viên
      </h3>
      <p className="text-xs sm:text-sm text-slate-400 mb-6 max-w-sm leading-relaxed">
        Khu vực bảo mật dành riêng cho Quản trị viên. Vui lòng nhập mật khẩu hoặc Master Key để truy cập Admin Panel.
      </p>

      <form onSubmit={handleVerify} className="w-full space-y-4">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <KeyRound className="w-5 h-5 text-amber-400/80" />
          </div>
          <input
            id="admin-password-input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="Nhập mật khẩu quản trị..."
            autoFocus
            className="w-full pl-11 pr-11 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl bg-slate-800/90 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 text-sm sm:text-base transition"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 transition"
            title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>

        {error && (
          <div id="admin-auth-error" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-400 text-left animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div id="admin-auth-success" className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-400 text-left animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="flex gap-2.5 pt-1">
          {onCancel && (
            <button
              id="admin-auth-cancel-btn"
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 px-4 rounded-xl sm:rounded-2xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs sm:text-sm transition min-h-[44px]"
            >
              Đóng
            </button>
          )}
          <button
            id="admin-auth-submit-btn"
            type="submit"
            disabled={loading || !password.trim()}
            className="flex-1 py-3 px-4 rounded-xl sm:rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm transition shadow-lg shadow-amber-500/20 active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Đang Xác Thực...</span>
              </>
            ) : (
              <span>Mở Khóa Admin</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
