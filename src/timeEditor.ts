import { setIcon } from "obsidian";
import { durationBetween, endTimeOf, formatDuration, parseTime } from "./parser";

export interface TimeValue {
	startTime?: string;
	duration?: number;
}

export interface TimeEditorOptions extends TimeValue {
	onChange?: () => void;
}

/** How the user is expressing the task's length. */
type LengthMode = "none" | "duration" | "end";

const PRESETS = [15, 30, 45, 60, 90, 120];

/**
 * Start time plus an optional length, where the length can be given either
 * as a duration or as an end time — whichever the user prefers.
 *
 * Only `startTime` and `duration` are ever stored. An end time is converted
 * to a duration on entry, so moving the start time later shifts the end
 * with it rather than silently changing how long the task takes.
 */
export class TimeEditor {
	private startTime?: string;
	private duration?: number;
	private mode: LengthMode;
	private root: HTMLElement;

	constructor(container: HTMLElement, private opts: TimeEditorOptions = {}) {
		this.startTime = opts.startTime;
		this.duration = opts.duration;
		this.mode = opts.duration ? "duration" : "none";

		this.root = container.createDiv({ cls: "ct-field ct-time" });
		this.render();
	}

	value(): TimeValue {
		return {
			startTime: this.startTime,
			duration: this.mode === "none" ? undefined : this.duration,
		};
	}

	private changed(): void {
		this.render();
		this.opts.onChange?.();
	}

	private render(): void {
		this.root.empty();
		this.renderStart();
		this.renderLengthMode();
		if (this.mode === "duration") this.renderDuration();
		if (this.mode === "end") this.renderEnd();
		this.renderPreview();
	}

	// ── Start time ────────────────────────────────────────────────────────

	private renderStart(): void {
		const row = this.row("Start");

		const input = row.createEl("input", { cls: "ct-field-time", attr: { type: "time" } });
		input.value = this.startTime ?? "";
		input.addEventListener("change", () => {
			this.startTime = parseTime(input.value) ?? undefined;
			// An end time is meaningless without a start; fall back to duration.
			if (!this.startTime && this.mode === "end") this.mode = this.duration ? "duration" : "none";
			this.changed();
		});

		if (this.startTime) {
			const clear = row.createEl("button", {
				cls: "ct-icon-btn",
				attr: { type: "button", "aria-label": "Clear start time" },
			});
			setIcon(clear, "x");
			clear.addEventListener("click", () => {
				this.startTime = undefined;
				if (this.mode === "end") this.mode = this.duration ? "duration" : "none";
				this.changed();
			});
		} else {
			row.createSpan({ cls: "ct-field-note", text: "all-day task" });
		}
	}

	// ── Duration vs end time ──────────────────────────────────────────────

	private renderLengthMode(): void {
		const row = this.row("Length");
		const seg = row.createDiv({ cls: "ct-segment" });

		const modes: { value: LengthMode; label: string }[] = [
			{ value: "none", label: "None" },
			{ value: "duration", label: "Duration" },
			{ value: "end", label: "End time" },
		];

		for (const m of modes) {
			const disabled = m.value === "end" && !this.startTime;
			const btn = seg.createEl("button", {
				cls: `ct-segment-btn${this.mode === m.value ? " is-active" : ""}${disabled ? " is-disabled" : ""}`,
				text: m.label,
				attr: { type: "button" },
			});

			if (disabled) {
				btn.setAttribute("aria-disabled", "true");
				btn.setAttribute("title", "Set a start time first");
				continue;
			}

			btn.addEventListener("click", () => {
				this.mode = m.value;
				if (m.value !== "none" && !this.duration) this.duration = 30;
				this.changed();
			});
		}
	}

	private renderDuration(): void {
		const row = this.row("");
		const wrap = row.createDiv({ cls: "ct-field-stepper" });

		const step = (delta: number, label: string) => {
			const b = wrap.createEl("button", { cls: "ct-step-btn", text: label, attr: { type: "button" } });
			b.addEventListener("click", () => {
				this.duration = Math.min(1439, Math.max(5, (this.duration ?? 30) + delta));
				this.changed();
			});
		};

		step(-5, "−");

		const input = wrap.createEl("input", {
			cls: "ct-field-number",
			attr: { type: "number", min: "5", max: "1439", step: "5" },
		});
		input.value = String(this.duration ?? 30);
		input.addEventListener("change", () => {
			this.duration = Math.min(1439, Math.max(5, parseInt(input.value, 10) || 30));
			this.changed();
		});

		step(5, "+");
		wrap.createSpan({ cls: "ct-field-unit", text: "min" });

		const presets = row.createDiv({ cls: "ct-field-presets" });
		for (const mins of PRESETS) {
			const b = presets.createEl("button", {
				cls: `ct-mini-btn${this.duration === mins ? " is-active" : ""}`,
				text: formatDuration(mins),
				attr: { type: "button" },
			});
			b.addEventListener("click", () => {
				this.duration = mins;
				this.changed();
			});
		}
	}

	private renderEnd(): void {
		const row = this.row("");
		const input = row.createEl("input", { cls: "ct-field-time", attr: { type: "time" } });
		input.value = this.startTime && this.duration ? endTimeOf(this.startTime, this.duration) : "";

		input.addEventListener("change", () => {
			if (!this.startTime) return;
			const mins = durationBetween(this.startTime, input.value);
			if (mins === undefined) {
				// Keep the previous value rather than storing a zero-length task.
				this.changed();
				return;
			}
			this.duration = mins;
			this.changed();
		});

		row.createSpan({ cls: "ct-field-note", text: "stored as a duration" });
	}

	// ── Preview ───────────────────────────────────────────────────────────

	private renderPreview(): void {
		if (!this.startTime && this.mode === "none") return;

		const box = this.root.createDiv({ cls: "ct-field-preview" });
		const duration = this.mode === "none" ? undefined : this.duration;

		if (this.startTime && duration) {
			box.createDiv({
				cls: "ct-field-summary",
				text: `${this.startTime} – ${endTimeOf(this.startTime, duration)}`,
			});
			box.createDiv({ cls: "ct-field-note", text: `${formatDuration(duration)} long` });
			return;
		}

		if (this.startTime) {
			box.createDiv({ cls: "ct-field-summary", text: `Starts ${this.startTime}` });
			box.createDiv({ cls: "ct-field-note", text: "no length set" });
			return;
		}

		box.createDiv({ cls: "ct-field-summary", text: formatDuration(duration!) });
		box.createDiv({ cls: "ct-field-note", text: "estimate, no fixed start time" });
	}

	private row(label: string): HTMLElement {
		const row = this.root.createDiv({ cls: "ct-field-row" });
		row.createDiv({ cls: "ct-field-label", text: label });
		return row.createDiv({ cls: "ct-field-control" });
	}
}
