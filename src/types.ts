import type { DateKey } from "./dates";

export const PRIORITIES = ["highest", "high", "medium", "none", "low", "lowest"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Sort weight — lower sorts first. */
export const PRIORITY_ORDER: Record<Priority, number> = {
	highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5,
};

export const PRIORITY_EMOJI: Record<Priority, string> = {
	highest: "🔺", high: "⏫", medium: "🔼", none: "", low: "🔽", lowest: "⏬",
};

/**
 * Seeds for the settings colour pickers, mirroring the stylesheet's
 * defaults. The CSS keeps using theme variables until a colour is
 * actually chosen, so a themed vault stays themed.
 */
export const PRIORITY_FALLBACK: Record<Priority, string> = {
	highest: "#e5534b", high: "#e08c3b", medium: "#d1b34a",
	none: "#888888", low: "#5c93d6", lowest: "#9d7cd8",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
	highest: "Highest", high: "High", medium: "Medium", none: "Normal", low: "Low", lowest: "Lowest",
};

/** Emoji field markers — deliberately identical to the obsidian-tasks plugin
 *  so notes stay portable if that plugin is ever installed. */
export const SYM = {
	due: "📅",
	scheduled: "⏳",
	start: "🛫",
	done: "✅",
	created: "➕",
	cancelled: "❌",
	recur: "🔁",
	/** Non-standard extensions owned by this plugin: */
	until: "🔚",     // recurrence end date
	target: "🎯",    // linked event (countdown anchor)
	time: "⏰",      // start time of day, "HH:MM"
	duration: "⏱",  // how long it takes, e.g. "1h30m"
	untilDone: "📌", // repeat is one job, not a fresh task each time
} as const;

/**
 * Markers owned by the Tasks plugin that we must not claim.
 *
 * 🏁 is its "On Completion" action (`🏁 delete`). AgendaPlus used it for
 * the recurrence end date until that clash was spotted — dated values are
 * still read back for the notes already written that way, but anything
 * else is passed through untouched so Tasks keeps working.
 */
export const LEGACY_UNTIL = "🏁";

export type RecurFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
	/** Original human text, preserved so we round-trip the line unchanged. */
	raw: string;
	freq: RecurFreq;
	interval: number;
	/** For weekly rules: 0=Sun .. 6=Sat. Empty means "same weekday as the anchor". */
	weekdays: number[];
	/** For monthly rules: day-of-month, e.g. 15. */
	monthDay?: number;
	/** "every day when done" — next occurrence counts from the completion date. */
	whenDone: boolean;
}

export interface TaskItem {
	/** Stable within an index generation: "<path>:<line>". */
	id: string;
	path: string;
	line: number;
	/** Leading whitespace and bullet token, preserved on write-back. */
	indent: string;
	bullet: string;
	status: string;
	done: boolean;
	cancelled: boolean;
	/** Description with all metadata stripped — what we render. */
	title: string;
	/** Description exactly as written, metadata included. */
	rawDescription: string;
	tags: string[];
	priority: Priority;
	due?: DateKey;
	scheduled?: DateKey;
	start?: DateKey;
	doneDate?: DateKey;
	createdDate?: DateKey;
	until?: DateKey;
	recurrence?: Recurrence;
	/** Event name (from `🎯 [[Event]]`) or a bare date. */
	target?: string;
	/** Local start time as "HH:MM". Optional — most tasks are all-day. */
	startTime?: string;
	/** How long the task takes, in minutes. Independent of `startTime`. */
	duration?: number;
	/**
	 * How the repeat behaves when it's ticked off.
	 *
	 * False (the default) is a habit: every occurrence is its own task, so
	 * finishing today leaves tomorrow's untouched. True is one piece of work
	 * repeated as a reminder until it's finished — completing any occurrence
	 * closes the whole series.
	 */
	untilDone?: boolean;
	/** Free markdown from the indented block beneath the task line. */
	description?: string;
	/** How many raw lines that block occupies — needed to rewrite it. */
	descriptionLines?: number;
	blockId?: string;
}

/**
 * A task as it appears on one specific day in the calendar. Either a real
 * line in a file, or a generated future repeat of a recurring task.
 */
export interface TaskOccurrence {
	task: TaskItem;
	date: DateKey;
	/** True when this instance has no line of its own yet. */
	virtual: boolean;
	/** Days until the linked event, when the task has one. */
	countdown?: number;
}

export interface EventItem {
	path: string;
	title: string;
	start: DateKey;
	end: DateKey;
	allDay: boolean;
	startTime?: string; // "HH:MM"
	endTime?: string;
	color?: string;
	tags: string[];
}

export interface DayBucket {
	date: DateKey;
	occurrences: TaskOccurrence[];
	events: EventItem[];
}
