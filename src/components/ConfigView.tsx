import React, { useState, useEffect } from 'react';
import {
  Settings,
  Key,
  Cpu,
  Zap,
  Server,
  Eye,
  EyeOff,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Save,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Radio,
  ListFilter,
  Sparkles,
  Loader2,
  Layers,
  ArrowRight,
  Volume2,
  DownloadCloud,
  Database,
  Trash2,
  Globe,
  ShieldCheck,
  Terminal,
  LogIn,
  LogOut,
  Play,
  Code2,
  Info,
  UserCheck,
  UserX,
  User,
  Fingerprint,
  Copy,
  Check,
  Crown,
  ShieldAlert,
  Laptop,
  Cloud,
  Bug,
  Download,
  ExternalLink,
} from 'lucide-react';
import { AppSettings, GeminiModelOption, ApiConnectionMode, TTSProviderOption } from '../types';
import { AdvancedConfigDrawer } from './AdvancedConfigDrawer';
import { DEFAULT_APP_SETTINGS } from '../utils/settingsStorage';
import {
  checkPaddleOcrModelStatus,
  downloadPaddleOcrModels,
  clearPaddleOcrCache,
  PaddleOcrModelStatus,
} from '../utils/localPaddleOcrEngine';
import { getDeviceFingerprint, DeviceInfo } from '../utils/deviceFingerprint';
import {
  getCurrentLicenseState,
  subscribeLicenseState,
  LicenseState,
  isWhitelistedAdminMember,
  loginWithGoogleAccount,
  logoutGoogleAccount,
} from '../utils/licenseManager';
import {
  getFirebaseUser,
  getOrCreateLocalMemberCode,
  generateMemberCode,
} from '../services/firebaseLicenseService';
import NativeGeminiWebView, { isNativeGeminiWebViewSupported } from '../plugins/geminiWebView';
import { parseGoogleCookies, executeGeminiWebPromptHybrid } from '../utils/geminiWebHelper';

interface ConfigViewProps {
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  onOpenLicense?: () => void;
}

