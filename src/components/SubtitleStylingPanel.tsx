import React, { useState, useEffect, useRef } from 'react';
import {
  Check,
  Plus,
  X,
  Pipette,
  Ban,
} from 'lucide-react';
import { SubtitleStyleConfig } from '../types';
import { CustomColorPicker } from './CustomColorPicker';
import {
  ensureGoogleFontsLoaded,
  getSavedCustomFonts,
  saveCustomFonts,
  registerFontFace,
  saveUserPreferredFont,
  saveUserPreferredStyleConfig,
  CustomFontItem,
} from '../utils/fontStorage';

interface SubtitleStylingPanelProps {
  styleConfig: SubtitleStyleConfig;
  onChangeStyle: (newStyle: SubtitleStyleConfig) => void;
  onClose?: () => void;
}

interface FontOption {
  label: string;
  value: string;
  fontWeight?: string;
  fontStyle?: string;
}

// Swatch colors exactly matching CapCut mobile subtitle style editor
const PRESET_COLORS = [
  { name: 'Trắng', hex: '#ffffff' },
  { name: 'Đen', hex: '#000000' },
  { name: 'Vàng rực', hex: '#ffe600' },
  { name: 'Vàng nhạt', hex: '#fff59d' },
  { name: 'Vàng cam', hex: '#f59e0b' },
  { name: 'Cam tươi', hex: '#ea580c' },
  { name: 'Cam đào', hex: '#fb923c' },
  { name: 'Đỏ cam', hex: '#ea3828' },
  { name: 'Đỏ hồng', hex: '#f43f5e' },
  { name: 'Hồng sen', hex: '#ec4899' },
  { name: 'Tím', hex: '#a855f7' },
  { name: 'Xanh lam', hex: '#3b82f6' },
  { name: 'Xanh dương sáng', hex: '#00a2ff' },
  { name: 'Xanh ngọc', hex: '#06b6d4' },
  { name: 'Lục bảo', hex: '#10b981' },
  { name: 'Xanh chuối', hex: '#84cc16' },
];

