import { isDateKey, type DateKey } from "./dates";
import { formatRecurrence, parseRecurrence } from "./recurrence";
import { LEGACY_UNTIL, PRIORITIES, PRIORITY_EMOJI, SYM, type Priority, type TaskItem } from "./types";

/** `- [ ] text`, `* [x] text`, `1. [/] text`, with any indentation. */
const TASK_LINE = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;

const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;
const TAG = /#[^\s#.,;:!?'"`()[\]{}]+/g;

const EMOJI_TO_PRIORITY = new Map<string, Priority>(
	PRIORITIES.filter((p) => p !== "none").map((p) => [PRIORITY_EMOJI[p], p]),
);

/** Every marker we recognise — used to find where a field's value ends. */
const ALL_MARKERS = [
	...Object.values(SYM),
	// Recognised so its value is never mistaken for description text.
	LEGACY_UNTIL,
	...PRIORITIES.filter((p) => p !== "none").map((p) => PRIORITY_EMOJI[p]),
];

export function isTaskLine(line: string): boolean {
	return TASK_LINE.test(line);
}

export function parseTaskLine(line: string, path: string, lineNo: number): TaskItem | undefined {
	const m = line.match(TASK_LINE);
	if (!m) return undefined;

	const [, indent, bullet, status, rest] = m;
	let body = rest;

	let blockId: string | undefined;
	const blockMatch = body.match(BLOCK_ID);
	if (blockMatch) {
		blockId = blockMatch[1];
		body = body.slice(0, blockMatch.index);
	}

	const fields = extractFields(body);
	const title = fields.remainder.replace(/\s+/g, " ").trim();

	const tags = [...title.matchAll(TAG)].map((t) => t[0]);

	const doneStatus = status.toLowerCase() === "x";
	const cancelled = status === "-";

	return {
		id: `${path}:${lineNo}`,
		path,
		line: lineNo,
		indent,
		bullet,
		status,
		done: doneStatus,
		cancelled,
		title,
		rawDescription: body.trim(),
		tags,
		priority: fields.priority,
		due: fields.due,
		scheduled: fields.scheduled,
		start: fields.start,
		doneDate: fields.done,
		createdDate: fields.created,
		until: fields.until,
		recurrence: fields.recurText ? parseRecurrence(fields.recurText) : undefined,
		target: fields.target,
		startTime: fields.startTime,
		duration: fields.duration,
		untilDone: fields.untilDone,
		blockId,
	};
}

interface ExtractedFields {
	remainder: string;
	priority: Priority;
	due?: DateKey;
	scheduled?: DateKey;
	start?: DateKey;
	done?: DateKey;
	created?: DateKey;
	until?: DateKey;
	recurText?: string;
	target?: string;
	startTime?: string;
	duration?: number;
	untilDone?: boolean;
}

/**
 * Pulls every emoji field out of the description, left to right. A field's
 * value runs until the next known marker, which lets free-text fields like
 * 🔁 "every 2 weeks on Monday" work without a terminator.
 */
function extractFields(body: string): ExtractedFields {
	const out: ExtractedFields = { remainder: "", priority: "none" };
	const kept: string[] = [];

	let i = 0;
	while (i < body.length) {
		const marker = markerAt(body, i);
		if (!marker) {
			kept.push(body[i]);
			i += 1;
			continue;
		}

		const valueStart = i + marker.length;
		const valueEnd = nextMarkerIndex(body, valueStart);
		// Many of these emoji are commonly typed with a U+FE0F variation
		// selector; it belongs to the marker, not the value.
		const value = body.slice(valueStart, valueEnd).replace(/^\uFE0F/, "").trim();
		i = valueEnd;

		const priority = EMOJI_TO_PRIORITY.get(marker);
		if (priority) {
			out.priority = priority;
			// Priority emoji carry no value — put the text back.
			kept.push(" ", value, " ");
			continue;
		}

		switch (marker) {
			case SYM.due:
				out.due = takeDate(value, kept); break;
			case SYM.scheduled:
				out.scheduled = takeDate(value, kept); break;
			case SYM.start:
				out.start = takeDate(value, kept); break;
			case SYM.done:
				out.done = takeDate(value, kept); break;
			case SYM.created:
				out.created = takeDate(value, kept); break;
			case SYM.until:
				out.until = takeDate(value, kept); break;
			case LEGACY_UNTIL: {
				// Only a date can have been ours. `🏁 delete` belongs to the
				// Tasks plugin and is put back exactly as it was found.
				const legacy = value.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/s);
				if (legacy) {
					out.until = legacy[1];
					if (legacy[2].trim()) kept.push(" ", legacy[2], " ");
				} else {
					kept.push(" ", marker, " ", value, " ");
				}
				break;
			}
			case SYM.cancelled:
				takeDate(value, kept); break;
			case SYM.recur:
				out.recurText = value; break;
			case SYM.target:
				out.target = parseTarget(value); break;
			case SYM.time:
				out.startTime = takeValue(value, parseTime, kept); break;
			case SYM.duration:
				out.duration = takeValue(value, parseDuration, kept); break;
			case SYM.untilDone:
				// A bare flag — whatever follows is description text.
				out.untilDone = true;
				kept.push(" ", value, " ");
				break;
			default:
				kept.push(marker, value);
		}
	}

	out.remainder = kept.join("");
	return out;
}

/**
 * Consumes the leading token of `value` via `parse`; whatever follows is
 * description text and goes back into the line.
 */
