import { CSSProperties } from 'react';
import { SubtitleStyleConfig } from '../types';

export interface TextEffectPreset {
  id: string;
  name: string;
  description: string;
  style: Partial<SubtitleStyleConfig>;
}

export const TEXT_EFFECT_PRESETS: TextEffectPreset[] = [];

/**
 * Helper to generate a dense, smooth circle of text-shadow entries for a given radius range and color.
 * Step size along circumference is kept <= 1.2px to ensure 100% gapless, smooth curves without miter spikes.
 */
function generateSmoothOutlineShadows(
  minRadius: number,
  maxRadius: number,
  color: string,
  scaleFactor: number = 1
): string[] {
  const shadows: string[] = [];
  const minR = Math.max(0.4, minRadius * scaleFactor);
  const maxR = maxRadius * scaleFactor;
  if (maxR <= 0) return shadows;

  // Step radial distance in dense increments (<= 0.7px) to ensure no hollow gaps or stepped ridges
  const radialStep = Math.max(0.4, 0.7 * scaleFactor);
  const perimeterStep = Math.max(0.4, 0.75 * scaleFactor);
  
  for (let r = minR; r < maxR; r += radialStep) {
    const numAngles = Math.max(12, Math.round((2 * Math.PI * r) / perimeterStep));
    for (let i = 0; i < numAngles; i++) {
      const angle = (i * 2 * Math.PI) / numAngles;
      const x = (Math.cos(angle) * r).toFixed(2);
      const y = (Math.sin(angle) * r).toFixed(2);
      shadows.push(`${x}px ${y}px 0 ${color}`);
    }
  }

  // Ensure the exact outer edge radius `maxR` is included with dense circular sampling
  const outerAngles = Math.max(16, Math.round((2 * Math.PI * maxR) / perimeterStep));
  for (let i = 0; i < outerAngles; i++) {
    const angle = (i * 2 * Math.PI) / outerAngles;
    const x = (Math.cos(angle) * maxR).toFixed(2);
    const y = (Math.sin(angle) * maxR).toFixed(2);
    shadows.push(`${x}px ${y}px 0 ${color}`);
  }

  return shadows;
}

/**
 * Builds clean, vector-smooth CSS text styling with gapless multi-radius outline shadows
 * to eliminate all spiky ("gai/tua rua") edge artifacts across all fonts and accents.
 */
export function getSubtitleCssStyle(
  styleConfig: Partial<SubtitleStyleConfig>,
  scaleFactor: number = 1
): CSSProperties {
  const fontColor = styleConfig.fontColor || '#ffffff';
  const outlineColor = styleConfig.outlineColor || '#000000';
  const outlineWidth = Math.max(0, styleConfig.outlineWidth ?? 3);
  const textOutline = styleConfig.textOutline !== false && outlineWidth > 0;

  const hasSecondaryOutline = styleConfig.hasSecondaryOutline === true ||
    (typeof styleConfig.secondaryOutlineWidth === 'number' && styleConfig.secondaryOutlineWidth > 0 && styleConfig.hasSecondaryOutline !== false);
  const secondaryOutlineColor = styleConfig.secondaryOutlineColor || '#000000';
  const secondaryOutlineWidth = Math.max(0, styleConfig.secondaryOutlineWidth ?? 4);

  const shadowParts: string[] = [];

  // 1. Primary Text Outline (e.g. Black stroke) - Rendered on top in text-shadow
  if (textOutline) {
    const primaryShadows = generateSmoothOutlineShadows(0, outlineWidth, outlineColor, scaleFactor);
    shadowParts.push(...primaryShadows);
  }

  // 2. Secondary Text Outline (Viền kép) - Extends further out behind primary
  if (hasSecondaryOutline && secondaryOutlineWidth > 0) {
    const baseOffset = textOutline ? outlineWidth : 0;
    const secondaryShadows = generateSmoothOutlineShadows(
      baseOffset,
      baseOffset + secondaryOutlineWidth,
      secondaryOutlineColor,
      scaleFactor
    );
    shadowParts.push(...secondaryShadows);
  }

  // Drop Shadow for high readability contrast
  if (styleConfig.textShadowColor) {
    const blur = (styleConfig.textShadowBlur ?? 8) * scaleFactor;
    const offX = (styleConfig.textShadowOffsetX ?? 0) * scaleFactor;
    const offY = (styleConfig.textShadowOffsetY ?? 2) * scaleFactor;
    shadowParts.push(`${offX}px ${offY}px ${blur}px ${styleConfig.textShadowColor}`);
  } else {
    shadowParts.push(`0 ${(2 * scaleFactor).toFixed(1)}px ${(6 * scaleFactor).toFixed(1)}px rgba(0,0,0,0.85)`);
  }

  return {
    color: fontColor,
    textShadow: shadowParts.length > 0 ? shadowParts.join(', ') : undefined,
  } as CSSProperties;
}

/**
 * Legacy/Unified builder for CSS textShadow string.
 */
export function buildTextShadowStyle(styleConfig: Partial<SubtitleStyleConfig>): string {
  const cssObj = getSubtitleCssStyle(styleConfig, 1);
  return cssObj.textShadow || '0 2px 6px rgba(0,0,0,0.9)';
}
