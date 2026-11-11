import React, { useState, useRef, useEffect } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { Pipette, X } from 'lucide-react';

interface CustomColorPickerProps {
  color: string;
  onChange: (newColor: string) => void;
  className?: string;
  title?: string;
  showPipetteIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const PRESET_QUICK_SWATCHES = [
  '#ffffff',
  '#000000',
  '#ffe600',
  '#ea580c',
  '#ea3828',
  '#ec4899',
  '#a855f7',
  '#3b82f6',
  '#00a2ff',
  '#06b6d4',
  '#10b981',
  '#84cc16',
];

export const CustomColorPicker: React.FC<CustomColorPickerProps> = ({
  color,
  onChange,
  className = '',
  title = 'Chọn màu',
  showPipetteIcon = true,
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const safeColor = color && color.startsWith('#') ? color : '#00a2ff';

  const sizeClasses =
    size === 'sm'
      ? 'w-5 h-5'
      : size === 'lg'
      ? 'w-8 h-8 sm:w-9 sm:h-9'
      : 'w-7 h-7 sm:w-8 sm:h-8';

  return (
    <div ref={containerRef} className="relative inline-block select-none">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`${sizeClasses} rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer transition-transform active:scale-95 border border-white/20 shadow-md ${
          showPipetteIcon
            ? 'bg-gradient-to-tr from-pink-500 via-amber-400 to-sky-400'
            : ''
        } ${className}`}
        style={{
          backgroundColor: showPipetteIcon ? undefined : safeColor,
        }}
        title={title}
      >
        {showPipetteIcon ? (
          <Pipette className="w-3.5 h-3.5 text-white drop-shadow" />
        ) : (
          <span
            className="w-full h-full rounded-full border border-black/30"
            style={{ backgroundColor: safeColor }}
          />
        )}
      </button>

      {/* React Colorful Popover Modal */}
      {isOpen && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-zinc-900/98 backdrop-blur-xl border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col items-center gap-2.5 min-w-[210px] animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between w-full pb-1 border-b border-zinc-800">
            <span className="text-[11px] font-bold text-zinc-300">Bảng Chọn Màu</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-white p-0.5 rounded-lg hover:bg-zinc-800 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* react-colorful Picker */}
          <div className="custom-react-colorful-wrapper">
            <HexColorPicker color={safeColor} onChange={onChange} />
          </div>

          {/* Hex Code Input */}
          <div className="flex items-center space-x-2 w-full bg-zinc-950 px-2.5 py-1.5 rounded-xl border border-zinc-800">
            <span className="text-[10px] text-zinc-400 font-mono">HEX:</span>
            <HexColorInput
              color={safeColor}
              onChange={onChange}
              className="bg-transparent text-xs text-white font-mono uppercase focus:outline-none w-full"
              prefixed
            />
            <div
              className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0"
              style={{ backgroundColor: safeColor }}
            />
          </div>

          {/* Quick Swatches Grid */}
          <div className="grid grid-cols-6 gap-1.5 w-full pt-1">
            {PRESET_QUICK_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onChange(hex)}
                className={`w-6 h-6 rounded-lg transition-transform active:scale-90 border ${
                  safeColor.toLowerCase() === hex.toLowerCase()
                    ? 'border-sky-400 ring-2 ring-sky-400/50 scale-110'
                    : 'border-zinc-700 hover:scale-105'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
