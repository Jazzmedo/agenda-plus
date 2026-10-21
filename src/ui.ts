/** Shared bits of chrome used by the field cards in the task modal. */

import { setIcon } from "obsidian";
import { formatDate, parseDateInput, today, type DateFormat, type DateKey } from "./dates";
import { NATURAL_DATE_EXAMPLES, parseNaturalDate } from "./naturalDate";

export interface DateFieldOptions {
	value?: DateKey;
	format: DateFormat;
	placeholder?: string;
	onChange: (value?: DateKey) => void;
}

/**
 * A date input that respects the configured format.
 *
 * The native `<input type="date">` always renders in the operating
 * system's locale and offers no way to override that, so a user who
 * picks DD/MM/YYYY would still be shown MM/DD/YYYY. This pairs a text
 * box we control with the native picker, kept hidden and opened by the
 * calendar button — so typing follows the setting while the platform's
 * own calendar UI stays available.
 */
export class DateField {
	readonly el: HTMLElement;
	private text: HTMLInputElement;
	private native: HTMLInputElement;
	private value?: DateKey;

	constructor(container: HTMLElement, private opts: DateFieldOptions) {
		this.value = opts.value;

		this.el = container.createDiv({ cls: "ct-datefield" });

		this.text = this.el.createEl("input", {
			cls: "ct-datefield-text",
			attr: {
				type: "text",
				placeholder: opts.placeholder ?? opts.format.toLowerCase(),
				"aria-label": `Date, ${opts.format}, or a phrase like "next friday"`,
				title: `${opts.format} — or type ${NATURAL_DATE_EXAMPLES.join(", ")}`,
			},
		});
		this.text.value = this.display();

		this.native = this.el.createEl("input", {
			cls: "ct-datefield-native",
			attr: { type: "date", tabindex: "-1", "aria-hidden": "true" },
		});
		this.native.value = this.value ?? "";

		const button = this.el.createEl("button", {
			cls: "ct-datefield-btn",
			attr: { type: "button", "aria-label": "Open the date picker" },
		});
		setIcon(button, "calendar");

		button.addEventListener("click", () => this.openPicker());
		this.native.addEventListener("change", () => this.commit(this.native.value || undefined));

		// Committing on blur rather than on every keystroke lets a partly
		// typed date exist without the field fighting the cursor.
		this.text.addEventListener("blur", () => this.readText());
		this.text.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); this.readText(); }
		});
	}

	/** The input the caller should flag when validation fails. */
	get inputEl(): HTMLInputElement {
		return this.text;
	}

	getValue(): DateKey | undefined {
		this.readText();
		return this.value;
	}

	setValue(value?: DateKey): void {
		this.value = value;
		this.text.value = this.display();
		this.native.value = value ?? "";
	}

	private display(): string {
		return this.value ? formatDate(this.value, this.opts.format) : "";
	}

	private readText(): void {
		const raw = this.text.value.trim();
		if (!raw) return this.commit(undefined);

		// Digits first, so "01/02" can never be hijacked by a phrase.
		const parsed = parseDateInput(raw, this.opts.format) ?? parseNaturalDate(raw, today());

		// Unparseable text snaps back rather than silently clearing the date.
		if (!parsed) {
			this.text.value = this.display();
			return;
		}
		this.commit(parsed);
	}

	private commit(value?: DateKey): void {
		if (value === this.value) {
			this.text.value = this.display();
			return;
		}
		this.setValue(value);
		this.opts.onChange(value);
	}

	private openPicker(): void {
		this.native.value = this.value ?? "";
		// showPicker is the only reliable way to surface the native calendar
		// from a hidden input; older webviews fall back to the text box.
		const withPicker = this.native as HTMLInputElement & { showPicker?: () => void };
		if (typeof withPicker.showPicker === "function") {
			try {
				withPicker.showPicker();
				return;
			} catch {
				// Blocked outside a user gesture on some platforms.
			}
		}
		this.text.focus();
	}
}

/** Appends the red asterisk that marks a field as required. */
export function requiredMark(target: HTMLElement): void {
	target.createSpan({
		cls: "ct-required",
		text: "*",
		attr: { "aria-label": "required", title: "Required" },
	});
}

/**
 * A bold label plus description sitting above a field card, matching the
 * typography Obsidian's own `Setting` rows use — so cards and plain
 * settings read as one list rather than two competing styles.
 */
export function fieldHeader(
	container: HTMLElement,
	title: string,
	description?: string,
	required = false,
): void {
	const header = container.createDiv({ cls: "ct-field-header" });
	const name = header.createDiv({ cls: "ct-field-header-name", text: title });
	if (required) requiredMark(name);
	if (description) {
		header.createDiv({ cls: "ct-field-header-desc", text: description });
	}
}

/** Flags a control as failing validation, and puts the cursor in it. */
export function flagInvalid(input: HTMLElement): void {
	input.addClass("ct-invalid");
	input.focus();
	// Clear on the next edit so the warning doesn't linger once fixed.
	const clear = () => {
		input.removeClass("ct-invalid");
		input.removeEventListener("input", clear);
		input.removeEventListener("change", clear);
	};
	input.addEventListener("input", clear);
	input.addEventListener("change", clear);
}
