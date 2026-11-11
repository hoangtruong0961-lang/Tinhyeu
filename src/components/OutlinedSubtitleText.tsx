import React, { useRef, useState, useEffect, useMemo } from 'react';
import { SubtitleStyleConfig } from '../types';

interface OutlinedSubtitleTextProps {
  text: string;
  styleConfig: Partial<SubtitleStyleConfig>;
  scaleFactor?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Optional karaoke timestamp word highlight array */
  timestamps?: Array<{ word: string; start: number; end: number }>;
  currentTime?: number;
  startTime?: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function wrapLineIfNeeded(line: string, font: string, maxWidth: number): string[] {
  if (!line || maxWidth <= 0) return [line];
  if (typeof document === 'undefined') return [line];
  try {
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      measureCtx = canvas.getContext('2d');
    }
    if (!measureCtx) return [line];
    measureCtx.font = font;
    if (measureCtx.measureText(line).width <= maxWidth) {
      return [line];
    }
    const words = line.split(/\s+/);
    if (words.length <= 1) return [line];
    const result: string[] = [];
    let current = '';
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const test = current ? `${current} ${word}` : word;
      if (measureCtx.measureText(test).width > maxWidth && i > 0) {
        result.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) result.push(current);
    return result;
  } catch {
    return [line];
  }
}

/**
 * Renders subtitle and title text using 100% vector SVG with stroke-linejoin="round"
 * and stroke-linecap="round".
 * Guarantees zero spikes ("gai nhọn") and zero aliasing ridges even at 1000% zoom,
 * while maintaining pixel-perfect DOM alignment and bounding-box bounding.
 */
