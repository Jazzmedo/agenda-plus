import { addDays, addMonths, addYears, fromKey, toKey, type DateKey } from "./dates";
import type { Recurrence } from "./types";

const WEEKDAY_WORDS: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tues: 2, tuesday: 2,
	wed: 3, weds: 3, wednesday: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};

const UNIT_FREQ: Record<string, Recurrence["freq"]> = {
	day: "daily", days: "daily", daily: "daily",
	week: "weekly", weeks: "weekly", weekly: "weekly",
	month: "monthly", months: "monthly", monthly: "monthly",
	year: "yearly", years: "yearly", yearly: "yearly",
};

/**
 * Parses the human recurrence text that follows 🔁.
 *
 * Understood forms:
 *   every day / every 3 days / daily
 *   every week / every 2 weeks
 *   every Monday, Friday / every Mon and Wed
 *   every weekday / every weekend
 *   every month / every month on the 15th
 *   every year
 *   ...any of the above + " when done"
 */
export function parseRecurrence(text: string): Recurrence | undefined {
	const raw = text.trim();
	if (!raw) return undefined;

	let s = raw.toLowerCase();

	const whenDone = /\bwhen\s+done\b/.test(s);
	s = s.replace(/\bwhen\s+done\b/, " ").trim();

	s = s.replace(/^every\s*/, "").trim();

	let interval = 1;
	const intervalMatch = s.match(/^(\d+)\s+/);
	if (intervalMatch) {
		interval = Math.max(1, parseInt(intervalMatch[1], 10));
		s = s.slice(intervalMatch[0].length).trim();
	}

	if (/^weekdays?$/.test(s)) {
		return { raw, freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5], whenDone };
	}
	if (/^weekends?$/.test(s) || /^weekend\s*days?$/.test(s)) {
		return { raw, freq: "weekly", interval: 1, weekdays: [0, 6], whenDone };
	}

	const monthDayMatch = s.match(/^months?\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/);
	if (monthDayMatch) {
		return {
			raw, freq: "monthly", interval, weekdays: [],
			monthDay: Math.min(31, Math.max(1, parseInt(monthDayMatch[1], 10))),
			whenDone,
		};
	}

	const unit = UNIT_FREQ[s];
	if (unit) return { raw, freq: unit, interval, weekdays: [], whenDone };

	const weekOn = s.match(/^weeks?\s+(?:on\s+)?(.+)$/);
	const weekdays = parseWeekdayList(weekOn ? weekOn[1] : s);
	if (weekdays.length) {
		return { raw, freq: "weekly", interval, weekdays, whenDone };
	}

	// Unrecognised — fall back to daily so the task keeps repeating rather
	// than silently vanishing from the calendar.
	return { raw, freq: "daily", interval, weekdays: [], whenDone };
}

function parseWeekdayList(s: string): number[] {
	const parts = s.split(/[,/]|\s+and\s+|\s+/).map((p) => p.trim()).filter(Boolean);
	const days = new Set<number>();
	for (const p of parts) {
		const key = p.replace(/[^a-z]/g, "");
		if (key in WEEKDAY_WORDS) days.add(WEEKDAY_WORDS[key]);
	}
	return [...days].sort((a, b) => a - b);
}

/** Renders a Recurrence back to text. We keep `raw` so user wording survives. */
export function formatRecurrence(r: Recurrence): string {
	return r.raw;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number): string {
	if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
	return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Builds canonical rule text from structured state — the inverse of
 * parseRecurrence, used by the recurrence picker.
 *
 * The output must parse back to an equivalent rule; `logic.test.ts` asserts
 * that round trip for every shape the picker can produce.
 */
export function buildRecurrenceText(r: Omit<Recurrence, "raw">): string {
	const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
	const count = r.interval > 1 ? `${r.interval} ` : "";
	let out = `every ${count}${unit}${r.interval > 1 ? "s" : ""}`;

	if (r.freq === "weekly" && r.weekdays.length) {
		const days = [...r.weekdays].sort((a, b) => a - b).map((d) => SHORT_DAYS[d]);
		out += ` on ${days.join(", ")}`;
	}

	if (r.freq === "monthly" && r.monthDay) {
		out += ` on the ${ordinal(r.monthDay)}`;
	}

	if (r.whenDone) out += " when done";
	return out;
}

/** Short label for chips and badges, e.g. "every 2 weeks". */
export function describeRecurrence(r: Recurrence): string {
	const n = r.interval > 1 ? `${r.interval} ` : "";
	switch (r.freq) {
		case "daily":
			return `every ${n}${r.interval > 1 ? "days" : "day"}`;
		case "weekly":
			if (r.weekdays.length) {
				const names = r.weekdays.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]);
				return `every ${names.join(", ")}`;
			}
			return `every ${n}${r.interval > 1 ? "weeks" : "week"}`;
		case "monthly":
			return r.monthDay
				? `every ${n}month on the ${r.monthDay}`
				: `every ${n}${r.interval > 1 ? "months" : "month"}`;
		case "yearly":
			return `every ${n}${r.interval > 1 ? "years" : "year"}`;
	}
}

