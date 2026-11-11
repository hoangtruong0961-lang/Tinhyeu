import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Crown,
  Sparkles,
  X,
  Search,
  Sliders,
  Users,
  Lock,
  LogOut,
  Zap,
  RefreshCw,
  Maximize2,
  Minimize2,
  Database,
  Activity,
  Layers
} from 'lucide-react';
import {
  LicenseState,
  ensureAndSyncDeviceLicense,
  subscribeLicenseState,
  isWhitelistedAdminMember,
  WHITELISTED_ADMIN_IPS
} from '../utils/licenseManager';
import { AdminAuthGate } from './admin/AdminAuthGate';
import { MemberLookupRenewTab } from './admin/MemberLookupRenewTab';
import { MemberAdjustTab } from './admin/MemberAdjustTab';
import { MemberListTab } from './admin/MemberListTab';
import { CloudUserProfileRecord, fetchCurrentClientIp } from '../services/firebaseLicenseService';

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AdminTab = 'manage_all' | 'lookup_renew' | 'adjust';

export const LicenseModal: React.FC<LicenseModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('manage_all');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(false);
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
  const [selectedMemberForAdjust, setSelectedMemberForAdjust] = useState<CloudUserProfileRecord | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Sync state and check auto admin unlock via IP whitelist
  const syncState = async () => {
    try {
      const [state, ipCheck] = await Promise.all([
        ensureAndSyncDeviceLicense(),
        fetchCurrentClientIp()
      ]);
      setLicenseState(state);
      if (
        ipCheck.isWhitelisted ||
        state.isWhitelistedAdmin ||
        state.isAdmin ||
        isWhitelistedAdminMember(state)
      ) {
        setIsAdminAuthenticated(true);
      }
    } catch (err) {
      console.error('[AdminPanel] sync error:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      syncState();
    }
  }, [isOpen]);

  useEffect(() => {
    const unsub = subscribeLicenseState((newState) => {
      setLicenseState(newState);
      if (
        newState.isWhitelistedAdmin ||
        newState.isAdmin ||
        isWhitelistedAdminMember(newState)
      ) {
        setIsAdminAuthenticated(true);
      }
    });
    return unsub;
  }, []);

  const handleSelectMemberForAdjust = (m: CloudUserProfileRecord) => {
    setSelectedMemberForAdjust(m);
    setActiveTab('adjust');
  };

  const handleOpenLookupWithCode = (code: string) => {
    setActiveTab('lookup_renew');
  };

  if (!isOpen) return null;

  return (
    <div
      id="admin-panel-modal-backdrop"
      className="fixed inset-0 z-[99999] flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in"
    >
      <div
        id="admin-panel-modal-container"
        className={`relative w-full bg-[#111116] text-slate-100 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden transition-all duration-300 ${
          isExpanded
            ? 'max-w-[98vw] h-[96vh]'
            : 'max-w-6xl max-h-[92vh] h-full'
        }`}
      >
        {/* TOP ADMIN HEADER */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-[#16161d] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
              <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-white tracking-tight truncate">
                  Studio Admin Control Center
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>SUPER ADMIN MASTER</span>
                </span>
                <span className="hidden sm:flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Firebase Live Sync</span>
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Quản lý thành viên đám mây, cấp quyền VIP trọn đời, gia hạn và bảo mật thiết bị
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Fullscreen Expand Toggle */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
              title={isExpanded ? 'Thu nhỏ cửa sổ' : 'Phóng to toàn màn hình'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {isAdminAuthenticated && (
              <button
                type="button"
                onClick={() => setIsAdminAuthenticated(false)}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition flex items-center gap-1 cursor-pointer"
                title="Khóa bảo mật Admin Panel"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Khóa Admin</span>
              </button>
            )}

            <button
              id="admin-panel-close-btn"
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Đóng Admin Panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SUB-TABS (When Authenticated) */}
        {isAdminAuthenticated && (
          <div className="flex items-center gap-1.5 px-3 sm:px-6 py-2.5 bg-[#131318] border-b border-slate-800 overflow-x-auto shrink-0 no-scrollbar">
            <button
              id="admin-tab-manage"
              type="button"
              onClick={() => setActiveTab('manage_all')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap cursor-pointer ${
                activeTab === 'manage_all'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Danh Sách & Quản Lý Thành Viên</span>
            </button>

            <button
              id="admin-tab-lookup"
              type="button"
              onClick={() => setActiveTab('lookup_renew')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap cursor-pointer ${
                activeTab === 'lookup_renew'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>Tra Cứu & Cấp VIP 1-Click</span>
            </button>

            <button
              id="admin-tab-adjust"
              type="button"
              onClick={() => setActiveTab('adjust')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap cursor-pointer ${
                activeTab === 'adjust'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Điều Chỉnh Quyền Hạn Chi Tiết</span>
              {selectedMemberForAdjust && (
                <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />
              )}
            </button>
          </div>
        )}

        {/* MODAL BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0f0f13]">
          {!isAdminAuthenticated ? (
            <AdminAuthGate
              onSuccess={() => setIsAdminAuthenticated(true)}
              onCancel={onClose}
            />
          ) : (
            <div>
              {activeTab === 'manage_all' && (
                <MemberListTab
                  onSelectMemberForAdjust={handleSelectMemberForAdjust}
                  onOpenLookupRenew={handleOpenLookupWithCode}
                />
              )}
              {activeTab === 'lookup_renew' && (
                <MemberLookupRenewTab
                  onSelectForAdjust={handleSelectMemberForAdjust}
                />
              )}
              {activeTab === 'adjust' && (
                <MemberAdjustTab
                  initialMember={selectedMemberForAdjust}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
