/**
 * Task descriptions.
 *
 * A markdown checkbox is a single line, so longer notes live in the
 * indented block beneath it — ordinary markdown list continuation. That
 * keeps them readable in the editor, rendered by Obsidian in reading
 * view, and untouched by other plugins, which is why this beats hiding
 * the text in a block-referenced note or in frontmatter.
 *
 *     - [ ] Book the flights 📅 2026-08-01
 *         Window seat if possible.
 *         See [[Trip planning]] for the budget.
 */

import { isTaskLine } from "./parser";

export interface DescriptionBlock {
	/** The text, de-indented. Empty when the task has no description. */
	text: string;
	/** How many raw lines it occupies beneath the task line. */
	lines: number;
}

const EMPTY: DescriptionBlock = { text: "", lines: 0 };

/** Width of a line's leading whitespace, counting a tab as one level. */
function indentWidth(line: string): number {
	const ws = line.match(/^[ \t]*/)?.[0] ?? "";
	let width = 0;
	for (const ch of ws) width += ch === "\t" ? 4 : 1;
	return width;
}

/**
 * Reads the description block that follows a task line.
 *
 * A line belongs to the task when it is indented deeper than the task
 * itself. A nested checkbox ends the block — that is a subtask, not
 * prose. Blank lines are only kept when more description follows, so a
 * trailing gap before the next task isn't swallowed.
 */
export function readDescription(lines: string[], taskLine: number): DescriptionBlock {
	const task = lines[taskLine];
	if (task === undefined) return EMPTY;

	const base = indentWidth(task);
	const collected: string[] = [];
	let pendingBlanks = 0;
	let consumed = 0;

	for (let i = taskLine + 1; i < lines.length; i++) {
		const line = lines[i];

		if (!line.trim()) {
			pendingBlanks++;
			continue;
		}

		// Dedented, or a task of its own — the block is over.
		if (indentWidth(line) <= base || isTaskLine(line)) break;

		// The blanks turned out to be interior, so they belong to the block.
		for (let b = 0; b < pendingBlanks; b++) collected.push("");
		consumed += pendingBlanks;
		pendingBlanks = 0;

		collected.push(line);
		consumed++;
	}

	if (!collected.length) return EMPTY;

	// Strip the common indent so the stored text reads as plain markdown.
	const indents = collected.filter((l) => l.trim()).map((l) => indentWidth(l));
	const shared = Math.min(...indents);
	const text = collected
		.map((l) => (l.trim() ? stripIndent(l, shared) : ""))
		.join("\n")
		.replace(/\s+$/, "");

	return { text, lines: consumed };
}

/** Removes `width` columns of leading whitespace, tabs counting as four. */
function stripIndent(line: string, width: number): string {
	let removed = 0;
	let i = 0;
	while (i < line.length && removed < width) {
		const ch = line[i];
		if (ch === "\t") removed += 4;
		else if (ch === " ") removed += 1;
		else break;
		i++;
	}
	return line.slice(i);
}

/**
 * Renders a description back into indented lines beneath its task.
 *
 * Indentation is the task's own plus one tab, which is what Obsidian
 * writes when you press Tab inside a list.
 */
export function writeDescription(text: string, taskIndent: string): string[] {
	const trimmed = text.replace(/\s+$/, "");
	if (!trimmed.trim()) return [];

	const prefix = `${taskIndent}\t`;
	return trimmed.split("\n").map((line) => (line.trim() ? prefix + line : ""));
}
