import {
	addDays, formatDate, fromKey, isDayFirst, monthName, todayKey, weekdayName,
	type DateFormat, type DateKey,
} from "./dates";
import { buildRecurrenceText, describeRecurrence, occurrencesBetween, parseRecurrence } from "./recurrence";
import { DateField } from "./ui";
import type { EventItem, RecurFreq, Recurrence } from "./types";

export interface RecurrenceValue {
	recurrence?: Recurrence;
	until?: DateKey;
	target?: string;
	untilDone?: boolean;
}

export interface RecurrenceEditorOptions {
	initial?: Recurrence;
	until?: DateKey;
	target?: string;
	untilDone?: boolean;
	/** The task's own date — seeds the default weekday / day-of-month. */
	anchor?: DateKey;
	firstDayOfWeek: number;
	/** Drives the "Weekend" quick-pick, so it matches the user's region. */
	weekendDays: number[];
	dateFormat: DateFormat;
	events: EventItem[];
	onChange?: () => void;
}

const FREQS: { value: RecurFreq | "never"; label: string }[] = [
	{ value: "never", label: "Never" },
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "yearly", label: "Yearly" },
];

const UNIT_NOUN: Record<RecurFreq, [string, string]> = {
	daily: ["day", "days"],
	weekly: ["week", "weeks"],
	monthly: ["month", "months"],
	yearly: ["year", "years"],
};

type EndMode = "never" | "date" | "event";

/**
 * A structured repeat picker: frequency, interval, weekday toggles,
 * day-of-month, and an end condition — with a live preview of the next
 * few dates so the rule is never a guess.
 */
export class RecurrenceEditor {
	private enabled: boolean;
	private freq: RecurFreq = "weekly";
	private interval = 1;
	private weekdays = new Set<number>();
	private monthDay: number;
	private whenDone = false;
	private untilDone = false;
	private endMode: EndMode = "never";
	private until?: DateKey;
	private target?: string;
	private root: HTMLElement;

	constructor(container: HTMLElement, private opts: RecurrenceEditorOptions) {
		const anchorDate = fromKey(opts.anchor ?? todayKey());

		this.enabled = !!opts.initial;
		this.monthDay = anchorDate.getDate();
		this.until = opts.until;
		this.target = opts.target;
		this.untilDone = !!opts.untilDone;
		this.endMode = opts.target ? "event" : opts.until ? "date" : "never";

		if (opts.initial) {
			this.freq = opts.initial.freq;
			this.interval = opts.initial.interval;
			this.whenDone = opts.initial.whenDone;
			this.weekdays = new Set(opts.initial.weekdays);
			if (opts.initial.monthDay) this.monthDay = opts.initial.monthDay;
		} else {
			// Sensible default: weekly on the task's own weekday.
			this.weekdays.add(anchorDate.getDay());
		}

		this.root = container.createDiv({ cls: "ct-field ct-recur" });
		this.render();
	}

	/** Re-seeds defaults when the task's date changes underneath the editor. */
	setAnchor(anchor: DateKey): void {
		this.opts.anchor = anchor;
		this.render();
	}

	value(): RecurrenceValue {
		if (!this.enabled) return {};

		const text = buildRecurrenceText({
			freq: this.freq,
			interval: this.interval,
			weekdays: [...this.weekdays].sort((a, b) => a - b),
			monthDay: this.freq === "monthly" ? this.monthDay : undefined,
			whenDone: this.whenDone,
		});

		return {
			recurrence: parseRecurrence(text),
			until: this.endMode === "date" ? this.until : undefined,
			target: this.endMode === "event" ? this.target : undefined,
			untilDone: this.untilDone,
		};
	}

	private changed(): void {
		this.render();
		this.opts.onChange?.();
	}

	private render(): void {
		this.root.empty();

		this.renderFrequency();
		if (this.enabled) {
			this.renderInterval();
			if (this.freq === "weekly") this.renderWeekdays();
			if (this.freq === "monthly") this.renderMonthDay();
			this.renderMode();
			this.renderEnd();
			this.renderOptions();
			this.renderPreview();
		}
	}

	// ── Frequency ─────────────────────────────────────────────────────────

