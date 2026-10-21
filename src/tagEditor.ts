import { setIcon } from "obsidian";
import { normaliseTag } from "./tags";

export interface TagEditorOptions {
	selected?: string[];
	/** Every tag known to the index, most-used first. */
	available: { tag: string; count: number }[];
	colors: Record<string, string>;
	onChange?: (tags: string[]) => void;
}

const MAX_SUGGESTIONS = 8;

/**
 * Multi-select tag field: chosen tags sit as removable pills, and typing
 * filters the tags already in the vault. New tags can still be created by
 * typing one that doesn't exist and pressing Enter.
 */
export class TagEditor {
	private selected: string[];
	private root: HTMLElement;
	private pillsEl!: HTMLElement;
	private inputEl!: HTMLInputElement;
	private suggestEl!: HTMLElement;
	private highlighted = -1;
	private open = false;

	constructor(container: HTMLElement, private opts: TagEditorOptions) {
		this.selected = [...(opts.selected ?? [])];
		this.root = container.createDiv({ cls: "ct-field ct-tag-editor" });
		this.build();
	}

	value(): string[] {
		return [...this.selected];
	}

	private build(): void {
		this.pillsEl = this.root.createDiv({ cls: "ct-tag-pills" });

		const wrap = this.root.createDiv({ cls: "ct-tag-input-wrap" });
		this.inputEl = wrap.createEl("input", {
			cls: "ct-tag-input",
			attr: { type: "text", placeholder: "Type to search or create a tag…" },
		});
		this.suggestEl = wrap.createDiv({ cls: "ct-tag-suggest" });

		this.inputEl.addEventListener("input", () => this.refreshSuggestions());
		this.inputEl.addEventListener("focus", () => this.refreshSuggestions());

		// A click inside the dropdown fires after blur, so close on a delay.
		this.inputEl.addEventListener("blur", () => window.setTimeout(() => this.closeSuggestions(), 120));

		this.inputEl.addEventListener("keydown", (e) => this.onKeyDown(e));

		this.renderPills();
	}

	private onKeyDown(e: KeyboardEvent): void {
		const matches = this.matches();

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				this.highlighted = Math.min(this.highlighted + 1, matches.length - 1);
				this.renderSuggestions(matches);
				break;

			case "ArrowUp":
				e.preventDefault();
				this.highlighted = Math.max(this.highlighted - 1, -1);
				this.renderSuggestions(matches);
				break;

			case "Enter": {
				// Never let Enter reach the modal and submit a half-typed tag.
				e.preventDefault();
				e.stopPropagation();
				const picked = this.highlighted >= 0 ? matches[this.highlighted] : undefined;
				this.add(picked?.tag ?? this.inputEl.value);
				break;
			}

			case "Escape":
				if (this.open) {
					e.preventDefault();
					e.stopPropagation();
					this.closeSuggestions();
				}
				break;

			case "Backspace":
				// Empty input: chip off the last tag, like a mail "to" field.
				if (!this.inputEl.value && this.selected.length) {
					e.preventDefault();
					this.remove(this.selected[this.selected.length - 1]);
				}
				break;

			case ",":
			case " ":
				if (this.inputEl.value.trim()) {
					e.preventDefault();
					this.add(this.inputEl.value);
				}
				break;
		}
	}

	// ── Selection ─────────────────────────────────────────────────────────

	private add(raw: string): void {
		const tag = normaliseTag(raw);
		if (!tag || tag === "#") return;
		if (!this.selected.includes(tag)) this.selected.push(tag);

		this.inputEl.value = "";
		this.highlighted = -1;
		this.renderPills();
		this.refreshSuggestions();
		this.opts.onChange?.(this.value());
		this.inputEl.focus();
	}

	private remove(tag: string): void {
		this.selected = this.selected.filter((t) => t !== tag);
		this.renderPills();
		this.refreshSuggestions();
		this.opts.onChange?.(this.value());
	}

	private renderPills(): void {
		this.pillsEl.empty();

		if (!this.selected.length) {
			this.pillsEl.createSpan({ cls: "ct-field-note", text: "No tags yet." });
			return;
		}

		for (const tag of this.selected) {
			const pill = this.pillsEl.createSpan({ cls: "ct-tag-pill" });
			const colour = this.opts.colors[tag];
			if (colour) {
				pill.addClass("is-coloured");
				pill.style.setProperty("--ct-tag-color", colour);
			}

			pill.createSpan({ text: tag });

			const close = pill.createSpan({
				cls: "ct-tag-pill-remove",
				attr: { "aria-label": `Remove ${tag}` },
			});
			setIcon(close, "x");
			close.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.remove(tag);
			});
		}
	}

	// ── Suggestions ───────────────────────────────────────────────────────

	private matches(): { tag: string; count: number }[] {
		const query = this.inputEl.value.trim().toLowerCase().replace(/^#/, "");
		return this.opts.available
			.filter((t) => !this.selected.includes(t.tag))
			.filter((t) => !query || t.tag.toLowerCase().replace(/^#/, "").includes(query))
			.slice(0, MAX_SUGGESTIONS);
	}

	private refreshSuggestions(): void {
		this.highlighted = -1;
		this.renderSuggestions(this.matches());
	}

	private renderSuggestions(matches: { tag: string; count: number }[]): void {
		this.suggestEl.empty();

		const typed = normaliseTag(this.inputEl.value);
		const isNew = typed.length > 1 && !this.opts.available.some((t) => t.tag === typed) && !this.selected.includes(typed);

		if (!matches.length && !isNew) {
			this.closeSuggestions();
			return;
		}

		this.open = true;
		this.suggestEl.addClass("is-open");

		matches.forEach((match, i) => {
			const row = this.suggestEl.createDiv({
				cls: `ct-tag-option${i === this.highlighted ? " is-highlighted" : ""}`,
			});

			const colour = this.opts.colors[match.tag];
			const dot = row.createSpan({ cls: "ct-tagcolor-swatch is-inline" });
			if (colour) dot.style.background = colour;
			else dot.addClass("is-unset");

			row.createSpan({ cls: "ct-tag-option-name", text: match.tag });
			row.createSpan({ cls: "ct-tag-option-count", text: String(match.count) });

			// mousedown, not click — it fires before the input's blur.
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.add(match.tag);
			});
		});

		if (isNew) {
			const row = this.suggestEl.createDiv({ cls: "ct-tag-option is-new" });
			row.createSpan({ cls: "ct-tag-option-name", text: `Create ${typed}` });
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.add(typed);
			});
		}
	}

	private closeSuggestions(): void {
		this.open = false;
		this.suggestEl.empty();
		this.suggestEl.removeClass("is-open");
	}
}
