// The user's macro library, kept in this browser. Diagrams do not depend on
// it: every instance carries its own copy of the definition.

import type { CustomDef } from '../model/types';

const KEY = 'bdd-macro-library';

export const loadLibrary = (): CustomDef[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && Array.isArray(d.shapes)) : [];
  } catch {
    return [];
  }
};

export const saveLibrary = (list: CustomDef[]): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
};

/** Library export / import as a JSON file, to move macros between browsers. */
export const libraryFile = (list: CustomDef[]) => new Blob([JSON.stringify({ bddMacros: 1, macros: list }, null, 2)], { type: 'application/json' });

export const parseLibraryFile = (text: string): CustomDef[] => {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.macros;
  if (!Array.isArray(list)) throw new Error('Not a macro library file');
  return list.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.shapes));
};