	private renderFrequency(): void {
		const row = this.row("Frequency");
		const seg = row.createDiv({ cls: "ct-segment" });

		for (const f of FREQS) {
			const active = f.value === "never" ? !this.enabled : this.enabled && this.freq === f.value;
			const btn = seg.createEl("button", {
				cls: `ct-segment-btn${active ? " is-active" : ""}`,
				text: f.label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => {
				if (f.value === "never") {
					this.enabled = false;
				} else {
					this.enabled = true;
					this.freq = f.value;
					// Weekly with nothing ticked can't generate anything.
					if (f.value === "weekly" && !this.weekdays.size) {
						this.weekdays.add(fromKey(this.opts.anchor ?? todayKey()).getDay());
					}
				}
				this.changed();
			});
		}
	}

	// ── Interval ──────────────────────────────────────────────────────────

	private renderInterval(): void {
		const row = this.row("Every");
		const wrap = row.createDiv({ cls: "ct-field-stepper" });

		const stepper = (delta: number, icon: string) => {
			const b = wrap.createEl("button", { cls: "ct-step-btn", text: icon, attr: { type: "button" } });
			b.addEventListener("click", () => {
				this.interval = Math.min(99, Math.max(1, this.interval + delta));
				this.changed();
			});
		};

		stepper(-1, "−");

		const input = wrap.createEl("input", {
			cls: "ct-field-number",
			attr: { type: "number", min: "1", max: "99" },
		});
		input.value = String(this.interval);
		input.addEventListener("change", () => {
			this.interval = Math.min(99, Math.max(1, parseInt(input.value, 10) || 1));
			this.changed();
		});

		stepper(1, "+");

		const [one, many] = UNIT_NOUN[this.freq];
		wrap.createSpan({ cls: "ct-field-unit", text: this.interval > 1 ? many : one });
	}

	// ── Weekly ────────────────────────────────────────────────────────────

	private renderWeekdays(): void {
		const row = this.row("On");
		const wrap = row.createDiv({ cls: "ct-recur-days" });

		for (let i = 0; i < 7; i++) {
			const day = (this.opts.firstDayOfWeek + i) % 7;
			const active = this.weekdays.has(day);
			const btn = wrap.createEl("button", {
				cls: `ct-day-toggle${active ? " is-active" : ""}`,
				text: weekdayName(day, true).slice(0, 2),
				attr: { type: "button", "aria-label": weekdayName(day) },
			});
			btn.addEventListener("click", () => {
				if (this.weekdays.has(day)) {
					// Never let the set empty out — that rule can't fire.
					if (this.weekdays.size > 1) this.weekdays.delete(day);
				} else {
					this.weekdays.add(day);
				}
				this.changed();
			});
		}

		const presets = row.createDiv({ cls: "ct-field-presets" });
		const preset = (label: string, days: number[]) => {
			const b = presets.createEl("button", { cls: "ct-mini-btn", text: label, attr: { type: "button" } });
			b.addEventListener("click", () => {
				this.weekdays = new Set(days);
				this.changed();
			});
		};
		// Both follow the configured weekend, so "Weekdays" means working
		// days wherever the user is rather than Monday–Friday everywhere.
		const weekend = this.opts.weekendDays;
		const working = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d));

