import { Project } from '../types';
import { saveProjectToDB, deleteProjectFromDB } from './idbStorage';

const PROJECTS_STORAGE_KEY = 'subtranslate_capcut_projects_v1';

export const DEFAULT_PROJECTS: Project[] = [];

export function getSavedProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([]));
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Clean out sample projects if any
    const userProjects = parsed.filter((p: Project) => p && !p.id.startsWith('proj-sample-'));
    return userProjects;
  } catch (e) {
    console.error('Error reading saved projects:', e);
    return [];
  }
}

export function saveProject(project: Project): void {
  const updated = { ...project, updatedAt: Date.now() };

  // 1. Persist asynchronously to IndexedDB (Primary Store)
  try {
    saveProjectToDB(updated);
  } catch (idbErr) {
    console.error('Error saving project to IndexedDB:', idbErr);
  }

  // 2. Persist to localStorage safely with subtitles stripped/trimmed (Backup Store)
  try {
    const projects = getSavedProjects();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      projects[idx] = updated;
    } else {
      projects.unshift(updated);
    }
    
    // Trim subtitles array from all projects saved to localStorage to prevent QuotaExceededError
    const trimmedProjects = projects.map((p) => ({
      ...p,
      subtitles: [], // Keep metadata only in localStorage, IndexedDB retains the full subtitles list
    }));

    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(trimmedProjects));
  } catch (e) {
    console.warn('LocalStorage backup storage failed (quota exceeded or disabled), IndexedDB was used successfully instead.', e);
  }
}

export function deleteProject(id: string): Project[] {
  try {
    // Delete asynchronously from IndexedDB
    deleteProjectFromDB(id);

    const projects = getSavedProjects();
    const filtered = projects.filter((p) => p.id !== id);
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (_) {}
    return filtered;
  } catch (e) {
    console.error('Error deleting project:', e);
    return [];
  }
}

