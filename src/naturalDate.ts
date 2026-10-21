/**
 * Natural language dates — "tomorrow", "next friday", "in 3 weeks".
 *
 * Deliberately self-contained rather than depending on the Natural
 * Language Dates plugin: a date field that only works when a second
 * plugin happens to be installed is worse than one that always works.
 * The vocabulary is small and predictable on purpose — anything it
 * doesn't recognise falls back to normal date parsing, so a typo can
 * never silently resolve to the wrong day.
 */

import { addDays, addMonths, addYears, endOfMonth, endOfWeek, toKey, type DateKey } from "./dates";

const WEEKDAYS: Record<string, number> = {
	sunday: 0, sun: 0,
	monday: 1, mon: 1,
	tuesday: 2, tue: 2, tues: 2,
	wednesday: 3, wed: 3,
	thursday: 4, thu: 4, thur: 4, thurs: 4,
	friday: 5, fri: 5,
	saturday: 6, sat: 6,
};

const UNIT_DAYS: Record<string, number> = {
	day: 1, days: 1,
	week: 7, weeks: 7,
	fortnight: 14, fortnights: 14,
};

/**
 * Resolves a phrase to a date key, or undefined when it isn't one.
 *
 * `from` is the reference day, injected rather than read from the clock
 * so this stays pure and testable.
 */
export function parseNaturalDate(input: string, from: Date): DateKey | undefined {
	const s = input.trim().toLowerCase().replace(/\s+/g, " ");
	if (!s) return undefined;

	if (s === "today" || s === "now") return toKey(from);
	if (s === "tomorrow" || s === "tmr" || s === "tom") return toKey(addDays(from, 1));
	if (s === "yesterday") return toKey(addDays(from, -1));
	if (s === "eom" || s === "end of month") return toKey(endOfMonth(from));
	if (s === "eow" || s === "end of week") return toKey(endOfWeek(from));

	// "next week" / "next month" / "next year", and their "last" mirrors.
	const shift = s.match(/^(next|last) (week|month|year|fortnight)$/);
	if (shift) {
		const sign = shift[1] === "next" ? 1 : -1;
		if (shift[2] === "week") return toKey(addDays(from, 7 * sign));
		if (shift[2] === "fortnight") return toKey(addDays(from, 14 * sign));
		if (shift[2] === "month") return toKey(addMonths(from, sign));
		return toKey(addYears(from, sign));
	}

	// "in 3 days", "in 2 weeks", "in 1 month"
	const ahead = s.match(/^in (\d+) (day|days|week|weeks|fortnight|fortnights|month|months|year|years)$/);
	if (ahead) return offset(from, parseInt(ahead[1], 10), ahead[2]);

	// "3 days ago", "2 weeks ago"
	const back = s.match(/^(\d+) (day|days|week|weeks|fortnight|fortnights|month|months|year|years) ago$/);
	if (back) return offset(from, -parseInt(back[1], 10), back[2]);

	// "next friday", "last monday", or a bare "friday".
	const named = s.match(/^(next |last |this )?([a-z]+)$/);
	if (named) {
		const day = WEEKDAYS[named[2]];
		if (day === undefined) return undefined;
		return weekday(from, day, (named[1] ?? "").trim());
	}

	return undefined;
}

function offset(from: Date, n: number, unit: string): DateKey {
	const days = UNIT_DAYS[unit];
	if (days) return toKey(addDays(from, n * days));
	if (unit.startsWith("month")) return toKey(addMonths(from, n));
	return toKey(addYears(from, n));
}

/**
 * The nearest matching weekday.
 *
 * A bare "friday" and "next friday" both mean the coming Friday — the
 * reading people expect from a task app. "this friday" is the same day
 * unless today *is* Friday, in which case it means today.
 */
function weekday(from: Date, target: number, qualifier: string): DateKey {
	const current = from.getDay();

	if (qualifier === "last") {
		const back = (current - target + 7) % 7 || 7;
		return toKey(addDays(from, -back));
	}

	if (qualifier === "this" && current === target) return toKey(from);

	const forward = (target - current + 7) % 7 || 7;
	return toKey(addDays(from, forward));
}

/** The phrases worth showing as hints under a date field. */
export const NATURAL_DATE_EXAMPLES = ["today", "tomorrow", "next friday", "in 3 days", "end of month"];
