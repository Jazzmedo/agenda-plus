/**
 * Turning what someone typed into a note path.
 *
 * Kept free of the Obsidian API so the rules can be tested directly —
 * the suggester in `noteSuggest.ts` is only the UI on top.
 */

/** Characters Obsidian refuses in a file name. */
const ILLEGAL = /[\\:*?"<>|]/g;

/**
 * Normalises typed text into a vault path ending in `.md`.
 *
 * A bare name lands in `defaultFolder`, so "Groceries" becomes
 * "Calendar/Groceries.md" rather than cluttering the vault root. Typing
 * any slash is taken as an explicit location and left where it is.
 */
export function resolveNotePath(input: string, defaultFolder: string): string | undefined {
	let s = input.trim().replace(/^\/+|\/+$/g, "");
	if (!s) return undefined;

	s = s
		.split("/")
		.map((part) => part.replace(ILLEGAL, "").trim())
		.filter(Boolean)
		.join("/");
	if (!s) return undefined;

	if (!/\.md$/i.test(s)) s = `${s}.md`;

	const folder = defaultFolder.replace(/^\/+|\/+$/g, "");
	if (s.includes("/") || !folder) return s;
	return `${folder}/${s}`;
}

/** The note name without its folder or extension. */
export function noteBasename(path: string): string {
	return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}

/** The folder a note sits in, or "" at the vault root. */
export function noteFolder(path: string): string {
	const parts = path.split("/");
	parts.pop();
	return parts.join("/");
}

/**
 * Scores a note against a query. Higher is better, 0 means no match.
 *
 * The name is weighted well above the folder so that typing "tasks"
 * surfaces `Tasks.md` before every note that merely lives in a folder
 * called Tasks.
 */
export function scoreNote(path: string, query: string): number {
	const q = query.trim().toLowerCase();
	if (!q) return 1;

	const name = noteBasename(path).toLowerCase();
	const full = path.toLowerCase();

	if (name === q) return 100;
	if (name.startsWith(q)) return 80;
	if (name.includes(q)) return 60;
	if (full.includes(q)) return 40;

	// Subsequence match, so "cal/tk" still finds "Calendar/Tasks.md".
	let i = 0;
	for (const ch of full) {
		if (ch === q[i]) i++;
		if (i === q.length) return 20;
	}
	return 0;
}
