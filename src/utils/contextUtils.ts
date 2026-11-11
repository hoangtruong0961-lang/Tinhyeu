import { GlobalMovieContext, GlossaryEntity } from '../types';

export function stringifyValue(val: any, fallback = ''): string {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    const parts: string[] = [];
    if (val.principles) parts.push(`Nguyên tắc: ${stringifyValue(val.principles)}`);
    if (val.characterDynamics) parts.push(`Quan hệ nhân vật: ${stringifyValue(val.characterDynamics)}`);
    if (parts.length > 0) return parts.join(' | ');
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${stringifyValue(v)}`)
      .join(' | ');
  }
  return fallback;
}

export function normalizeGlobalContext(rawCtx: any): GlobalMovieContext | null {
  if (!rawCtx || typeof rawCtx !== 'object') return null;

  const movieGenre = stringifyValue(rawCtx.movieGenre, 'Tự động');
  const eraAndSetting = stringifyValue(rawCtx.eraAndSetting, 'Tự nhiên');
  const characterPronounGuide = stringifyValue(rawCtx.characterPronounGuide, 'Xưng hô tự nhiên theo bối cảnh.');
  const summary = stringifyValue(rawCtx.summary, '');

  let knownEntityGlossary: GlossaryEntity[] = [];
  if (Array.isArray(rawCtx.knownEntityGlossary)) {
    knownEntityGlossary = rawCtx.knownEntityGlossary
      .filter((item: any) => item && (item.original || item.translated))
      .map((item: any) => ({
        original: stringifyValue(item.original, ''),
        translated: stringifyValue(item.translated, ''),
        type: (typeof item.type === 'string' && ['character', 'location', 'term', 'organization', 'other'].includes(item.type))
          ? item.type
          : 'term',
        description: item.description ? stringifyValue(item.description, '') : undefined,
      }));
  }

  return {
    movieGenre,
    eraAndSetting,
    characterPronounGuide,
    summary,
    knownEntityGlossary,
  };
}
