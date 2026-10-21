/**
 * The icon control that sits beside a task's title.
 *
 * A button showing the current icon, opening a grid of common choices
 * plus a free-text box for anything not in it — so the palette can stay
 * short without being a ceiling.
 */

import { EMOJI_PALETTE, RESERVED_EMOJI, isUsableEmoji } from "./emoji";

export interface EmojiFieldOptions {
	value?: string;
	onChange: (emoji?: string) => void;
}

export class EmojiField {
	readonly el: HTMLElement;
	private button: HTMLButtonElement;
	private panel: HTMLElement;
	private value?: string;
	private open = false;

	constructor(container: HTMLElement, private opts: EmojiFieldOptions) {
		this.value = opts.value;

		this.el = container.createDiv({ cls: "ct-emoji-field" });

		this.button = this.el.createEl("button", {
			cls: "ct-emoji-btn",
			attr: { type: "button", "aria-label": "Choose an icon for this task" },
		});
		this.paint();
		this.button.addEventListener("click", () => this.toggle());

		this.panel = this.el.createDiv({ cls: "ct-emoji-panel ct-hidden" });
		this.buildPanel();

		// Clicking anywhere else closes the grid.
		this.el.addEventListener("focusout", (e) => {
			const next = e.relatedTarget as Node | null;
			if (next && this.el.contains(next)) return;
			this.setOpen(false);
		});
	}

	getValue(): string | undefined {
		return this.value;
	}

	private paint(): void {
		this.button.empty();
		if (this.value) {
			this.button.createSpan({ cls: "ct-emoji-current", text: this.value });
			this.button.removeClass("is-empty");
		} else {
			this.button.createSpan({ cls: "ct-emoji-current", text: "☺" });
			this.button.addClass("is-empty");
		}
	}

	private toggle(): void {
		this.setOpen(!this.open);
	}

	private setOpen(open: boolean): void {
		this.open = open;
		this.panel.toggleClass("ct-hidden", !open);
	}

	private choose(emoji?: string): void {
		this.value = emoji;
		this.paint();
		this.setOpen(false);
		this.opts.onChange(emoji);
	}

	private buildPanel(): void {
		const custom = this.panel.createDiv({ cls: "ct-emoji-custom" });
		const input = custom.createEl("input", {
			cls: "ct-emoji-input",
			attr: { type: "text", placeholder: "Paste any emoji…", maxlength: "16" },
		});

		const apply = () => {
			const raw = input.value.trim();
			if (!raw) return;
			if (!isUsableEmoji(raw)) {
				input.addClass("ct-invalid");
				// Reserved markers would be re-read as metadata, so they're refused.
				input.setAttribute(
					"title",
					RESERVED_EMOJI.has(raw)
						? "That emoji is used for task metadata, so it can't be an icon"
						: "Enter a single emoji",
				);
				return;
			}
			input.removeClass("ct-invalid");
			this.choose(raw);
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); apply(); }
		});
		input.addEventListener("input", () => input.removeClass("ct-invalid"));

		const clear = custom.createEl("button", {
			cls: "ct-mini-btn",
			text: "None",
			attr: { type: "button" },
		});
		clear.addEventListener("click", () => this.choose(undefined));

		for (const group of EMOJI_PALETTE) {
			if (!group.emoji.length) continue;
			this.panel.createDiv({ cls: "ct-emoji-group", text: group.group });
			const grid = this.panel.createDiv({ cls: "ct-emoji-grid" });
			for (const emoji of group.emoji) {
				const b = grid.createEl("button", {
					cls: `ct-emoji-option${emoji === this.value ? " is-active" : ""}`,
					text: emoji,
					attr: { type: "button", "aria-label": emoji },
				});
				b.addEventListener("click", () => this.choose(emoji));
			}
		}
	}
}