// Preloaded fonts corresponding to CapCut mobile & Vietnamese video editor font collection
const POPULAR_FONTS: FontOption[] = [
  { label: 'Be Vietnam Pro', value: "'Be Vietnam Pro', sans-serif", fontWeight: '700' },
  { label: 'Roboto Condensed', value: "'Roboto Condensed Variable', 'Roboto Condensed', sans-serif", fontWeight: '700' },
  { label: 'Inter Variable', value: "'Inter Variable', 'Inter', sans-serif", fontWeight: '700' },
  { label: 'Dancing Script', value: "'Dancing Script', cursive", fontWeight: '700' },
  { label: 'Phudu Black', value: "'Phudu', cursive, sans-serif", fontWeight: '900' },
  { label: 'Phudu Bold', value: "'Phudu', cursive, sans-serif", fontWeight: '700' },
  { label: 'Phudu Medium', value: "'Phudu', cursive, sans-serif", fontWeight: '500' },
  { label: 'Phudu Regular', value: "'Phudu', cursive, sans-serif", fontWeight: '400' },
  { label: 'Montserrat Bold', value: "'Montserrat', sans-serif", fontWeight: '700' },
  { label: 'Montserrat Black', value: "'Montserrat', sans-serif", fontWeight: '900' },
  { label: 'Anton (Đánh Đá)', value: "'Anton', sans-serif", fontWeight: '700' },
  { label: 'Barlow Condensed', value: "'Barlow Condensed', sans-serif", fontWeight: '700' },
  { label: 'Bungee (Khối Thể Thao)', value: "'Bungee', cursive", fontWeight: '400' },
  { label: 'Coiny (Tròn Xinh)', value: "'Coiny', cursive", fontWeight: '400' },
  { label: 'Itim (Ngộ Nghĩnh)', value: "'Itim', cursive", fontWeight: '400' },
  { label: 'Kanit (Hiện Đại)', value: "'Kanit', sans-serif", fontWeight: '700' },
  { label: 'K2D (Phim Thần Thoại)', value: "'K2D', sans-serif", fontWeight: '700' },
  { label: 'Mali (Kể Chuyện)', value: "'Mali', cursive", fontWeight: '700' },
  { label: 'Mulish Black', value: "'Mulish', sans-serif", fontWeight: '900' },
  { label: 'Patrick Hand', value: "'Patrick Hand', cursive" },
  { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif", fontWeight: '700' },
  { label: 'Syne Extra', value: "'Syne', sans-serif", fontWeight: '800' },
  { label: 'Chakra Petch', value: "'Chakra Petch', sans-serif", fontWeight: '700' },
  { label: 'Inter Black', value: "'Inter', sans-serif", fontWeight: '900' },
  { label: 'Inter Bold', value: "'Inter', sans-serif", fontWeight: '700' },
  { label: 'Lexend Bold', value: "'Lexend', sans-serif", fontWeight: '700' },
  { label: 'Oswald Bold', value: "'Oswald', sans-serif", fontWeight: '700' },
  { label: 'Roboto Black', value: "'Roboto', sans-serif", fontWeight: '900' },
  { label: 'Roboto Bold', value: "'Roboto', sans-serif", fontWeight: '700' },
  { label: 'Nunito Black', value: "'Nunito', sans-serif", fontWeight: '900' },
  { label: 'Fira Sans Bold', value: "'Fira Sans', sans-serif", fontWeight: '700' },
  { label: 'Fira Sans Italic', value: "'Fira Sans', sans-serif", fontStyle: 'italic' },
  { label: 'Playfair Roman', value: "'Playfair Display', serif", fontWeight: '700' },
  { label: 'Playfair Italic', value: "'Playfair Display', serif", fontStyle: 'italic' },
  { label: 'Charm Flair', value: "'Charm', serif", fontWeight: '700', fontStyle: 'italic' },
  { label: 'Cherry Bomb', value: "'Cherry Bomb One', cursive" },
  { label: 'Comforter', value: "'Comforter Brush', cursive" },
  { label: 'Pacifico', value: "'Pacifico', cursive" },
  { label: 'Caveat Bold', value: "'Caveat', cursive", fontWeight: '700' },
  { label: 'Lobster', value: "'Lobster', cursive" },
  { label: 'Comfortaa Bold', value: "'Comfortaa', cursive", fontWeight: '700' },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', sans-serif", fontWeight: '700' },
  { label: 'Plus Jakarta', value: "'Plus Jakarta Sans', sans-serif", fontWeight: '700' },
];

export const SubtitleStylingPanel: React.FC<SubtitleStylingPanelProps> = ({
  styleConfig,
  onChangeStyle,
  onClose,
}) => {
  // Main tabs: 'font' (Phông chữ) | 'style' (Kiểu dáng)
  const [activeTab, setActiveTab] = useState<'font' | 'style'>('style');

  // Sub-tabs in 'Kiểu dáng': 'text' (Màu chữ) | 'border' (Màu viền) | 'bg' (Màu nền)
  const [styleSubTab, setStyleSubTab] = useState<'text' | 'border' | 'bg'>('text');

  // Dynamic user-uploaded custom fonts
  const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
  const [uploadError, setUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to wrap style changes and inject customUploadedFonts
  const handleStyleChange = (newStyle: SubtitleStyleConfig) => {
    const customUploadedFonts = customFonts
      .filter((f) => (f as any).dataUrl)
      .map((f) => {
        const familyName = f.value.split(',')[0].replace(/['"]/g, '');
        return { family: familyName, dataUrl: (f as any).dataUrl };
      });

    const finalStyle: SubtitleStyleConfig = {
      ...newStyle,
      customUploadedFonts: customUploadedFonts.length > 0 ? customUploadedFonts : undefined,
    };

    if (newStyle.fontFamily) {
      saveUserPreferredFont({
        fontFamily: newStyle.fontFamily,
        fontWeight: newStyle.fontWeight,
        fontStyle: newStyle.fontStyle,
      });
    }
    saveUserPreferredStyleConfig(finalStyle);
    onChangeStyle(finalStyle);
  };

  // Load custom fonts and register Google Web Fonts on mount
  useEffect(() => {
    ensureGoogleFontsLoaded();

    try {
      const saved = getSavedCustomFonts();
      if (saved && saved.length > 0) {
        setCustomFonts(saved);
        saved.forEach(async (font: CustomFontItem) => {
          if (font.dataUrl) {
            await registerFontFace(font.value || font.label, font.dataUrl);
          }
        });
      }
    } catch (err) {
      console.warn('[SubtitleStylingPanel] Error initializing fonts:', err);
    }
  }, []);

  // Handle custom local font file upload (.ttf, .otf, .woff, .woff2)
  const handleFontFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSizeBytes = 3 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setUploadError('Tệp phông chữ quá lớn. Vui lòng chọn tệp dưới 3MB.');
      return;
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const validExtensions = ['ttf', 'otf', 'woff', 'woff2'];
    if (!fileExt || !validExtensions.includes(fileExt)) {
      setUploadError('Vui lòng chọn tệp .ttf, .otf, .woff hoặc .woff2.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        setUploadError('Không thể đọc tệp phông chữ.');
        return;
      }

      const rawName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      const fontName = rawName.replace(/[^a-zA-Z0-9\-_]/g, '_');

      try {
        await registerFontFace(fontName, dataUrl);

        const newOption: FontOption = {
          label: rawName.length > 12 ? rawName.substring(0, 10) + '...' : rawName,
          value: `"${fontName}", sans-serif`,
        };

        const updatedCustom = [...customFonts, { ...newOption, dataUrl }];
        setCustomFonts(updatedCustom);
        saveCustomFonts(updatedCustom);

        handleStyleChange({
          ...styleConfig,
          fontFamily: newOption.value,
        });

        setUploadError('');
      } catch (err: any) {
        setUploadError('Lỗi nạp font: ' + (err.message || 'Kiểm tra tệp phông chữ.'));
      }
    };
    reader.readAsDataURL(file);
    // Reset file input so user can re-upload same file if desired
    e.target.value = '';
  };

  const handleDeleteCustomFont = (e: React.MouseEvent, fontVal: string) => {
    e.stopPropagation();
    const updated = customFonts.filter((f) => f.value !== fontVal);
    setCustomFonts(updated);
    saveCustomFonts(updated);
    if (styleConfig.fontFamily === fontVal) {
      handleStyleChange({
        ...styleConfig,
        fontFamily: 'system-ui, sans-serif',
      });
    }
  };

  // Current selected color helper based on sub-tab
  const getCurrentColor = () => {
    if (styleSubTab === 'text') {
      return (styleConfig.fontColor || '#ffffff').toLowerCase();
    }
    if (styleSubTab === 'border') {
      return (styleConfig.outlineColor || '#000000').toLowerCase();
    }
    return (styleConfig.backgroundColor || '#000000').toLowerCase();
  };

  const isColorSelected = (hex: string) => {
    const cur = getCurrentColor();
    if (styleSubTab === 'text') {
      return cur === hex.toLowerCase();
    }
    if (styleSubTab === 'border') {
      const isOutlineActive = styleConfig.textOutline !== false && (styleConfig.outlineWidth ?? 0) > 0;
      return isOutlineActive && cur === hex.toLowerCase();
    }
    const isBgActive = styleConfig.hasBackground === true && (styleConfig.bgOpacity ?? 0) > 0;
    return isBgActive && cur === hex.toLowerCase();
  };

  // Convert font size to scale format (16px = 1.0x, 18px = 1.1x, etc.)
  const currentScale = ((styleConfig.fontSize || 16) / 16).toFixed(1);

  // Check if default font is selected
  const isDefaultFontSelected =
    !styleConfig.fontFamily ||
    styleConfig.fontFamily === 'system-ui, sans-serif' ||
    styleConfig.fontFamily === 'sans-serif';

  return (
    <div className="w-full bg-[#18181a] text-white flex flex-col select-none h-[285px] min-h-[285px]">

      {/* TAB HEADER: "Phông chữ" | "Kiểu dáng"  -----  "✓" (Blue Checkmark) */}
      <div className="flex items-center justify-between px-5 pt-1.5 pb-2 flex-shrink-0">
        <div className="flex items-center space-x-7">
          {/* Tab 1: Phông chữ */}
          <button
            type="button"
            onClick={() => setActiveTab('font')}
            className="flex flex-col items-center cursor-pointer transition group"
          >
            <span
              className={`text-base font-bold transition-colors ${
                activeTab === 'font' ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-300'
              }`}
            >
              Phông chữ
            </span>
            {activeTab === 'font' && (
              <div className="w-full h-[3px] bg-[#00a2ff] rounded-full mt-1.5" />
            )}
          </button>

          {/* Tab 2: Kiểu dáng */}
          <button
            type="button"
            onClick={() => setActiveTab('style')}
            className="flex flex-col items-center cursor-pointer transition group"
          >
            <span
              className={`text-base font-bold transition-colors ${
                activeTab === 'style' ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-300'
              }`}
            >
              Kiểu dáng
            </span>
            {activeTab === 'style' && (
              <div className="w-full h-[3px] bg-[#00a2ff] rounded-full mt-1.5" />
            )}
          </button>
        </div>

        {/* Right confirm checkmark */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#00a2ff] hover:brightness-125 transition active:scale-90 cursor-pointer"
            title="Áp dụng & Đóng"
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3. CONTENT AREA: TAB "Phông chữ" (Screenshot 2) */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'font' && (
        <div className="px-4 pb-2 flex-1 min-h-0 flex flex-col gap-2">
          {uploadError && (
            <div className="text-[11px] text-red-400 bg-red-950/40 border border-red-800/40 px-3 py-1.5 rounded-lg flex items-center justify-between flex-shrink-0">
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError('')}
                className="text-red-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Hidden File Input for Custom Font */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttf,.otf,.woff2,.woff"
            onChange={handleFontFileUpload}
            className="hidden"
          />

          {/* 4-Column Grid of Font Cards */}
          <div className="grid grid-cols-4 gap-2 flex-1 min-h-0 overflow-y-auto scrollbar-none py-1">
            
            {/* Card 1: + Thêm font */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-[54px] rounded-xl border border-[#00a2ff]/40 bg-[#1b1f28] hover:bg-[#202632] flex flex-col items-center justify-center cursor-pointer transition active:scale-95 group shadow-sm"
              title="Nhấp để thêm tệp font từ máy (.ttf, .otf, .woff, .woff2)"
            >
              <Plus className="w-4 h-4 text-[#00a2ff] mb-0.5 group-hover:scale-110 transition" />
              <span className="text-[11px] font-semibold text-[#00a2ff]">Thêm font</span>
            </button>

            {/* Card 2: Mặc định */}
            <button
              type="button"
              onClick={() => {
                handleStyleChange({
                  ...styleConfig,
                  fontFamily: 'system-ui, sans-serif',
                  fontWeight: 'bold',
                  fontStyle: 'normal',
                });
              }}
              className={`h-[54px] rounded-xl px-1.5 flex items-center justify-center text-center transition cursor-pointer select-none active:scale-95 ${
                isDefaultFontSelected
                  ? 'border-2 border-[#00a2ff] bg-[#172332] text-white font-bold'
                  : 'border border-transparent bg-[#242529] hover:bg-[#2c2d33] text-zinc-300 font-medium'
              }`}
            >
              <span className="text-xs truncate">Mặc định</span>
            </button>

            {/* Preloaded fonts corresponding to Screenshot 2 */}
            {POPULAR_FONTS.map((font, idx) => {
              const isSelected =
                styleConfig.fontFamily === font.value &&
                (!font.fontWeight || styleConfig.fontWeight === font.fontWeight) &&
                (!font.fontStyle || styleConfig.fontStyle === font.fontStyle);

              return (
                <button
                  key={`preload-${idx}`}
                  type="button"
                  onClick={() => {
                    handleStyleChange({
                      ...styleConfig,
                      fontFamily: font.value,
                      fontWeight: (font.fontWeight as any) || styleConfig.fontWeight || 'bold',
                      fontStyle: (font.fontStyle as any) || styleConfig.fontStyle || 'normal',
                    });
                  }}
                  className={`h-[54px] rounded-xl px-1.5 flex items-center justify-center text-center transition cursor-pointer select-none active:scale-95 ${
                    isSelected
                      ? 'border-2 border-[#00a2ff] bg-[#172332] text-white font-bold'
                      : 'border border-transparent bg-[#242529] hover:bg-[#2c2d33] text-zinc-300 font-medium'
                  }`}
                  style={{
                    fontFamily: font.value,
                    fontWeight: font.fontWeight || 'normal',
                    fontStyle: font.fontStyle || 'normal',
                  }}
                >
                  <span className="text-[11px] truncate max-w-full block select-none">
                    {font.label}
                  </span>
                </button>
              );
            })}

            {/* User Custom Uploaded Fonts */}
            {customFonts.map((font, idx) => {
              const isSelected = styleConfig.fontFamily === font.value;

              return (
                <div key={`custom-${idx}`} className="relative group">
                  <button
                    type="button"
                    onClick={() => {
                      handleStyleChange({
                        ...styleConfig,
                        fontFamily: font.value,
                      });
                    }}
                    className={`w-full h-[54px] rounded-xl px-1.5 flex items-center justify-center text-center transition cursor-pointer select-none active:scale-95 ${
                      isSelected
                        ? 'border-2 border-[#00a2ff] bg-[#172332] text-white font-bold'
                        : 'border border-transparent bg-[#242529] hover:bg-[#2c2d33] text-zinc-300 font-medium'
                    }`}
                    style={{ fontFamily: font.value }}
                  >
                    <span className="text-[11px] truncate max-w-full block select-none">
                      {font.label}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDeleteCustomFont(e, font.value)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-md z-10 cursor-pointer"
                    title="Xóa font tùy chỉnh này"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. CONTENT AREA: TAB "Kiểu dáng" */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'style' && (
        <div className="px-4 pb-2 flex-1 min-h-0 flex flex-col justify-start gap-2.5 overflow-y-auto scrollbar-none">
          
          {/* Sub-tab 3 buttons: Màu chữ | Màu viền | Màu nền */}
          <div className="grid grid-cols-3 gap-2.5 w-full pt-0.5">
            <button
              type="button"
              onClick={() => setStyleSubTab('text')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer ${
                styleSubTab === 'text'
                  ? 'bg-[#00a2ff] text-white'
                  : 'bg-[#26272b] text-zinc-400 font-medium hover:text-zinc-200 hover:bg-[#2f3036]'
              }`}
            >
              Màu chữ
            </button>

            <button
              type="button"
              onClick={() => setStyleSubTab('border')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer ${
                styleSubTab === 'border'
                  ? 'bg-[#00a2ff] text-white'
                  : 'bg-[#26272b] text-zinc-400 font-medium hover:text-zinc-200 hover:bg-[#2f3036]'
              }`}
            >
              Màu viền
            </button>

            <button
              type="button"
              onClick={() => setStyleSubTab('bg')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer ${
                styleSubTab === 'bg'
                  ? 'bg-[#00a2ff] text-white'
                  : 'bg-[#26272b] text-zinc-400 font-medium hover:text-zinc-200 hover:bg-[#2f3036]'
              }`}
            >
              Màu nền
            </button>
          </div>

          {/* Color Circles Row: Horizontal scrollable swatches */}
          <div className="flex items-center space-x-2.5 overflow-x-auto py-0.5 scrollbar-none">
            {/* Icon Tắt viền (bên trái màu trắng khi chọn subtab Màu viền) */}
            {styleSubTab === 'border' && (
              <button
                type="button"
                onClick={() => {
                  handleStyleChange({
                    ...styleConfig,
                    textOutline: false,
                    outlineWidth: 0,
                  });
                }}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center relative flex-shrink-0 transition transform active:scale-90 cursor-pointer bg-[#242529] border ${
                  styleConfig.textOutline === false || (styleConfig.outlineWidth ?? 0) === 0
                    ? 'border-[#00a2ff] ring-2 ring-[#00a2ff]/40 text-[#00a2ff]'
                    : 'border-zinc-700 hover:border-zinc-500 text-zinc-400'
                }`}
                title="Tắt viền"
              >
                <Ban className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}

            {/* Icon Tắt nền (bên trái màu trắng khi chọn subtab Màu nền) */}
            {styleSubTab === 'bg' && (
              <button
                type="button"
                onClick={() => {
                  handleStyleChange({
                    ...styleConfig,
                    hasBackground: false,
                    bgOpacity: 0,
                    backgroundColor: 'transparent',
                  });
                }}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center relative flex-shrink-0 transition transform active:scale-90 cursor-pointer bg-[#242529] border ${
                  styleConfig.hasBackground === false || (styleConfig.bgOpacity ?? 0) === 0
                    ? 'border-[#00a2ff] ring-2 ring-[#00a2ff]/40 text-[#00a2ff]'
                    : 'border-zinc-700 hover:border-zinc-500 text-zinc-400'
                }`}
                title="Tắt nền"
              >
                <Ban className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}

            {PRESET_COLORS.map((color) => {
              const selected = isColorSelected(color.hex);
              const isBright =
                color.hex === '#ffffff' ||
                color.hex === '#fff59d' ||
                color.hex === '#ffe600';

              return (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => {
                    if (styleSubTab === 'text') {
                      handleStyleChange({ ...styleConfig, fontColor: color.hex });
                    } else if (styleSubTab === 'border') {
                      handleStyleChange({
                        ...styleConfig,
                        outlineColor: color.hex,
                        textOutline: true,
                        outlineWidth: styleConfig.outlineWidth && styleConfig.outlineWidth > 0 ? styleConfig.outlineWidth : 3,
                      });
                    } else {
                      handleStyleChange({
                        ...styleConfig,
                        backgroundColor: color.hex,
                        hasBackground: true,
                        bgOpacity: styleConfig.bgOpacity && styleConfig.bgOpacity > 0 ? styleConfig.bgOpacity : 65,
                      });
                    }
                  }}
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center relative flex-shrink-0 transition transform active:scale-90 cursor-pointer ${
                    color.hex === '#ffffff'
                      ? 'border border-[#4a4b50]'
                      : color.hex === '#000000'
                      ? 'border border-[#38393e]'
                      : 'border border-transparent'
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={color.name}
                >
                  {selected && (
                    <Check
                      className={`w-4 h-4 stroke-[3] ${
                        isBright ? 'text-[#00a2ff]' : 'text-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}

            {/* Custom Color Picker Swatch (react-colorful) */}
            <CustomColorPicker
              color={getCurrentColor().startsWith('#') ? getCurrentColor() : '#00a2ff'}
              onChange={(val) => {
                if (styleSubTab === 'text') {
                  handleStyleChange({ ...styleConfig, fontColor: val });
                } else if (styleSubTab === 'border') {
                  handleStyleChange({
                    ...styleConfig,
                    outlineColor: val,
                    textOutline: true,
                    outlineWidth: styleConfig.outlineWidth && styleConfig.outlineWidth > 0 ? styleConfig.outlineWidth : 3,
                  });
                } else {
                  handleStyleChange({
                    ...styleConfig,
                    backgroundColor: val,
                    hasBackground: true,
                    bgOpacity: styleConfig.bgOpacity && styleConfig.bgOpacity > 0 ? styleConfig.bgOpacity : 65,
                  });
                }
              }}
              title="Chọn màu khác"
              showPipetteIcon={true}
            />
          </div>

          {/* Sub-tab extras: Stable slot so switching between text / border / bg never jumps */}
          <div className="min-h-[36px] flex flex-col justify-center">
            {styleSubTab === 'border' && (
              <div className="w-full space-y-2">
                {/* Viền chính */}
                <div className="w-full flex items-center justify-between gap-3 px-3 py-1.5 bg-[#202125] rounded-xl border border-zinc-800/60">
                  <span className="text-xs text-zinc-300 font-medium">Độ dày viền chính</span>
                  <div className="flex items-center gap-3 flex-1 max-w-[200px]">
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={styleConfig.textOutline === false ? 0 : (styleConfig.outlineWidth ?? 3)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        handleStyleChange({
                          ...styleConfig,
                          outlineWidth: val,
                          textOutline: val > 0,
                        });
                      }}
                      className="flex-1 accent-[#00a2ff] cursor-pointer h-1 bg-zinc-700/60 rounded-full"
                    />
                    <span className="text-xs text-zinc-400 font-mono w-8 text-right">
                      {styleConfig.textOutline === false ? '0' : (styleConfig.outlineWidth ?? 3)}px
                    </span>
                  </div>
                </div>

                {/* Tùy chọn Viền Kép (Double Outline) */}
                <div className="w-full bg-[#202125] rounded-xl border border-zinc-800/60 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">Viền kép (Stroke 2)</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                        styleConfig.hasSecondaryOutline
                          ? 'bg-[#00a2ff]/20 text-[#00a2ff] border-[#00a2ff]/40 font-bold'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}>
                        {styleConfig.hasSecondaryOutline ? 'BẬT' : 'TẮT'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const nextHasSec = !styleConfig.hasSecondaryOutline;
                        handleStyleChange({
                          ...styleConfig,
                          hasSecondaryOutline: nextHasSec,
                          secondaryOutlineWidth: styleConfig.secondaryOutlineWidth || 4,
                          secondaryOutlineColor: styleConfig.secondaryOutlineColor || '#000000',
                        });
                      }}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                        styleConfig.hasSecondaryOutline ? 'bg-[#00a2ff]' : 'bg-[#3a3a40]'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                          styleConfig.hasSecondaryOutline ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {styleConfig.hasSecondaryOutline && (
                    <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                      {/* Secondary Outline Color picker */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400 font-medium">Màu viền ngoài</span>
                        <div className="flex items-center gap-1.5">
                          {['#000000', '#ffffff', '#ff0000', '#00a2ff', '#ffe600'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                handleStyleChange({
                                  ...styleConfig,
                                  secondaryOutlineColor: c,
                                });
                              }}
                              className={`w-5 h-5 rounded-full border transition active:scale-95 cursor-pointer ${
                                (styleConfig.secondaryOutlineColor || '#000000').toLowerCase() === c
                                  ? 'border-[#00a2ff] ring-2 ring-[#00a2ff]/40'
                                  : 'border-zinc-700'
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                          <CustomColorPicker
                            color={styleConfig.secondaryOutlineColor || '#000000'}
                            onChange={(val) => {
                              handleStyleChange({
                                ...styleConfig,
                                secondaryOutlineColor: val,
                              });
                            }}
                            showPipetteIcon={false}
                            size="sm"
                            title="Chọn màu viền kép"
                          />
                        </div>
                      </div>

                      {/* Secondary Outline Width slider */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-zinc-400 font-medium">Độ dày viền ngoài</span>
                        <div className="flex items-center gap-3 flex-1 max-w-[180px]">
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="0.5"
                            value={styleConfig.secondaryOutlineWidth ?? 4}
                            onChange={(e) => {
                              handleStyleChange({
                                ...styleConfig,
                                secondaryOutlineWidth: parseFloat(e.target.value),
                              });
                            }}
                            className="flex-1 accent-[#00a2ff] cursor-pointer h-1 bg-zinc-700/60 rounded-full"
                          />
                          <span className="text-xs text-zinc-400 font-mono w-8 text-right">
                            {styleConfig.secondaryOutlineWidth ?? 4}px
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {styleSubTab === 'bg' && (
              <div className="w-full flex items-center justify-between gap-3 px-3 py-1 bg-[#202125] rounded-xl border border-zinc-800/60">
                <span className="text-xs text-zinc-300 font-medium">Độ mờ khối nền</span>
                <div className="flex items-center gap-3 flex-1 max-w-[200px]">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={styleConfig.hasBackground === false ? 0 : (styleConfig.bgOpacity ?? 65)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      handleStyleChange({
                        ...styleConfig,
                        bgOpacity: val,
                        hasBackground: val > 0,
                      });
                    }}
                    className="flex-1 accent-[#00a2ff] cursor-pointer h-1 bg-zinc-700/60 rounded-full"
                  />
                  <span className="text-xs text-zinc-400 font-mono w-8 text-right">
                    {styleConfig.hasBackground === false ? '0' : (styleConfig.bgOpacity ?? 65)}%
                  </span>
                </div>
              </div>
            )}

            {styleSubTab === 'text' && (
              <div className="w-full flex items-center justify-between px-3 py-1 bg-[#202125]/60 rounded-xl border border-zinc-800/40 text-[11px] text-zinc-400">
                <span>Màu hiển thị chữ phụ đề</span>
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ backgroundColor: styleConfig.fontColor || '#ffffff' }} />
                  <span className="font-mono text-zinc-300 uppercase">{getCurrentColor()}</span>
                </div>
              </div>
            )}
          </div>

          {/* Row 3: "Kích thước chữ" slider with 1.0x */}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <span className="text-xs sm:text-sm text-zinc-200 font-medium whitespace-nowrap">
              Kích thước chữ
            </span>
            <div className="flex items-center gap-2.5 flex-1 max-w-[280px]">
              <input
                type="range"
                min="10"
                max="40"
                step="1"
                value={styleConfig.fontSize || 16}
                onChange={(e) => {
                  handleStyleChange({
                    ...styleConfig,
                    fontSize: parseInt(e.target.value, 10),
                  });
                }}
                className="flex-1 accent-[#00a2ff] cursor-pointer h-1 bg-zinc-700/60 rounded-full"
              />
              <span className="text-xs text-zinc-300 font-medium w-8 text-right select-none">
                {currentScale}x
              </span>
            </div>
          </div>

          {/* Row 4: "Hiệu ứng" buttons */}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <span className="text-xs sm:text-sm text-zinc-200 font-normal whitespace-nowrap">
              Hiệu ứng
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleStyleChange({ ...styleConfig, textEffect: 'none' })}
                className={`px-3.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  !styleConfig.textEffect || styleConfig.textEffect === 'none'
                    ? 'bg-[#00a2ff] text-white shadow-sm'
                    : 'bg-[#26272b] text-zinc-400 hover:text-zinc-200 hover:bg-[#2f3036]'
                }`}
              >
                Tắt
              </button>

              <button
                type="button"
                onClick={() => handleStyleChange({ ...styleConfig, textEffect: 'word' })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  styleConfig.textEffect === 'word'
                    ? 'bg-[#00a2ff] text-white shadow-sm'
                    : 'bg-[#26272b] text-zinc-400 hover:text-zinc-200 hover:bg-[#2f3036]'
                }`}
              >
                Từng chữ
              </button>

              <button
                type="button"
                onClick={() => handleStyleChange({ ...styleConfig, textEffect: 'sweep' })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  styleConfig.textEffect === 'sweep'
                    ? 'bg-[#00a2ff] text-white shadow-sm'
                    : 'bg-[#26272b] text-zinc-400 hover:text-zinc-200 hover:bg-[#2f3036]'
                }`}
              >
                Quét mượt
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