		if (working.length) preset("Weekdays", working);
		if (weekend.length) preset("Weekend", weekend);
		preset("All", [0, 1, 2, 3, 4, 5, 6]);
	}

	// ── Monthly ───────────────────────────────────────────────────────────

	private renderMonthDay(): void {
		const row = this.row("On day");
		const wrap = row.createDiv({ cls: "ct-field-stepper" });

		const input = wrap.createEl("input", {
			cls: "ct-field-number",
			attr: { type: "number", min: "1", max: "31" },
		});
		input.value = String(this.monthDay);
		input.addEventListener("change", () => {
			this.monthDay = Math.min(31, Math.max(1, parseInt(input.value, 10) || 1));
			this.changed();
		});

		if (this.monthDay > 28) {
			wrap.createSpan({
				cls: "ct-field-note",
				text: "shorter months use their last day",
			});
		}
	}

	// ── End condition ─────────────────────────────────────────────────────

	private renderEnd(): void {
		const row = this.row("Ends");
		const seg = row.createDiv({ cls: "ct-segment" });

		const modes: { value: EndMode; label: string }[] = [
			{ value: "never", label: "Never" },
			{ value: "date", label: "On date" },
			{ value: "event", label: "At event" },
		];

		for (const m of modes) {
			const btn = seg.createEl("button", {
				cls: `ct-segment-btn${this.endMode === m.value ? " is-active" : ""}`,
				text: m.label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => {
				this.endMode = m.value;
				if (m.value === "event" && !this.target && this.opts.events.length) {
					this.target = this.opts.events[0].title;
				}
				if (m.value === "date" && !this.until) {
					this.until = todayKey();
				}
				this.changed();
			});
		}

		if (this.endMode === "date") {
			const detail = this.row("");
			new DateField(detail, {
				value: this.until,
				format: this.opts.dateFormat,
				onChange: (v) => {
					this.until = v;
					this.changed();
				},
			});
		}

		if (this.endMode === "event") {
			const detail = this.row("");
			if (!this.opts.events.length) {
				detail.createSpan({
					cls: "ct-field-note",
					text: "No events yet — create one from the calendar's + menu.",
				});
				return;
			}

			const select = detail.createEl("select", { cls: "ct-field-select" });
			for (const e of this.opts.events) {
				select.createEl("option", {
					value: e.title,
					text: `${e.title} — ${formatDate(e.start, this.opts.dateFormat)}`,
				});
			}
			select.value = this.target ?? this.opts.events[0].title;
			select.addEventListener("change", () => {
				this.target = select.value;
				this.changed();
			});

			detail.createSpan({
				cls: "ct-field-note",
				text: "repeats stop on the event date, and tasks show a countdown",
			});
		}
	}

	/**
	 * The difference between a habit and a deadline.
	 *
	 * "English, every day" is a fresh task each morning — finishing today
	 * must leave tomorrow's alone. "Write the report, every day until
	 * Friday" is one job being reminded about; finishing it on Tuesday
	 * should clear Wednesday and Thursday too.
	 */
	private renderMode(): void {
		const row = this.row("Each one");
		const seg = row.createDiv({ cls: "ct-segment" });

		const modes: { value: boolean; label: string }[] = [
			{ value: false, label: "A separate task" },
			{ value: true, label: "The same job" },
		];

		for (const m of modes) {
			const btn = seg.createEl("button", {
				cls: `ct-segment-btn${this.untilDone === m.value ? " is-active" : ""}`,
				text: m.label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => {
				this.untilDone = m.value;
				this.changed();
			});
		}

		row.createDiv({
			cls: "ct-field-note",
			text: this.untilDone
				? "finishing it on any day clears the remaining repeats"
				: "finishing today leaves the following days to do",
		});
	}

	private renderOptions(): void {
		if (this.untilDone) return;
		const row = this.row("");
		const label = row.createEl("label", { cls: "ct-field-checkbox" });
		const box = label.createEl("input", { attr: { type: "checkbox" } });
		box.checked = this.whenDone;
		box.addEventListener("change", () => {
			this.whenDone = box.checked;
			this.changed();
		});
		label.createSpan({ text: "Count the next repeat from when I complete it" });
	}

	// ── Preview ───────────────────────────────────────────────────────────

	private renderPreview(): void {
		const { recurrence, until, target } = this.value();
		if (!recurrence) return;

		const box = this.root.createDiv({ cls: "ct-field-preview" });
		box.createDiv({ cls: "ct-field-summary", text: describeRecurrence(recurrence) });

		const anchor = this.opts.anchor ?? todayKey();
		const endDate =
			until ?? (target ? this.opts.events.find((e) => e.title === target)?.start : undefined);

		const dates = occurrencesBetween(
			recurrence,
			anchor,
			fromKey(anchor),
			addDays(fromKey(anchor), 400),
			endDate,
		);

		if (!dates.length) {
			box.createDiv({ cls: "ct-field-note", text: "This rule produces no dates — check the end condition." });
			return;
		}

		const shown = dates.slice(0, 5).map((d) => {
			const date = fromKey(d);
			const month = monthName(date.getMonth()).slice(0, 3);
			return isDayFirst(this.opts.dateFormat)
				? `${date.getDate()} ${month}`
				: `${month} ${date.getDate()}`;
		});

		const line = box.createDiv({ cls: "ct-recur-dates" });
		line.createSpan({ cls: "ct-recur-dates-label", text: "Next:" });
		line.createSpan({ text: shown.join(" · ") + (dates.length > 5 ? " …" : "") });

		if (endDate) {
			box.createDiv({
				cls: "ct-field-note",
				text: `${dates.length} occurrence${dates.length === 1 ? "" : "s"}, ending ${formatDate(endDate, this.opts.dateFormat)}`,
			});
		}
	}

	// ── layout helper ─────────────────────────────────────────────────────

	private row(label: string): HTMLElement {
		const row = this.root.createDiv({ cls: "ct-field-row" });
		row.createDiv({ cls: "ct-field-label", text: label });
		return row.createDiv({ cls: "ct-field-control" });
	}
}
