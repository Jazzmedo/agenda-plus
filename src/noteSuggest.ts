/**
 * Autocomplete for "which note should this task go in".
 *
 * Types ahead over every markdown note in the vault, and offers to
 * create one when what you typed doesn't exist yet — so a task never
 * has to be filed somewhere it doesn't belong just because the note
 * hasn't been made.
 */

import { AbstractInputSuggest, type App } from "obsidian";
import { noteBasename, noteFolder, resolveNotePath, scoreNote } from "./notePath";

export type NoteChoice =
	| { kind: "existing"; path: string }
	| { kind: "create"; path: string };

export interface NoteSuggestOptions {
	/** Where a bare name (no slash) gets filed. */
	defaultFolder: string;
	/** Shown first when the box is empty. */
	inboxPath: string;
	onChoose: (path: string | undefined) => void;
}

export class NoteSuggest extends AbstractInputSuggest<NoteChoice> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private opts: NoteSuggestOptions,
	) {
		super(app, input);
		this.limit = 20;
	}

	protected getSuggestions(query: string): NoteChoice[] {
		const files = this.app.vault.getMarkdownFiles();
		const q = query.trim();

		if (!q) {
			// Empty box: lead with the inbox, then the rest of the calendar
			// folder — the notes a task is most likely headed for.
			const folder = this.opts.defaultFolder;
			const nearby = files
				.filter((f) => f.path !== this.opts.inboxPath && inFolder(f.path, folder))
				.map((f) => f.path)
				.sort();

			const out: NoteChoice[] = [];
			if (files.some((f) => f.path === this.opts.inboxPath)) {
				out.push({ kind: "existing", path: this.opts.inboxPath });
			}
			for (const path of nearby.slice(0, 15)) out.push({ kind: "existing", path });
			return out;
		}

		const matches = files
			.map((f) => ({ path: f.path, score: scoreNote(f.path, q) }))
			.filter((m) => m.score > 0)
			.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
			.slice(0, 15)
			.map((m): NoteChoice => ({ kind: "existing", path: m.path }));

		// Offer creation unless the typed path already exists.
		const target = resolveNotePath(q, this.opts.defaultFolder);
		if (target && !files.some((f) => f.path.toLowerCase() === target.toLowerCase())) {
			matches.push({ kind: "create", path: target });
		}

		return matches;
	}

	renderSuggestion(choice: NoteChoice, el: HTMLElement): void {
		el.addClass("ct-note-suggestion");

		if (choice.kind === "create") {
			el.createSpan({ cls: "ct-note-suggestion-new", text: "Create" });
			el.createSpan({ cls: "ct-note-suggestion-name", text: noteBasename(choice.path) });
			el.createSpan({ cls: "ct-note-suggestion-path", text: noteFolder(choice.path) || "vault root" });
			return;
		}

		el.createSpan({ cls: "ct-note-suggestion-name", text: noteBasename(choice.path) });
		const folder = noteFolder(choice.path);
		if (folder) el.createSpan({ cls: "ct-note-suggestion-path", text: folder });
		if (choice.path === this.opts.inboxPath) {
			el.createSpan({ cls: "ct-note-suggestion-tag", text: "inbox" });
		}
	}

	selectSuggestion(choice: NoteChoice): void {
		this.setValue(choice.path);
		this.input.value = choice.path;
		this.opts.onChoose(choice.path);
		this.close();
	}
}

/** True when `path` sits inside `folder` (or folder is empty). */
function inFolder(path: string, folder: string): boolean {
	if (!folder) return true;
	return path === folder || path.startsWith(`${folder}/`);
}

/** Attaches the suggester to an existing text input. */
export function attachNoteSuggest(
	app: App,
	input: HTMLInputElement,
	opts: NoteSuggestOptions,
): NoteSuggest {
	const suggest = new NoteSuggest(app, input, opts);

	// Typing a path by hand has to count too, not just picking from the list.
	input.addEventListener("blur", () => {
		const raw = input.value.trim();
		opts.onChoose(raw ? resolveNotePath(raw, opts.defaultFolder) : undefined);
	});

	return suggest;
}
