import { SubtitleStyleConfig } from '../types';

const LS_PREFERRED_FONT_KEY = 'capcut_user_preferred_font_v1';
const LS_LAST_STYLE_CONFIG_KEY = 'capcut_last_saved_style_config_v1';
const LS_CUSTOM_FONTS_KEY = 'capcut_custom_uploaded_fonts';

export interface CustomFontItem {
  label: string;
  value: string;
  dataUrl?: string;
  fontWeight?: string;
  fontStyle?: string;
}

export const GOOGLE_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@700&family=Be+Vietnam+Pro:wght@400;600;700;800;900&family=Bungee&family=Caveat:wght@700&family=Chakra+Petch:wght@700&family=Charm:wght@400;700&family=Cherry+Bomb+One&family=Coiny&family=Comfortaa:wght@700&family=Comforter+Brush&family=Dancing+Script:wght@700&family=Fira+Sans:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Sans:wght@400;700&family=Inter:wght@400;600;700;800;900&family=Itim&family=K2D:wght@700&family=Kanit:wght@700&family=Lexend:wght@400;600;700;800&family=Lobster&family=Mali:wght@700&family=Montserrat:wght@400;700;800;900&family=Mulish:wght@700;900&family=Nunito:wght@400;700;800;900&family=Oswald:wght@500;700&family=Pacifico&family=Patrick+Hand&family=Phudu:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Roboto+Condensed:wght@400;600;700;800;900&family=Roboto:wght@400;700;900&family=Space+Grotesk:wght@700&family=Syne:wght@700;800&display=swap';

/**
 * Ensures Google Web Fonts bundle is attached to the document head
 */
export function ensureGoogleFontsLoaded(): void {
  if (typeof document === 'undefined') return;
  const linkId = 'capcut-custom-fonts-bundle';
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_CSS_URL;
    document.head.appendChild(link);
  }
}

/**
 * Loads a FontFace object into document.fonts
 */
export async function registerFontFace(familyName: string, dataUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return false;
  }
  try {
    const cleanFamily = familyName.split(',')[0].replace(/['"]/g, '').trim();
    const fontFace = new FontFace(cleanFamily, `url(${dataUrl})`);
    const loaded = await fontFace.load();
    document.fonts.add(loaded);
    return true;
  } catch (err) {
    console.warn('[FontStorage] Failed to register FontFace:', familyName, err);
    return false;
  }
}

/**
 * Retrieves all saved custom uploaded fonts
 */
export function getSavedCustomFonts(): CustomFontItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_CUSTOM_FONTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[FontStorage] Error loading custom fonts from localStorage:', err);
    return [];
  }
}

/**
 * Saves or updates custom uploaded fonts in localStorage
 */
export function saveCustomFonts(fonts: CustomFontItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_CUSTOM_FONTS_KEY, JSON.stringify(fonts));
  } catch (err) {
    console.warn('[FontStorage] Error saving custom fonts to localStorage:', err);
  }
}

/**
 * Loads all saved custom fonts into document.fonts
 */
export async function loadAllSavedCustomFonts(): Promise<void> {
  ensureGoogleFontsLoaded();
  const customFonts = getSavedCustomFonts();
  for (const f of customFonts) {
    if (f.dataUrl) {
      await registerFontFace(f.value || f.label, f.dataUrl);
    }
  }
}

/**
 * Saves user preferred font family & style attributes
 */
export function saveUserPreferredFont(font: {
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_PREFERRED_FONT_KEY, JSON.stringify(font));
  } catch (err) {
    console.warn('[FontStorage] Error saving preferred font:', err);
  }
}

/**
 * Retrieves user preferred font
 */
export function getUserPreferredFont(): {
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFERRED_FONT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Saves user last style config for new projects & session persistence
 */
export function saveUserPreferredStyleConfig(style: Partial<SubtitleStyleConfig>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_LAST_STYLE_CONFIG_KEY, JSON.stringify(style));
  } catch (err) {
    console.warn('[FontStorage] Error saving preferred style config:', err);
  }
}

/**
 * Retrieves user last saved style config
 */
export function getUserPreferredStyleConfig(): Partial<SubtitleStyleConfig> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_LAST_STYLE_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