function takeValue<T>(
	value: string,
	parse: (s: string) => T | undefined,
	kept: string[],
): T | undefined {
	const [head, ...rest] = value.split(/\s+/);
	const parsed = parse(head);
	if (parsed === undefined) {
		kept.push(" ", value, " ");
		return undefined;
	}
	if (rest.length) kept.push(" ", rest.join(" "), " ");
	return parsed;
}

/** Consumes a leading date from `value`; anything after it is description text. */
function takeDate(value: string, kept: string[]): DateKey | undefined {
	const m = value.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/s);
	if (!m) {
		kept.push(" ", value, " ");
		return undefined;
	}
	if (m[2]) kept.push(" ", m[2], " ");
	return m[1];
}

/** `🎯 [[Exam]]` -> "Exam"; `🎯 2026-09-01` -> "2026-09-01". */
function parseTarget(value: string): string | undefined {
	const link = value.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
	if (link) return link[1].trim();
	const first = value.split(/\s+/)[0];
	return first || undefined;
}

function markerAt(s: string, i: number): string | undefined {
	for (const marker of ALL_MARKERS) {
		if (marker && s.startsWith(marker, i)) return marker;
	}
	return undefined;
}

function nextMarkerIndex(s: string, from: number): number {
	for (let i = from; i < s.length; i++) {
		if (markerAt(s, i)) return i;
	}
	return s.length;
}

/** Normalises "9:5", "09:05", "9.05" to "09:05"; rejects out-of-range values. */
export function parseTime(value: string): string | undefined {
	const m = value.match(/^(\d{1,2})[:.](\d{2})/);
	if (!m) return undefined;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return undefined;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Accepts "90", "90m", "1h", "1h30", "1h30m", "1.5h" — returns minutes. */
export function parseDuration(value: string): number | undefined {
	const text = value.trim().toLowerCase();

	const hm = text.match(/^(\d+(?:\.\d+)?)\s*h(?:ou)?r?s?\s*(\d+)?\s*m?/);
	if (hm) {
		const mins = Math.round(Number(hm[1]) * 60) + (hm[2] ? Number(hm[2]) : 0);
		return mins > 0 ? mins : undefined;
	}

	const m = text.match(/^(\d+)\s*m/);
	if (m) return Number(m[1]) > 0 ? Number(m[1]) : undefined;

	const bare = text.match(/^(\d+)$/);
	if (bare) return Number(bare[1]) > 0 ? Number(bare[1]) : undefined;

	return undefined;
}

/** 90 -> "1h30m", 120 -> "2h", 45 -> "45m". */
export function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h && m) return `${h}h${m}m`;
	if (h) return `${h}h`;
	return `${m}m`;
}

/** "09:00" -> 540. */
export function timeToMinutes(value: string): number | undefined {
	const t = parseTime(value);
	if (!t) return undefined;
	const [h, m] = t.split(":").map(Number);
	return h * 60 + m;
}

/**
 * Minutes from `start` to `end`. An end earlier than the start is read as
 * the next day, so 23:00 -> 01:00 is two hours rather than negative.
 * Identical times are rejected — a zero-length task is almost certainly a
 * mistake, not an intent.
 */
export function durationBetween(start: string, end: string): number | undefined {
	const s = timeToMinutes(start);
	const e = timeToMinutes(end);
	if (s === undefined || e === undefined) return undefined;
	const diff = (e - s + 1440) % 1440;
	return diff === 0 ? undefined : diff;
}

/** "09:00" + 90 -> "10:30". Wraps within the day. */
export function endTimeOf(startTime: string, duration: number): string {
	const [h, m] = startTime.split(":").map(Number);
	const total = (h * 60 + m + duration) % 1440;
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Rebuilds a full markdown line from a task, in canonical field order. */
export function serializeTask(task: TaskItem): string {
	const parts: string[] = [task.title.trim()];

	const push = (sym: string, value?: string) => {
		if (value) parts.push(`${sym} ${value}`);
	};

	if (task.priority !== "none") parts.push(PRIORITY_EMOJI[task.priority]);
	if (task.recurrence) push(SYM.recur, formatRecurrence(task.recurrence));
	// Only meaningful alongside a repeat, so never written without one.
	if (task.recurrence && task.untilDone) parts.push(SYM.untilDone);
	push(SYM.until, task.until);
	push(SYM.target, task.target ? (isDateKey(task.target) ? task.target : `[[${task.target}]]`) : undefined);
	push(SYM.created, task.createdDate);
	push(SYM.start, task.start);
	push(SYM.scheduled, task.scheduled);
	push(SYM.due, task.due);
	push(SYM.time, task.startTime);
	push(SYM.duration, task.duration ? formatDuration(task.duration) : undefined);
	push(SYM.done, task.doneDate);

	const line = `${task.indent}${task.bullet} [${task.status}] ${parts.filter(Boolean).join(" ")}`;
	return task.blockId ? `${line} ^${task.blockId}` : line;
}

/** The date a task belongs on in the calendar. */
export function anchorDate(task: TaskItem): DateKey | undefined {
	return task.due ?? task.scheduled ?? task.start;
}

/** Which field the anchor came from — so rescheduling writes back to the same one. */
export function anchorField(task: TaskItem): "due" | "scheduled" | "start" {
	if (task.due) return "due";
	if (task.scheduled) return "scheduled";
	if (task.start) return "start";
	return "due";
}

/** Tags are rendered as their own pills, so drop them from the title text. */
export function stripTags(title: string): string {
	return title.replace(TAG, "").replace(/\s+/g, " ").trim();
}

/** Identifies all lines belonging to one recurring series (same file + title). */
export function seriesKey(task: TaskItem): string {
	return `${task.path}::${task.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
}
