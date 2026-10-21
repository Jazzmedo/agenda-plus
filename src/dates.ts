/**
 * Date helpers. Everything in this plugin identifies a day by its local
 * "YYYY-MM-DD" key, never by a UTC timestamp — that keeps day boundaries
 * aligned with the user's wall clock regardless of timezone.
 */

export type DateKey = string; // "YYYY-MM-DD"

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function toKey(d: Date): DateKey {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" into a Date at local midnight. */
export function fromKey(key: DateKey): Date {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, m - 1, d);
}

export function isDateKey(s: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function today(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayKey(): DateKey {
	return toKey(today());
}

export function addDays(d: Date, n: number): Date {
	const out = new Date(d.getTime());
	out.setDate(out.getDate() + n);
	return out;
}

/** Month arithmetic that clamps to the last valid day (Jan 31 + 1mo = Feb 28). */
export function addMonths(d: Date, n: number): Date {
	const day = d.getDate();
	const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
	const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
	out.setDate(Math.min(day, lastDay));
	return out;
}

export function addYears(d: Date, n: number): Date {
	return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
}

export function startOfWeek(d: Date, firstDayOfWeek = 0): Date {
	const diff = (d.getDay() - firstDayOfWeek + 7) % 7;
	return addDays(d, -diff);
}

export function endOfWeek(d: Date, firstDayOfWeek = 0): Date {
	return addDays(startOfWeek(d, firstDayOfWeek), 6);
}

export function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Whole days from `a` to `b`; negative when `b` is in the past. */
export function daysBetween(a: Date, b: Date): number {
	const ms = fromKey(toKey(b)).getTime() - fromKey(toKey(a)).getTime();
	return Math.round(ms / 86_400_000);
}

export function isSameDay(a: Date, b: Date): boolean {
	return toKey(a) === toKey(b);
}

export function eachDay(start: Date, end: Date): Date[] {
	const out: Date[] = [];
	for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) out.push(d);
	return out;
}

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/**
 * Which days count as the weekend varies by region, so it's configured
 * rather than assumed — and it's independent of which day the week starts
 * on. Egypt and the Gulf rest Friday–Saturday, Europe and the Americas
 * Saturday–Sunday, and several countries take Friday alone.
 */
export const WEEKEND_PRESETS: { label: string; days: number[] }[] = [
	{ label: "Sat & Sun", days: [6, 0] },
	{ label: "Fri & Sat", days: [5, 6] },
	{ label: "Fri only", days: [5] },
	{ label: "Thu & Fri", days: [4, 5] },
	{ label: "None", days: [] },
];

export function isWeekend(d: Date, weekendDays: number[]): boolean {
	return weekendDays.includes(d.getDay());
}

export function weekdayName(i: number, short = false): string {
	return short ? WEEKDAY_SHORT[i] : WEEKDAY_LONG[i];
}

export function monthName(i: number): string {
	return MONTH_LONG[i];
}

export function formatMonthYear(d: Date): string {
	return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * How dates are shown to the user. Storage is always the ISO key — this
 * only ever affects what's rendered and what typed input is read as.
 */
export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
	{ value: "YYYY-MM-DD", label: "2026-07-21 (ISO)" },
	{ value: "DD/MM/YYYY", label: "21/07/2026 (day first)" },
	{ value: "MM/DD/YYYY", label: "07/21/2026 (month first)" },
];

/** True when the format leads with the day — drives "21 Jul" vs "Jul 21". */
export function isDayFirst(fmt: DateFormat): boolean {
	return fmt === "DD/MM/YYYY";
}

/** Renders a date key in the user's chosen format. */
export function formatDate(key: DateKey, fmt: DateFormat): string {
	if (!isDateKey(key)) return key;
	const [y, m, d] = key.split("-");
	if (fmt === "DD/MM/YYYY") return `${d}/${m}/${y}`;
	if (fmt === "MM/DD/YYYY") return `${m}/${d}/${y}`;
	return key;
}

/**
 * Reads typed text back into a date key. Deliberately forgiving: any of
 * `/ - .` separate the parts, one-digit day and month are fine, and a
 * plain ISO string is always accepted whatever the display format — so
 * pasting a date out of a note never fails.
 */
export function parseDateInput(text: string, fmt: DateFormat): DateKey | null {
	const s = text.trim();
	if (!s) return null;

	const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
	if (iso) return build(+iso[1], +iso[2], +iso[3]);

	const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
	if (!parts) return null;

	const [a, b] = [+parts[1], +parts[2]];
	let year = +parts[3];
	if (parts[3].length <= 2) year += year < 70 ? 2000 : 1900;

	// A value above 12 can only be the day, so an unambiguous input is read
	// correctly even when it contradicts the configured order.
	let day: number, month: number;
	if (a > 12) [day, month] = [a, b];
	else if (b > 12) [day, month] = [b, a];
	else if (fmt === "MM/DD/YYYY") [day, month] = [b, a];
	else [day, month] = [a, b];

	return build(year, month, day);
}

function build(y: number, m: number, d: number): DateKey | null {
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	const date = new Date(y, m - 1, d);
	// Rejects overflow like 31 February, which Date would roll into March.
	if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
	return toKey(date);
}

/** "Mon, 21 Jul" — compact and unambiguous, ordered to match the format. */
export function formatShort(d: Date, fmt: DateFormat = "YYYY-MM-DD"): string {
	const day = d.getDate();
	const month = MONTH_LONG[d.getMonth()].slice(0, 3);
	const rest = isDayFirst(fmt) ? `${day} ${month}` : `${month} ${day}`;
	return `${WEEKDAY_SHORT[d.getDay()]}, ${rest}`;
}

/** Human relative day label used on chips and in the today list. */
export function relativeLabel(key: DateKey): string {
	const diff = daysBetween(today(), fromKey(key));
	if (diff === 0) return "today";
	if (diff === 1) return "tomorrow";
	if (diff === -1) return "yesterday";
	if (diff < 0) return `${-diff} days ago`;
	if (diff < 7) return `in ${diff} days`;
	if (diff < 30) return `in ${Math.round(diff / 7)} weeks`;
	return `in ${Math.round(diff / 30)} months`;
}

/** ISO-8601 week number, used as the week-view heading. */
export function isoWeekNumber(d: Date): number {
	const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	// Thursday of the current ISO week determines the year the week belongs to.
	target.setDate(target.getDate() - ((target.getDay() + 6) % 7) + 3);
	const firstThursday = new Date(target.getFullYear(), 0, 4);
	firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
	return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