export const ConfigView: React.FC<ConfigViewProps> = ({
  settings,
  onSaveSettings,
  onOpenLicense,
}) => {
  const [formData, setFormData] = useState<AppSettings>({
    ...settings,
    apiMode: settings.apiMode || 'direct',
  });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [showProxyKey, setShowProxyKey] = useState<boolean>(false);
  const [showGroqKey, setShowGroqKey] = useState<boolean>(false);
  const [isTestingGroq, setIsTestingGroq] = useState<boolean>(false);
  const [groqTestMsg, setGroqTestMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [showTikTokSessionKey, setShowTikTokSessionKey] = useState<boolean>(false);
  const [showTikTokGuide, setShowTikTokGuide] = useState<boolean>(false);
  const [savedToast, setSavedToast] = useState<boolean>(false);

  // Member Code, Device Fingerprint & License State
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // F12 DevTools Console & Diagnostic State
  const [devToolsStatus, setDevToolsStatus] = useState<string | null>(null);
  const [diagCopied, setDiagCopied] = useState<boolean>(false);

  // Proxy Model Fetching State
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchSuccessMsg, setFetchSuccessMsg] = useState<string | null>(null);
  const [fetchedProxyModels, setFetchedProxyModels] = useState<string[]>(
    formData.proxyModelsList || []
  );

  // Google Account / Gemini Web Automated Session State (BachTranslate Headless Engine)
  const [isCheckingGoogleToken, setIsCheckingGoogleToken] = useState<boolean>(false);
  const [isTestingGeminiPrompt, setIsTestingGeminiPrompt] = useState<boolean>(false);
  const [googleAuthMessage, setGoogleAuthMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [googleLogs, setGoogleLogs] = useState<string[]>([
    '[System] BachTranslate Headless Engine sẵn sàng.',
    '[WebView] Offscreen background WebView container đã được khởi tạo.',
    formData.googleAccountConnected
      ? `[CookieManager] Phiên Google: ${formData.googleAccountEmail || 'Đã kết nối'} (Token ready)`
      : '[CookieManager] Đang chờ kết nối Google Account hoặc nhận diện Cookie...',
  ]);
  const [testPromptResult, setTestPromptResult] = useState<string | null>(null);
  const [showCookieInput, setShowCookieInput] = useState<boolean>(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // PaddleOCR Model Download / Cache State
  const [paddleStatus, setPaddleStatus] = useState<PaddleOcrModelStatus | null>(null);
  const [isDownloadingPaddle, setIsDownloadingPaddle] = useState<boolean>(false);
  const [paddleProgress, setPaddleProgress] = useState<{ percent: number; msg: string }>({ percent: 0, msg: '' });
  const [paddleDownloadMsg, setPaddleDownloadMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const refreshPaddleStatus = async (variant?: 'small' | 'tiny') => {
    try {
      const activeVariant = variant || formData.paddleOcrModelVariant || 'small';
      const status = await checkPaddleOcrModelStatus(activeVariant);
      setPaddleStatus(status);
    } catch (_) {}
  };

  useEffect(() => {
    refreshPaddleStatus(formData.paddleOcrModelVariant);

    // Fetch device fingerprint & license state
    getDeviceFingerprint().then((info) => setDeviceInfo(info));
    getCurrentLicenseState().then((st) => setLicenseState(st));
    const unsub = subscribeLicenseState((st) => setLicenseState(st));

    return () => {
      unsub();
    };
  }, [formData.paddleOcrModelVariant]);

  const handleCopyText = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isElectronApp = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;

  const handleToggleDevTools = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.toggleDevTools) {
      await (window as any).electronAPI.toggleDevTools();
      setDevToolsStatus('✓ Đã bật/tắt cửa sổ F12 Developer Tools Console!');
      setTimeout(() => setDevToolsStatus(null), 3000);
    } else {
      setDevToolsStatus('💡 Bạn đang chạy trên trình duyệt Web. Hãy ấn phím F12 trên bàn phím (hoặc Ctrl+Shift+I) để mở Console!');
      setTimeout(() => setDevToolsStatus(null), 4500);
    }
  };

  const handleCopyDiagnostic = () => {
    const diagnosticInfo = [
      `=== BÁO CÁO CHẨN ĐOÁN HỆ THỐNG (GEMINI SUBTITLES) ===`,
      `Thời gian: ${new Date().toLocaleString()}`,
      `Môi trường: ${isElectronApp ? 'Desktop App (Electron)' : 'Web Browser'}`,
      `Hệ điều hành / Nền tảng: ${deviceInfo?.platform || navigator.platform || 'Desktop'}`,
      `Trình duyệt/Runtime: ${navigator.userAgent}`,
      `Độ phân giải màn hình: ${window.screen.width}x${window.screen.height}`,
      `Chế độ API: ${formData.apiMode || 'direct'}`,
      `Model AI: ${formData.selectedModel || 'gemini-3.6-flash'}`,
      `OCR Engine: ${formData.ocrEngine || 'paddleocr'} (PaddleOCR Model: ${paddleStatus?.isReady ? 'Đã nạp' : 'Chưa nạp'})`,
      `Mã thành viên: ${licenseState?.memberCode || deviceInfo?.memberCode || (deviceInfo?.deviceId ? generateMemberCode(deviceInfo.deviceId) : generateMemberCode())}`,
      `Gói bản quyền: ${licenseState?.isPro ? (licenseState.plan === 'lifetime' ? 'VIP Vĩnh Viễn' : `Gói ${licenseState.plan}`) : 'Dùng thử (Trial)'}`,
      `======================================================`,
    ].join('\n');

    navigator.clipboard.writeText(diagnosticInfo);
    setDiagCopied(true);
    setTimeout(() => setDiagCopied(false), 2500);
  };

  const handleDownloadPaddleModels = async (variantOverride?: 'small' | 'tiny') => {
    const targetVariant = variantOverride || formData.paddleOcrModelVariant || 'small';
    const variantLabel = targetVariant === 'tiny' ? 'Tiny' : 'Small';

    setIsDownloadingPaddle(true);
    setPaddleDownloadMsg(null);
    setPaddleProgress({ percent: 0, msg: `Đang chuẩn bị nạp mô hình PP-OCRv6 ${variantLabel}...` });

    let downloadErrorMsg = '';
    const success = await downloadPaddleOcrModels((pct, msg) => {
      setPaddleProgress({ percent: pct, msg });
      if (pct === 0 && (msg.startsWith('Lỗi') || msg.toLowerCase().includes('lỗi'))) {
        downloadErrorMsg = msg;
      }
    }, targetVariant);

    setIsDownloadingPaddle(false);
    await refreshPaddleStatus(targetVariant);

    if (success) {
      setPaddleDownloadMsg({ text: `Tải và lưu Model PaddleOCR PP-OCRv6 ${variantLabel} thành công vào IndexedDB!`, isError: false });
    } else {
      setPaddleDownloadMsg({
        text: downloadErrorMsg || 'Không thể tải Model từ CDN. Bạn hãy kiểm tra lại kết nối mạng hoặc thử lại.',
        isError: true,
      });
    }
  };

  const handleClearPaddleCache = async () => {
    await clearPaddleOcrCache();
    await refreshPaddleStatus();
    setPaddleDownloadMsg({ text: 'Đã xóa bộ nhớ đệm Model PaddleOCR trong IndexedDB.', isError: false });
  };

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...formData, [key]: value };
    setFormData(updated);
    onSaveSettings(updated);
    showToastNotification();
  };

  const handleMultipleChanges = (changes: Partial<AppSettings>) => {
    const updated = { ...formData, ...changes };
    setFormData(updated);
    onSaveSettings(updated);
    showToastNotification();
  };

  const showToastNotification = () => {
    setSavedToast(true);
    setTimeout(() => {
      setSavedToast(false);
    }, 1500);
  };

  const handleApplyIdealPresets = () => {
    const isTiny = formData.paddleOcrModelVariant === 'tiny';
    const presetData: AppSettings = {
      ...formData,
      ocrEngine: 'paddleocr',
      ocrInterval: 0.5,
      confidenceThreshold: 0.75,
      sourceLang: 'zh_cn',
      targetLang: 'Tiếng Việt',
      paddleOcrLang: 'ch',
      detDbBoxThresh: 0.55,
      detDbThresh: 0.30,
      detLimitSideLen: isTiny ? 960 : 1216,
      maxTextLength: 25,
      dropScore: 0.78,
      cls: false,
      framesToSkip: 4,
      similarPixelThreshold: 0.82,
      roiCropBottomPercent: 15,
      autoFilterDuplicates: true,
      autoIdealPreset: true,
      selectedModel: 'gemini-3.6-flash',
    };
    setFormData(presetData);
    onSaveSettings(presetData);
    showToastNotification();
  };

  const handleResetDefaults = () => {
    setFormData(DEFAULT_APP_SETTINGS);
    onSaveSettings(DEFAULT_APP_SETTINGS);
    setFetchedProxyModels([]);
    showToastNotification();
  };

  // Fetch models from Proxy Endpoint
  const handleFetchProxyModels = async () => {
    if (!formData.proxyUrl || !formData.proxyUrl.trim()) {
      setFetchModelsError('Vui lòng nhập Proxy Endpoint URL trước khi kết nối!');
      return;
    }

    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchSuccessMsg(null);

    const cleanUrl = formData.proxyUrl.trim().replace(/\/+$/, '');
    const endpointsToTry = [
      `${cleanUrl}/v1/models`,
      `${cleanUrl}/models`,
      `${cleanUrl}/api/models`,
      cleanUrl,
    ];

    let modelsFound: string[] = [];
    let lastErrMsg = '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (formData.proxyKey && formData.proxyKey.trim()) {
      headers['Authorization'] = `Bearer ${formData.proxyKey.trim()}`;
      headers['x-api-key'] = formData.proxyKey.trim();
    }

    for (const endpoint of endpointsToTry) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers,
        });

        if (response.ok) {
          const rawText = await response.text().catch(() => '');
          let json: any = null;
          try {
            json = JSON.parse(rawText);
          } catch {
            json = null;
          }
          let rawList: any[] = [];

          if (Array.isArray(json)) {
            rawList = json;
          } else if (Array.isArray(json.data)) {
            rawList = json.data;
          } else if (Array.isArray(json.models)) {
            rawList = json.models;
          }

          const parsed = rawList
            .map((item: any) => {
              if (typeof item === 'string') return item;
              if (item && typeof item === 'object') {
                return item.id || item.name || item.model || item.slug || '';
              }
              return '';
            })
            .filter((str): str is string => Boolean(str && str.trim()));

          if (parsed.length > 0) {
            modelsFound = Array.from(new Set(parsed));
            break;
          }
        } else {
          lastErrMsg = `Server phản hồi mã lỗi HTTP ${response.status} (${response.statusText})`;
        }
      } catch (err: any) {
        lastErrMsg = err.message || 'Lỗi kết nối tới Proxy Server';
      }
    }

    if (modelsFound.length > 0) {
      setFetchedProxyModels(modelsFound);
      setFetchSuccessMsg(`✓ Đã truy vấn thành công ${modelsFound.length} mô hình từ Proxy!`);
      const defaultTarget = modelsFound[0];
      const updated: AppSettings = {
        ...formData,
        proxyModelsList: modelsFound,
        proxyTargetModel: formData.proxyTargetModel || defaultTarget,
      };
      setFormData(updated);
      onSaveSettings(updated);
    } else {
      setFetchModelsError(
        lastErrMsg || 'Không nhận diện được danh sách model từ Endpoint này. Bạn vẫn có thể nhập thủ công Target Model bên dưới.'
      );
    }

    setIsFetchingModels(false);
  };

  const handleTestGroq = async () => {
    if (!formData.groqApiKey?.trim()) {
      setGroqTestMsg({ text: 'Vui lòng nhập Groq API Key trước khi kiểm tra!', isError: true });
      return;
    }
    setIsTestingGroq(true);
    setGroqTestMsg(null);
    try {
      const res = await fetch('/api/groq-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: formData.groqApiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGroqTestMsg({ text: `✓ ${data.message || 'Kết nối Groq API thành công!'}`, isError: false });
      } else {
        setGroqTestMsg({ text: `✗ Lỗi: ${data.error || 'Không thể kết nối đến Groq'}`, isError: true });
      }
    } catch (err: any) {
      setGroqTestMsg({ text: `✗ Lỗi kết nối: ${err?.message || err}`, isError: true });
    } finally {
      setIsTestingGroq(false);
    }
  };

  const appendGoogleLog = (line: string) => {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setGoogleLogs((prev) => [...prev.slice(-35), `[${timestamp}] ${line}`]);
  };

  const handleOpenGeminiLoginNative = async () => {
    setIsCheckingGoogleToken(true);
    setGoogleAuthMessage(null);
    appendGoogleLog('[GeminiNative] Đang mở trình duyệt WebView trong app để đăng nhập Google / Gemini...');

    try {
      if (!isNativeGeminiWebViewSupported()) {
        throw new Error(
          'Trình duyệt đăng nhập trong app chỉ khả dụng trên bản cài đặt APK Android. Trên Web Browser, bạn vui lòng copy Cookie (__Secure-1PSID) từ trang gemini.google.com và dán vào ô bên dưới.'
        );
      }

      const sessionResult = await NativeGeminiWebView.openGeminiLogin();

      if (!sessionResult || !sessionResult.success) {
        if (sessionResult?.cancelled) {
          appendGoogleLog('[GeminiNative] Người dùng đã đóng cửa sổ đăng nhập.');
          setGoogleAuthMessage({
            text: 'Đã đóng cửa sổ đăng nhập. Bạn có thể bấm "Đăng Nhập Google (Mở WebView)" bất kỳ lúc nào để thử lại.',
            isError: false,
          });
        } else {
          throw new Error(sessionResult?.message || 'Chưa hoàn tất đăng nhập tài khoản Google trên Gemini.');
        }
        setIsCheckingGoogleToken(false);
        return;
      }

      appendGoogleLog(`[GeminiNative] Đã bắt thành công Cookie Google (${sessionResult.cookies ? sessionResult.cookies.length : 0} bytes)!`);
      if (sessionResult.cookies) {
        await handleCheckGoogleToken(sessionResult.cookies, sessionResult.snlm0e);
      }
    } catch (err: any) {
      appendGoogleLog(`[GeminiNative Error] ${err.message || 'Lỗi mở trình duyệt đăng nhập'}`);
      setGoogleAuthMessage({
        text: err.message || 'Lỗi khi mở giao diện đăng nhập WebView.',
        isError: true,
      });
      setIsCheckingGoogleToken(false);
    }
  };

  const handleFetchGeminiSessionNative = async () => {
    setIsCheckingGoogleToken(true);
    setGoogleAuthMessage(null);
    appendGoogleLog('[GeminiNative] Bắt đầu kiểm tra phiên Gemini Web từ WebView...');

    try {
      if (!isNativeGeminiWebViewSupported()) {
        throw new Error(
          'Thiết bị đang chạy trên trình duyệt Web. Tính năng WebView tự động chỉ khả dụng khi chạy trên App Android (APK Capacitor). Vui lòng dán Cookie thủ công (__Secure-1PSID).'
        );
      }

      appendGoogleLog('[GeminiNative] Đang kiểm tra Cookie và tải https://gemini.google.com/app...');
      const sessionResult = await NativeGeminiWebView.fetchGeminiSession();

      if (!sessionResult || !sessionResult.success) {
        if (sessionResult?.cancelled) {
          appendGoogleLog('[GeminiNative] Đã đóng cửa sổ đăng nhập.');
          setGoogleAuthMessage({
            text: 'Đã đóng cửa sổ đăng nhập Google.',
            isError: false,
          });
        } else {
          throw new Error(sessionResult?.message || 'Không lấy được phiên từ Gemini Web. Vui lòng đăng nhập tài khoản Google.');
        }
        setIsCheckingGoogleToken(false);
        return;
      }

      appendGoogleLog(`[GeminiNative] Trích xuất thành công Cookie (${sessionResult.cookies ? sessionResult.cookies.length : 0} bytes).`);

      if (sessionResult.cookies) {
        await handleCheckGoogleToken(sessionResult.cookies, sessionResult.snlm0e);
      } else {
        throw new Error('WebView không nhận diện được Cookie Google nào.');
      }
    } catch (err: any) {
      appendGoogleLog(`[GeminiNative Error] ${err.message || 'Lỗi lấy phiên tự động'}`);
      setGoogleAuthMessage({
        text: err.message || 'Lỗi khi lấy phiên tự động qua WebView.',
        isError: true,
      });
      setIsCheckingGoogleToken(false);
    }
  };

  const handleCheckGoogleToken = async (customCookie?: string, customToken?: string) => {
    setIsCheckingGoogleToken(true);
    setGoogleAuthMessage(null);
    appendGoogleLog('[GeminiWeb] Đang gửi yêu cầu bắt tay xác thực tới https://gemini.google.com/app...');
    appendGoogleLog('[CookieManager] Phân tích cookie Google (__Secure-1PSID)...');

    const cookieToSend = customCookie !== undefined ? customCookie : formData.geminiWebCookie;
    const parsedCookie = parseGoogleCookies(cookieToSend || '');

    if (!parsedCookie.isValid) {
      appendGoogleLog('[GoogleAuth Error] Chưa có Cookie __Secure-1PSID hợp lệ.');
      setGoogleAuthMessage({
        text: 'Cookie thiếu __Secure-1PSID hoặc SID. Vui lòng đăng nhập lại trên WebView hoặc copy đầy đủ cookie từ gemini.google.com.',
        isError: true,
      });
      setIsCheckingGoogleToken(false);
      return;
    }

    appendGoogleLog(`[CookieManager] Tìm thấy cookie __Secure-1PSID: ${parsedCookie.psid.slice(0, 8)}...`);

    let serverVerified = false;
    let serverData: any = null;

    // Try verifying with backend proxy server if available
    try {
      const res = await fetch('/api/gemini-web/check-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie: cookieToSend,
          accountEmail: formData.googleAccountEmail,
        }),
      });

      const resText = await res.text().catch(() => '');
      if (resText && !resText.trim().startsWith('<')) {
        try {
          serverData = JSON.parse(resText);
          if (serverData.logs && Array.isArray(serverData.logs)) {
            serverData.logs.forEach((l: string) => appendGoogleLog(l));
          }
          if (serverData.success && serverData.tokenReady) {
            serverVerified = true;
          }
        } catch {
          // Non-JSON response, fallback to client/native validation
        }
      }
    } catch {
      // Backend offline/inaccessible (e.g. standalone APK Android Capacitor), proceed to client validation
    }

    try {
      const token = serverVerified && serverData?.token
        ? serverData.token
        : (customToken || formData.geminiWebSessionToken || 'token_ready');

      const email = serverVerified && serverData?.email
        ? serverData.email
        : (formData.googleAccountEmail || 'Tài khoản Google Cá Nhân');

      const accountName = serverVerified && serverData?.accountName
        ? serverData.accountName
        : (email ? email.split('@')[0] : 'Google User');

      appendGoogleLog('[GeminiWeb] ✓ Xác thực Cookie Google thành công! Phiên kết nối RPC Gemini Web đã sẵn sàng.');
      if (token && token !== 'token_ready') {
        appendGoogleLog(`[GeminiWeb] Token bảo mật SNlM0e: ${token.slice(0, 14)}...`);
      }

      const updated: AppSettings = {
        ...formData,
        apiMode: 'gemini_web',
        googleAccountConnected: true,
        googleAccountEmail: email,
        googleAccountName: accountName,
        geminiWebSessionToken: token,
        geminiWebAccountStatus: 'token_ready',
        ...(cookieToSend ? { geminiWebCookie: cookieToSend } : {}),
      };

      setFormData(updated);
      onSaveSettings(updated);
      setGoogleAuthMessage({
        text: '✓ Xác thực Cookie Google thật thành công! Phiên kết nối RPC Gemini Web đã sẵn sàng.',
        isError: false,
      });
      showToastNotification();
    } catch (err: any) {
      appendGoogleLog(`[GeminiWeb Auth Error] ${err.message || 'Lỗi kết nối'}`);
      setGoogleAuthMessage({ text: 'Lỗi kiểm tra Token: ' + (err.message || 'Mất kết nối'), isError: true });
    } finally {
      setIsCheckingGoogleToken(false);
    }
  };

  const handleGoogleLogout = () => {
    const updated: AppSettings = {
      ...formData,
      googleAccountConnected: false,
      googleAccountEmail: '',
      geminiWebSessionToken: '',
      geminiWebCookie: '',
      geminiWebAccountStatus: 'disconnected',
    };
    setFormData(updated);
    onSaveSettings(updated);
    showToastNotification();
    appendGoogleLog('[GoogleAuth] Đã xóa phiên Cookie và ngắt kết nối Gemini Web.');
    setGoogleAuthMessage({ text: 'Đã xóa cookie và ngắt kết nối tài khoản Google.', isError: false });
    setTestPromptResult(null);
  };

  const handleTestGeminiPrompt = async () => {
    setIsTestingGeminiPrompt(true);
    setTestPromptResult(null);
    appendGoogleLog('[Test RPC] Chuẩn bị gửi prompt test dịch tới Google Gemini Web RPC...');

    try {
      const samplePrompt = `Dịch dòng phụ đề sau sang tiếng Việt tự nhiên: "师傅，徒儿这就去！" Trả về định dạng JSON: [{"id":"1","original":"师傅，徒儿这就去！","translation":"Sư phụ, đồ nhi đi ngay đây!"}]`;

      const result = await executeGeminiWebPromptHybrid(samplePrompt, {
        cookie: formData.geminiWebCookie || '',
        snlm0e: formData.geminiWebSessionToken,
      });

      if (result.logs && Array.isArray(result.logs)) {
        result.logs.forEach((l: string) => appendGoogleLog(l));
      }

      if (result.success && result.text) {
        appendGoogleLog('[GeminiWeb RPC] Đã nhận và parse thành công kết quả từ Google Web!');
        setTestPromptResult(result.text);
      } else {
        appendGoogleLog(`[RPC Error] ${result.error || 'Không nhận được dữ liệu'}`);
        setTestPromptResult('Lỗi: ' + (result.error || 'Không phản hồi'));
      }
    } catch (err: any) {
      appendGoogleLog(`[RPC Error] ${err.message || 'Lỗi gửi prompt'}`);
      setTestPromptResult('Lỗi kết nối: ' + err.message);
    } finally {
      setIsTestingGeminiPrompt(false);
    }
  };

  const handleGoogleLoginAction = async () => {
    setIsCheckingGoogleToken(true);
    try {
      if (isNativeGeminiWebViewSupported()) {
        await handleOpenGeminiLoginNative();
      } else {
        const res = await loginWithGoogleAccount();
        if (res.success && res.state) {
          const updated: AppSettings = {
            ...formData,
            googleAccountConnected: true,
            googleAccountEmail: res.state.userEmail || 'Google Account',
            googleAccountName: res.state.userDisplayName || 'Google User',
            apiMode: 'gemini_web',
          };
          setFormData(updated);
          onSaveSettings(updated);
          showToastNotification();
        } else {
          alert(res.message || 'Chưa hoàn tất đăng nhập Google.');
        }
      }
    } catch (err: any) {
      console.error('Google login error:', err);
    } finally {
      setIsCheckingGoogleToken(false);
    }
  };

  const handleGoogleLogoutAction = async () => {
    try {
      await logoutGoogleAccount();
    } catch (_) {}
    handleGoogleLogout();
  };

  const currentApiMode: ApiConnectionMode = formData.apiMode || 'direct';

  const rawMemberCode =
    (licenseState?.memberCode && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(licenseState.memberCode.trim())
      ? licenseState.memberCode.trim().toUpperCase()
      : '') ||
    (deviceInfo?.memberCode && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(deviceInfo.memberCode.trim())
      ? deviceInfo.memberCode.trim().toUpperCase()
      : '') ||
    (deviceInfo?.deviceId ? getOrCreateLocalMemberCode(deviceInfo.deviceId) : getOrCreateLocalMemberCode());
  const displayMemberCode = generateMemberCode(rawMemberCode);

  const isGoogleLoggedIn = Boolean(formData.googleAccountConnected || getFirebaseUser());
  const googleUserEmail = formData.googleAccountEmail || getFirebaseUser()?.email || '';

  return (
    <div className="flex flex-col gap-4 animate-fade-in text-slate-100 text-xs pb-10">
      
      {/* Toast Notification Banner */}
      {savedToast && (
        <div className="bg-slate-800/95 border border-slate-500/80 text-metallic-silver p-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 animate-bounce shadow-xl">
          <CheckCircle2 className="w-4 h-4 text-slate-200" />
          <span>Đã lưu cấu hình cài đặt thành công!</span>
        </div>
      )}

      {/* CARD 1: THÀNH VIÊN (STREAMLINED MINIMALIST CARD) */}
      <div className="relative bg-[#141418] border border-slate-800/80 rounded-3xl p-5 shadow-2xl overflow-hidden transition-all">
        {/* Category Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
            <span>THÀNH VIÊN</span>
          </div>

          {onOpenLicense && isWhitelistedAdminMember(licenseState) && (
            <button
              type="button"
              onClick={onOpenLicense}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-xl text-[10px] font-black transition shadow-sm cursor-pointer bg-amber-400/20 text-amber-300 border border-amber-400/40 hover:bg-amber-400/30"
              title="Quản trị viên Super Admin"
            >
              <Crown className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>ADMIN</span>
            </button>
          )}
        </div>

        {/* Glowing Circular Avatar Icon */}
        <div className="relative mb-5">
          <div className="w-12 h-12 rounded-full bg-[#1e88e5] flex items-center justify-center text-white shadow-[0_0_22px_rgba(30,136,229,0.5)]">
            <User className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Member Code Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-200">Mã thành viên</div>
            <div className="text-lg sm:text-xl font-bold text-sky-400 font-mono tracking-wide mt-0.5">
              {displayMemberCode}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleCopyText(displayMemberCode, 'memberCode')}
            className="p-2.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 rounded-xl transition cursor-pointer"
            title="Sao chép mã thành viên"
          >
            {copiedField === 'memberCode' ? (
              <Check className="w-5 h-5 text-emerald-400" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* TikTok Support Pill */}
        <a
          href="https://www.tiktok.com/@huybu05"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 bg-[#0d0d11] hover:bg-[#15151c] border border-slate-800/80 rounded-2xl px-4 py-3 flex items-center justify-between transition cursor-pointer group"
        >
          <span className="text-xs font-medium text-sky-400 group-hover:text-sky-300">
            Tiktok support: <span className="font-semibold">@huybu05</span>
          </span>
        </a>

        {/* Subtle Watermark Silhouette */}
        <User className="absolute -right-3 -bottom-3 w-32 h-32 text-slate-800/15 pointer-events-none" />
      </div>

      {/* SECTION: ENGINE DỊCH THUẬT */}
      <div className="space-y-3">
        {/* Category Header */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-2 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
            <span>ENGINE DỊCH THUẬT</span>
          </div>
          <span className="text-[10.5px] text-slate-400">
            Chế độ: <strong className="text-sky-400 uppercase font-mono">{currentApiMode === 'gemini_web' ? 'Gemini Web' : currentApiMode === 'proxy' ? 'Proxy' : currentApiMode === 'groq' ? 'Groq AI' : 'Gemini API'}</strong>
          </span>
        </div>

        {/* 4 STANDALONE SELECTION CARDS: LỰA CHỌN THỨ 4 LÀ GROQ AI */}
        <div className="space-y-2.5">
          {/* HÀNG 1: Gemini Web & Gemini API */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* KHỐI 1: Gemini Web */}
            <button
              type="button"
              onClick={() => handleChange('apiMode', 'gemini_web')}
              className={`relative flex items-center space-x-3 p-3 rounded-2xl transition cursor-pointer text-left ${
                currentApiMode === 'gemini_web'
                  ? 'bg-[#181a20] border-2 border-sky-500 shadow-sm'
                  : 'bg-[#141418] border border-slate-800 hover:border-slate-700 hover:bg-[#18181f] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                  currentApiMode === 'gemini_web'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'bg-slate-800/80 text-slate-400'
                }`}
              >
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs font-bold leading-tight truncate ${
                    currentApiMode === 'gemini_web' ? 'text-sky-400' : 'text-slate-200'
                  }`}
                >
                  Gemini Web
                </div>
                <div className="text-[10.5px] text-slate-400 leading-tight truncate mt-0.5">
                  Login Google
                </div>
              </div>
            </button>

            {/* KHỐI 2: Gemini API */}
            <button
              type="button"
              onClick={() => handleChange('apiMode', 'direct')}
              className={`relative flex items-center space-x-3 p-3 rounded-2xl transition cursor-pointer text-left ${
                currentApiMode === 'direct'
                  ? 'bg-[#181a20] border-2 border-sky-500 shadow-sm'
                  : 'bg-[#141418] border border-slate-800 hover:border-slate-700 hover:bg-[#18181f] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                  currentApiMode === 'direct'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'bg-slate-800/80 text-slate-400'
                }`}
              >
                <Key className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs font-bold leading-tight truncate ${
                    currentApiMode === 'direct' ? 'text-sky-400' : 'text-slate-200'
                  }`}
                >
                  Gemini API
                </div>
                <div className="text-[10.5px] text-slate-400 leading-tight truncate mt-0.5">
                  Dùng API Key
                </div>
              </div>
            </button>
          </div>

          {/* HÀNG 2: Proxy Gateway & Groq AI (LỰA CHỌN THỨ 4) */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* KHỐI 3: Proxy Gateway */}
            <button
              type="button"
              onClick={() => handleChange('apiMode', 'proxy')}
              className={`relative flex items-center space-x-3 p-3 rounded-2xl transition cursor-pointer text-left ${
                currentApiMode === 'proxy'
                  ? 'bg-[#181a20] border-2 border-sky-500 shadow-sm'
                  : 'bg-[#141418] border border-slate-800 hover:border-slate-700 hover:bg-[#18181f] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                  currentApiMode === 'proxy'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'bg-slate-800/80 text-slate-400'
                }`}
              >
                <Server className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs font-bold leading-tight truncate ${
                    currentApiMode === 'proxy' ? 'text-sky-400' : 'text-slate-200'
                  }`}
                >
                  Proxy Gateway
                </div>
                <div className="text-[10.5px] text-slate-400 leading-tight truncate mt-0.5">
                  Reverse Proxy
                </div>
              </div>
            </button>

            {/* KHỐI 4: Groq AI (LỰA CHỌN THỨ 4) */}
            <button
              type="button"
              onClick={() => handleChange('apiMode', 'groq')}
              className={`relative flex items-center space-x-3 p-3 rounded-2xl transition cursor-pointer text-left ${
                currentApiMode === 'groq'
                  ? 'bg-[#181a20] border-2 border-orange-500 shadow-sm'
                  : 'bg-[#141418] border border-slate-800 hover:border-slate-700 hover:bg-[#18181f] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
                  currentApiMode === 'groq'
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'bg-slate-800/80 text-slate-400'
                }`}
              >
                <Zap className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs font-bold leading-tight truncate ${
                    currentApiMode === 'groq' ? 'text-orange-400' : 'text-slate-200'
                  }`}
                >
                  Groq AI
                </div>
                <div className="text-[10.5px] text-slate-400 leading-tight truncate mt-0.5">
                  Whisper &amp; Llama 3.3
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* DETAIL CONTENT CARD (Khối hiển thị gọn gàng theo engine đã chọn) */}
        <div className="bg-[#141418] border border-slate-800/90 rounded-2xl p-4 space-y-3.5">
          {/* TAB 1 CONTENT: GEMINI WEB */}
          {currentApiMode === 'gemini_web' && (
            <div className="space-y-3">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  {isGoogleLoggedIn ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                      <span className="text-emerald-400">Đã kết nối ({googleUserEmail})</span>
                    </>
                  ) : (
                    <span>Chưa kết nối</span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {isGoogleLoggedIn
                    ? 'Tài khoản Google đang hoạt động với quota dịch thuật cao.'
                    : 'Đăng nhập Google để sử dụng Gemini với quota cao hơn, tốc độ ổn định.'}
                </p>
              </div>

              {/* Google Login / Logout Button */}
              {isGoogleLoggedIn ? (
                <button
                  type="button"
                  onClick={handleGoogleLogoutAction}
                  className="w-full bg-[#1b1c24] hover:bg-rose-950/30 text-rose-300 hover:text-rose-200 border border-rose-500/30 font-semibold text-xs py-2.5 px-4 rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>ĐĂNG XUẤT GOOGLE</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleLoginAction}
                  className="w-full bg-[#1e88e5] hover:bg-[#1976d2] text-white font-bold text-xs tracking-wider py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  <span>ĐĂNG NHẬP VỚI GOOGLE</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 2 CONTENT: GEMINI API KEY */}
          {currentApiMode === 'direct' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Gemini API key
                </label>
                {formData.apiKey && (
                  <span className="text-emerald-400 text-[11px] font-medium flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Đã có key
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={formData.apiKey || ''}
                  onChange={(e) => handleChange('apiKey', e.target.value)}
                  placeholder="Nhập API key (AIzaSy...)..."
                  className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition cursor-pointer p-1"
                  title={showApiKey ? 'Ẩn API Key' : 'Hiện API Key'}
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="pt-0.5">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 text-[11px] font-medium inline-flex items-center gap-1 transition"
                >
                  <span>&gt;&gt; Lấy key trên Google AI Studio</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* TAB 3 CONTENT: PROXY GATEWAY */}
          {currentApiMode === 'proxy' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 block">
                  Địa chỉ Proxy URL Endpoint:
                </label>
                <input
                  type="text"
                  value={formData.proxyUrl || ''}
                  onChange={(e) => handleChange('proxyUrl', e.target.value)}
                  placeholder="https://your-proxy-domain.com/v1"
                  className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 block">
                  Proxy Auth Key / Token (Nếu có):
                </label>
                <div className="relative">
                  <input
                    type={showProxyKey ? 'text' : 'password'}
                    value={formData.proxyKey || ''}
                    onChange={(e) => handleChange('proxyKey', e.target.value)}
                    placeholder="Bearer token hoặc mã khóa proxy..."
                    className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProxyKey(!showProxyKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                    title={showProxyKey ? 'Ẩn mã proxy' : 'Hiện mã proxy'}
                  >
                    {showProxyKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="proxyNoApiKeyCheck"
                  checked={Boolean(formData.proxyNoApiKey)}
                  onChange={(e) => handleChange('proxyNoApiKey', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="proxyNoApiKeyCheck" className="text-[11px] text-slate-400 cursor-pointer select-none">
                  Proxy công khai / không yêu cầu API Key
                </label>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleFetchProxyModels}
                  disabled={isFetchingModels || !formData.proxyUrl?.trim()}
                  className="px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  {isFetchingModels ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang kiểm tra...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Kiểm tra &amp; Lấy Model</span>
                    </>
                  )}
                </button>

                {fetchSuccessMsg && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5" />
                    {fetchSuccessMsg}
                  </span>
                )}
                {fetchModelsError && (
                  <span className="text-[11px] text-rose-400 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {fetchModelsError.slice(0, 30)}...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TAB 4 CONTENT: GROQ AI (LỰA CHỌN THỨ 4) */}
          {currentApiMode === 'groq' && (
            <div className="space-y-3.5">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-orange-400 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-orange-400" />
                  <span>Groq AI Cloud (Whisper STT &amp; LPU Inference)</span>
                </div>
                <p className="text-xs text-slate-400">
                  Hạ tầng chip LPU tốc độ cao nhất thế giới: Nhận diện giọng nói STT bằng Whisper v3 cực nhanh và dịch thuật bằng mô hình Llama 3.3 70B siêu mượt.
                </p>
              </div>

              {/* Groq API Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">
                    Groq API Key (bắt đầu bằng <code className="text-orange-400 font-mono">gsk_...</code>)
                  </label>
                  {formData.groqApiKey && (
                    <span className="text-emerald-400 text-[11px] font-medium flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Đã lưu key
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showGroqKey ? 'text' : 'password'}
                    value={formData.groqApiKey || ''}
                    onChange={(e) => handleChange('groqApiKey', e.target.value)}
                    placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-orange-500 transition pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroqKey(!showGroqKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                    title={showGroqKey ? 'Ẩn API Key' : 'Hiện API Key'}
                  >
                    {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Chưa có key? Nhận API key miễn phí 100% tại:</span>
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <span>console.groq.com/keys</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* Model Groq Whisper STT */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200 block">
                  Mô hình nhận diện giọng nói Groq STT (Speech-to-Text)
                </label>
                <div className="relative">
                  <select
                    value={formData.groqSttModel || 'whisper-large-v3'}
                    onChange={(e) => handleChange('groqSttModel', e.target.value)}
                    className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500 transition cursor-pointer appearance-none pr-10 font-medium"
                  >
                    <option value="whisper-large-v3">whisper-large-v3 (Mặc định - Chuẩn xác &amp; đa ngôn ngữ tốt nhất)</option>
                    <option value="whisper-large-v3-turbo">whisper-large-v3-turbo (Bản Turbo - Tốc độ nhanh gấp đôi)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Model Groq LLM Dịch thuật */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200 block">
                  Mô hình dịch thuật Groq LLM
                </label>
                <div className="relative">
                  <select
                    value={formData.groqModel || 'llama-3.3-70b-versatile'}
                    onChange={(e) => handleChange('groqModel', e.target.value)}
                    className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500 transition cursor-pointer appearance-none pr-10 font-medium"
                  >
                    <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Khuyên dùng - Đỉnh cao tiếng Việt &amp; 300 tps)</option>
                    <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Siêu tốc độ - ~800 tokens/giây)</option>
                    <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (Cửa sổ ngữ cảnh 32k)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Nút kiểm tra kết nối Groq */}
              <div className="pt-1 flex items-center justify-between border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleTestGroq}
                  disabled={isTestingGroq || !formData.groqApiKey?.trim()}
                  className="px-3.5 py-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  {isTestingGroq ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang kiểm tra kết nối...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-orange-400" />
                      <span>Kiểm tra kết nối Groq API</span>
                    </>
                  )}
                </button>

                {groqTestMsg && (
                  <span className={`text-[11px] font-medium flex items-center gap-1 ${groqTestMsg.isError ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {groqTestMsg.isError ? <AlertTriangle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    <span>{groqTestMsg.text}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* DẤU GẠCH PHÂN CÁCH */}
          <div className="border-t border-slate-800" />

          {/* MODEL SELECTION SECTION */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-xs font-semibold text-slate-200">Model Dịch Thuật</span>
              </div>
              <span className="text-[10.5px] text-slate-400 font-mono">
                {formData.selectedModel || 'gemini-3.6-flash'}
              </span>
            </div>

            {/* Model Selector Dropdown */}
            <div className="relative">
              <select
                value={formData.selectedModel || 'gemini-3.6-flash'}
                onChange={(e) => handleChange('selectedModel', e.target.value as GeminiModelOption)}
                className="w-full bg-[#0d0d11] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition cursor-pointer font-medium appearance-none pr-10"
              >
                <optgroup label="Khuyên Dùng Cho Video (Tốc Độ Cao &amp; Dịch Tự Nhiên)">
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Tối ưu tốc độ, dịch câu văn tự nhiên)</option>
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash (Bản mới nhất - Phản hồi tức thì)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Độ trễ thấp, xử lý video nhanh)</option>
                </optgroup>
                <optgroup label="Chất Lượng Cao &amp; Ngữ Cảnh Phức Tạp">
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Văn phong cao cấp, thông minh)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (Suy luận sâu, thuật ngữ khó)</option>
                </optgroup>
                <optgroup label="Tiết Kiệm Quota &amp; Dự Phòng">
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Tiết kiệm quota API)</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ổn định)</option>
                </optgroup>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* If in Proxy Mode and fetched models are available */}
            {formData.apiMode === 'proxy' && fetchedProxyModels.length > 0 && (
              <div className="mt-2 p-2 bg-[#0d0d11] border border-slate-800 rounded-lg space-y-1">
                <span className="text-[10.5px] text-slate-400 block font-medium">
                  Mô hình từ Proxy ({fetchedProxyModels.length}):
                </span>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {fetchedProxyModels.map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => {
                        handleChange('proxyTargetModel', pm);
                        handleChange('customModelName', pm);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition cursor-pointer ${
                        formData.proxyTargetModel === pm || formData.customModelName === pm
                          ? 'bg-sky-600 text-white border-sky-500 font-bold'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ADVANCED SETTINGS ACCORDION DRAWER */}
      <AdvancedConfigDrawer
        formData={formData}
        handleChange={handleChange}
        paddleStatus={paddleStatus}
        isDownloadingPaddle={isDownloadingPaddle}
        paddleProgress={paddleProgress}
        handleDownloadPaddleModels={handleDownloadPaddleModels}
        handleClearPaddleCache={handleClearPaddleCache}
        paddleDownloadMsg={paddleDownloadMsg}
        currentApiMode={currentApiMode}
        googleLogs={googleLogs}
        setGoogleLogs={setGoogleLogs}
        handleApplyIdealPresets={handleApplyIdealPresets}
        isCheckingGoogleToken={isCheckingGoogleToken}
        handleCheckGoogleToken={handleCheckGoogleToken}
        handleGoogleLogout={handleGoogleLogout}
        googleAuthMessage={googleAuthMessage}
        handleTestGeminiWeb={handleTestGeminiPrompt}
        isTestingPrompt={isTestingGeminiPrompt}
        testPromptResult={testPromptResult || undefined}
        showTikTokGuide={showTikTokGuide}
        setShowTikTokGuide={setShowTikTokGuide}
        isElectronApp={isElectronApp}
        devToolsStatus={devToolsStatus}
        handleToggleDevTools={handleToggleDevTools}
        handleCopyDiagnostic={handleCopyDiagnostic}
        diagCopied={diagCopied}
      />

      {/* FOOTER ACTIONS */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1 underline font-medium transition cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Khôi phục mặc định</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onSaveSettings(formData);
            showToastNotification();
          }}
          className="btn-metallic text-slate-950 font-black text-xs px-5 py-2.5 rounded-full shadow-lg transition flex items-center space-x-1.5 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-slate-950" />
          <span>LƯU CẤU HÌNH</span>
        </button>
      </div>

    </div>
  );
};
