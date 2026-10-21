/** Pure path helpers — deliberately free of any Obsidian import so they can
 *  be unit tested. */

/**
 * True when `path` is the folder itself or sits anywhere beneath it.
 *
 * The trailing slash matters: a bare `startsWith(folder)` would make
 * "Calender" swallow "CalenderOld/note.md", silently pulling an unrelated
 * folder into scope.
 */
export function inFolder(path: string, folder: string): boolean {
	if (!folder) return false;
	return path === folder || path.startsWith(`${folder}/`);
}