export const OutlinedSubtitleText: React.FC<OutlinedSubtitleTextProps> = ({
  text,
  styleConfig,
  scaleFactor = 1,
  className = '',
  style = {},
  timestamps,
  currentTime = 0,
  startTime = 0,
}) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0) {
            setContainerWidth(entry.contentRect.width);
          }
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const fontColor = styleConfig.fontColor || '#ffffff';
  const outlineColor = styleConfig.outlineColor || '#000000';
  const rawOutlineWidth = Math.max(0, styleConfig.outlineWidth ?? 3);
  const textOutline = styleConfig.textOutline !== false && rawOutlineWidth > 0;
  const scaledOutlineWidth = textOutline ? rawOutlineWidth * scaleFactor : 0;

  const hasSecondaryOutline = styleConfig.hasSecondaryOutline === true ||
    (typeof styleConfig.secondaryOutlineWidth === 'number' && styleConfig.secondaryOutlineWidth > 0 && styleConfig.hasSecondaryOutline !== false);
  const secondaryOutlineColor = styleConfig.secondaryOutlineColor || '#000000';
  const rawSecOutlineWidth = Math.max(0, styleConfig.secondaryOutlineWidth ?? 4);
  const scaledSecOutlineWidth = hasSecondaryOutline ? rawSecOutlineWidth * scaleFactor : 0;

  const fontSize = (styleConfig.fontSize || 22) * scaleFactor;
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';
  const fontFamily = styleConfig.fontFamily || 'Montserrat, system-ui, sans-serif';
  const lineHeight = Math.max(12, Math.round(fontSize * 1.35));

  // Background box styling if enabled directly on component
  const hasBackground = styleConfig.hasBackground === true;
  const backgroundColor = styleConfig.backgroundColor || '#000000';
  const bgOpacity = styleConfig.bgOpacity ?? 65;

  const getRgba = (hexColor: string, opacityPercent: number) => {
    if (!hexColor) return `rgba(0, 0, 0, ${opacityPercent / 100})`;
    if (hexColor.startsWith('rgba')) return hexColor;
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return `rgba(0, 0, 0, ${opacityPercent / 100})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${(opacityPercent / 100).toFixed(2)})`;
  };

  const bgStyle = hasBackground ? getRgba(backgroundColor, bgOpacity) : 'transparent';
  const padding = hasBackground
    ? `${Math.max(2, Math.round((styleConfig.padding || 6) * scaleFactor))}px ${Math.max(4, Math.round((styleConfig.padding || 8) * scaleFactor))}px`
    : '0px';
  const borderRadius = `${Math.max(2, Math.round((styleConfig.borderRadius ?? 8) * scaleFactor))}px`;

  const textAlign = (styleConfig.textAlign as any) || 'center';
  const alignClass =
    textAlign === 'left' ? 'items-start text-left' :
    textAlign === 'right' ? 'items-end text-right' :
    'items-center text-center';

  const xPos = textAlign === 'left' ? '0%' : textAlign === 'right' ? '100%' : '50%';
  const textAnchor = textAlign === 'left' ? 'start' : textAlign === 'right' ? 'end' : 'middle';

  const textTransform = (styleConfig.textTransform as any) || 'none';

  // Soft Gaussian Drop Shadow for optimal video contrast
  const dropShadowFilter = styleConfig.textShadowColor
    ? `drop-shadow(${(styleConfig.textShadowOffsetX ?? 0) * scaleFactor}px ${(styleConfig.textShadowOffsetY ?? 2) * scaleFactor}px ${(styleConfig.textShadowBlur ?? 6) * scaleFactor}px ${styleConfig.textShadowColor})`
    : `drop-shadow(0px ${(2 * scaleFactor).toFixed(1)}px ${(4 * scaleFactor).toFixed(1)}px rgba(0,0,0,0.85))`;

  // Handle karaoke timestamps mode
  const hasKaraoke = timestamps && timestamps.length > 0;

  if (hasKaraoke) {
    const relTime = currentTime - startTime;
    return (
      <span
        ref={containerRef}
        className={`inline-block ${className}`}
        style={{
          fontFamily,
          fontSize: `${fontSize}px`,
          fontWeight,
          fontStyle,
          backgroundColor: bgStyle,
          padding,
          borderRadius,
          lineHeight: `${lineHeight}px`,
          textAlign,
          writingMode: styleConfig.orientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
          textOrientation: styleConfig.orientation === 'vertical' ? 'upright' : undefined,
          maxWidth: '100%',
          boxSizing: 'border-box',
          ...style,
        }}
      >
        {timestamps.map((ts, idx) => {
          const isActive = relTime >= ts.start && relTime <= ts.end;
          const wordColor = isActive ? '#facc15' : fontColor;
          return (
            <span
              key={idx}
              className={`inline-block relative transition-transform duration-75 ${
                isActive ? 'transform scale-105' : ''
              }`}
              style={{
                marginRight: '0.28em',
                lineHeight: `${lineHeight}px`,
              }}
            >
              {/* Invisible anchor word to guarantee exact pixel metrics & kerning */}
              <span
                aria-hidden="true"
                style={{
                  visibility: 'hidden',
                  display: 'inline-block',
                  fontFamily,
                  fontSize: `${fontSize}px`,
                  fontWeight,
                  fontStyle,
                  textTransform,
                  whiteSpace: 'pre',
                  lineHeight: `${lineHeight}px`,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {ts.word}
              </span>

              {/* 100% Vector SVG word with round join & cap */}
              <svg
                className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                style={{
                  filter: dropShadowFilter,
                  display: 'block',
                }}
              >
                {hasSecondaryOutline && scaledSecOutlineWidth > 0 && (
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="none"
                    stroke={secondaryOutlineColor}
                    strokeWidth={(scaledOutlineWidth + scaledSecOutlineWidth) * 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      textTransform,
                    }}
                  >
                    {ts.word}
                  </text>
                )}

                {textOutline && scaledOutlineWidth > 0 && (
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="none"
                    stroke={outlineColor}
                    strokeWidth={scaledOutlineWidth * 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      textTransform,
                    }}
                  >
                    {ts.word}
                  </text>
                )}

                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={wordColor}
                  style={{
                    fontFamily,
                    fontSize: `${fontSize}px`,
                    fontWeight,
                    fontStyle,
                    textTransform,
                  }}
                >
                  {ts.word}
                </text>
              </svg>
            </span>
          );
        })}
      </span>
    );
  }

  // Multiline & auto-wrapping text processing
  const rawLines = useMemo(() => {
    if (!text) return [''];
    return text.split('\n');
  }, [text]);

  const fontString = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

  const lines = useMemo(() => {
    if (!containerWidth || containerWidth <= 0) {
      return rawLines;
    }
    const wrapped: string[] = [];
    for (const rawLine of rawLines) {
      const split = wrapLineIfNeeded(rawLine, fontString, containerWidth - 4);
      wrapped.push(...split);
    }
    return wrapped.length > 0 ? wrapped : [''];
  }, [rawLines, containerWidth, fontString]);

  return (
    <span
      ref={containerRef}
      className={`inline-block ${className}`}
      style={{
        fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        backgroundColor: bgStyle,
        padding,
        borderRadius,
        lineHeight: `${lineHeight}px`,
        textAlign,
        writingMode: styleConfig.orientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
        textOrientation: styleConfig.orientation === 'vertical' ? 'upright' : undefined,
        maxWidth: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span className={`flex flex-col ${alignClass} justify-center w-full`}>
        {lines.map((line, lineIdx) => {
          const displayLine = line || '\u00A0';
          return (
            <div
              key={lineIdx}
              className="relative block w-full"
              style={{
                lineHeight: `${lineHeight}px`,
                minHeight: `${lineHeight}px`,
              }}
            >
              {/* Invisible text in standard layout flow:
                  1. Determines exact pixel-level natural DOM width even if container is fit-content
                  2. Guarantees the green/cyan bounding box conforms 100% to text */}
              <div
                aria-hidden="true"
                style={{
                  visibility: 'hidden',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  fontFamily,
                  fontSize: `${fontSize}px`,
                  fontWeight,
                  fontStyle,
                  textTransform,
                  textAlign,
                  whiteSpace: 'pre',
                  lineHeight: `${lineHeight}px`,
                  height: `${lineHeight}px`,
                }}
              >
                {displayLine}
              </div>

              {/* 100% Vector SVG Layer with stroke-linejoin="round" and stroke-linecap="round":
                  Mathematically rounded vertices with ZERO spikes/gai nhọn at any zoom level */}
              <svg
                className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                style={{
                  filter: dropShadowFilter,
                  display: 'block',
                }}
              >
                {/* Secondary Outer Outline (Viền kép) */}
                {hasSecondaryOutline && scaledSecOutlineWidth > 0 && (
                  <text
                    x={xPos}
                    y="50%"
                    textAnchor={textAnchor}
                    dominantBaseline="central"
                    fill="none"
                    stroke={secondaryOutlineColor}
                    strokeWidth={(scaledOutlineWidth + scaledSecOutlineWidth) * 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      textTransform,
                    }}
                  >
                    {line}
                  </text>
                )}

                {/* Primary Outline (Viền chính) */}
                {textOutline && scaledOutlineWidth > 0 && (
                  <text
                    x={xPos}
                    y="50%"
                    textAnchor={textAnchor}
                    dominantBaseline="central"
                    fill="none"
                    stroke={outlineColor}
                    strokeWidth={scaledOutlineWidth * 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      textTransform,
                    }}
                  >
                    {line}
                  </text>
                )}

                {/* Fill Text */}
                <text
                  x={xPos}
                  y="50%"
                  textAnchor={textAnchor}
                  dominantBaseline="central"
                  fill={fontColor}
                  style={{
                    fontFamily,
                    fontSize: `${fontSize}px`,
                    fontWeight,
                    fontStyle,
                    textTransform,
                  }}
                >
                  {line}
                </text>
              </svg>
            </div>
          );
        })}
      </span>
    </span>
  );
};