/**
 * The n-th occurrence of a series, counted from its anchor.
 *
 * Every occurrence is derived from the anchor rather than from the previous
 * occurrence. That matters for month-end dates: a monthly task anchored on
 * the 31st must yield Jan 31 → Feb 28 → Mar 31, not drift to the 28th of
 * every later month because February clamped it once.
 */
function nthOccurrence(r: Recurrence, anchor: Date, n: number): Date {
	switch (r.freq) {
		case "daily":
			return addDays(anchor, n * r.interval);

		case "weekly": {
			if (!r.weekdays.length) return addDays(anchor, n * 7 * r.interval);
			// Lay the selected weekdays out on the anchor's own week, then
			// step forward whole (interval) weeks for each completed cycle.
			const perCycle = r.weekdays.length;
			const cycle = Math.floor(n / perCycle);
			const slot = r.weekdays[n % perCycle];
			const weekStart = addDays(anchor, -anchor.getDay());
			return addDays(weekStart, cycle * 7 * r.interval + slot);
		}

		case "monthly": {
			const target = addMonths(anchor, n * r.interval);
			if (!r.monthDay) return target;
			const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
			return new Date(target.getFullYear(), target.getMonth(), Math.min(r.monthDay, lastDay));
		}

		case "yearly":
			return addYears(anchor, n * r.interval);
	}
}

/** Roughly how many steps separate `anchor` from `target`, so long series
 *  don't have to be walked from index 0. Deliberately undershoots. */
function approximateIndex(r: Recurrence, anchor: Date, target: Date): number {
	const days = Math.floor((target.getTime() - anchor.getTime()) / 86_400_000);
	if (days <= 0) return 0;

	switch (r.freq) {
		case "daily":
			return Math.floor(days / r.interval);
		case "weekly":
			return r.weekdays.length
				? Math.floor(days / 7 / r.interval) * r.weekdays.length
				: Math.floor(days / 7 / r.interval);
		case "monthly":
			return Math.floor(days / 31 / r.interval);
		case "yearly":
			return Math.floor(days / 366 / r.interval);
	}
}

/** The next occurrence strictly after `after`, following `anchor`'s phase. */
export function nextOccurrence(r: Recurrence, anchor: Date, after: Date): Date | undefined {
	const start = Math.max(0, approximateIndex(r, anchor, after) - 2);
	for (let n = start; n < start + 5000; n++) {
		const date = nthOccurrence(r, anchor, n);
		if (date.getTime() > after.getTime() && date.getTime() >= anchor.getTime()) return date;
	}
	return undefined;
}

/**
 * Every occurrence of `r` that falls inside [rangeStart, rangeEnd].
 *
 * `anchor` sets the phase of the series (its first date). `until` — set when
 * the task carries 🏁 or is linked to an event — stops the series.
 */
export function occurrencesBetween(
	r: Recurrence,
	anchor: DateKey,
	rangeStart: Date,
	rangeEnd: Date,
	until?: DateKey,
): DateKey[] {
	const out: DateKey[] = [];
	const anchorDate = fromKey(anchor);
	const stop = until ? fromKey(until) : undefined;
	const hardEnd = stop && stop.getTime() < rangeEnd.getTime() ? stop : rangeEnd;
	if (hardEnd.getTime() < anchorDate.getTime()) return out;

	const start = Math.max(0, approximateIndex(r, anchorDate, rangeStart) - 2);

	for (let n = start; n < start + 5000; n++) {
		const date = nthOccurrence(r, anchorDate, n);
		if (date.getTime() > hardEnd.getTime()) break;
		// Weekly rules can place early slots before the anchor's own weekday.
		if (date.getTime() < anchorDate.getTime()) continue;
		if (date.getTime() >= rangeStart.getTime()) out.push(toKey(date));
	}

	return out;
}
