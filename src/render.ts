import { App, Menu, TFile, setIcon } from "obsidian";
import { fromKey, relativeLabel, todayKey, type DateKey } from "./dates";
import { splitEmoji } from "./emoji";
import { endTimeOf, formatDuration, stripTags } from "./parser";
import { DatePromptModal } from "./modals";
import { describeRecurrence } from "./recurrence";
import type { TaskStore } from "./store";
import { PRIORITIES, PRIORITY_LABEL, type EventItem, type TaskOccurrence } from "./types";

export interface RenderCtx {
	app: App;
	store: TaskStore;
	refresh: () => void;
	/** Opens the edit modal for a task. */
	edit: (occ: TaskOccurrence) => void;
}

export interface DragPayload {
	path: string;
	line: number;
	date: DateKey;
	virtual: boolean;
}

export const DRAG_MIME = "application/x-agenda-plus";

export function isTouch(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Pushes the configured priority colours onto a view root as CSS
 * variables. Unset priorities are left alone so the stylesheet's
 * theme-derived defaults keep applying.
 */
export function applyPriorityColors(root: HTMLElement, store: TaskStore): void {
	const colors = store.settings().priorityColors;
	for (const priority of PRIORITIES) {
		const value = colors[priority];
		if (value) root.style.setProperty(`--ct-pri-${priority}`, value);
		else root.style.removeProperty(`--ct-pri-${priority}`);
	}
}

/** Colour a chip by its highest-priority tag, falling back to priority. */
function chipColor(occ: TaskOccurrence, store: TaskStore): string | undefined {
	const colors = store.settings().tagColors;
	for (const tag of occ.task.tags) {
		if (colors[tag]) return colors[tag];
	}
	return undefined;
}

/** Compact single-line chip used inside month-view day cells. */
export function renderChip(parent: HTMLElement, occ: TaskOccurrence, ctx: RenderCtx): HTMLElement {
	const { task } = occ;
	const chip = parent.createDiv({
		cls: [
			"ct-chip",
			`ct-pri-${task.priority}`,
			task.done ? "is-done" : "",
			task.cancelled ? "is-cancelled" : "",
			occ.virtual ? "is-virtual" : "",
		].filter(Boolean).join(" "),
	});

	const color = chipColor(occ, ctx.store);
	if (color) chip.style.setProperty("--ct-chip-accent", color);

	const box = chip.createDiv({ cls: "ct-chip-check" });
	setIcon(box, task.done ? "check-square" : "square");
	box.addEventListener("click", async (e) => {
		e.stopPropagation();
		await ctx.store.setDone(occ, !task.done);
		ctx.refresh();
	});

	if (task.startTime) {
		chip.createSpan({ cls: "ct-chip-time", text: task.startTime });
	}

	const chipParts = splitEmoji(task.title);
	if (chipParts.emoji) chip.createSpan({ cls: "ct-emoji-icon", text: chipParts.emoji });
	chip.createSpan({ cls: "ct-chip-title", text: chipParts.text || "(untitled)" });

	if (task.recurrence) {
		const badge = chip.createSpan({ cls: "ct-chip-badge" });
		setIcon(badge, "repeat");
		badge.setAttribute("aria-label", describeRecurrence(task.recurrence));
	}

	if (occ.countdown !== undefined && occ.countdown >= 0 && !task.done) {
		chip.createSpan({
			cls: "ct-chip-countdown",
			text: occ.countdown === 0 ? "today" : `${occ.countdown}d`,
		});
	}

	attachInteractions(chip, occ, ctx);
	return chip;
}

/** Full-width row used in the Today list, week columns and day agenda. */
export function renderRow(
	parent: HTMLElement,
	occ: TaskOccurrence,
	ctx: RenderCtx,
	opts: { showDate?: boolean; showSource?: boolean } = {},
): HTMLElement {
	const { task } = occ;
	const row = parent.createDiv({
		cls: [
			"ct-row",
			`ct-pri-${task.priority}`,
			task.done ? "is-done" : "",
			occ.virtual ? "is-virtual" : "",
			!task.done && occ.date < todayKey() ? "is-overdue" : "",
		].filter(Boolean).join(" "),
	});

	const color = chipColor(occ, ctx.store);
	if (color) row.style.setProperty("--ct-chip-accent", color);

	const box = row.createDiv({ cls: "ct-row-check" });
	setIcon(box, task.done ? "check-square" : "square");
	box.addEventListener("click", async (e) => {
		e.stopPropagation();
		await ctx.store.setDone(occ, !task.done);
		ctx.refresh();
	});

	const main = row.createDiv({ cls: "ct-row-main" });
	const titleLine = main.createDiv({ cls: "ct-row-title" });

	// Priority reads as colour rather than an emoji badge — the dot keeps it
	// legible without spending a character of the title's width.
	if (task.priority !== "none") {
		titleLine.createSpan({
			cls: "ct-row-pri",
			attr: {
				"aria-label": `${PRIORITY_LABEL[task.priority]} priority`,
				title: `${PRIORITY_LABEL[task.priority]} priority`,
			},
		});
	}

	const icon = splitEmoji(task.title).emoji;
	if (icon) titleLine.createSpan({ cls: "ct-emoji-icon", text: icon });

	titleLine.createSpan({
		cls: "ct-row-text",
		text: splitEmoji(stripTags(task.title)).text || "(untitled)",
	});

	if (task.startTime || task.duration) {
		// "09:00 – 10:30" when both are known, otherwise whichever we have.
		const label =
			task.startTime && task.duration
				? `${task.startTime} – ${endTimeOf(task.startTime, task.duration)}`
				: task.startTime
					? task.startTime
					: formatDuration(task.duration!);
		titleLine.createSpan({ cls: "ct-row-time", text: label });
	}

	const meta = main.createDiv({ cls: "ct-row-meta" });

	if (opts.showDate && occ.date) {
		meta.createSpan({ cls: "ct-meta-date", text: relativeLabel(occ.date) });
	}

	const tagColors = ctx.store.settings().tagColors;
	for (const tag of task.tags) {
		const pill = meta.createSpan({ cls: "ct-tag", text: tag });
		if (tagColors[tag]) {
			pill.addClass("is-coloured");
			pill.style.setProperty("--ct-tag-color", tagColors[tag]);
		}
	}

	if (task.duration && task.startTime) {
		meta.createSpan({ cls: "ct-meta-duration", text: formatDuration(task.duration) });
	}

	if (task.recurrence) {
		meta.createSpan({ cls: "ct-meta-recur", text: `⟳ ${describeRecurrence(task.recurrence)}` });
		if (task.untilDone) {
			meta.createSpan({
				cls: "ct-meta-recur",
				text: "· one job",
				attr: { title: "Finishing this on any day clears the remaining repeats" },
			});
		}
	}

	// The full text lives in the note; the row shows a first line so a task
	// carrying detail is distinguishable at a glance from one that isn't.
	if (task.description) {
		const first = task.description.split("\n").find((l) => l.trim()) ?? "";
		const note = main.createDiv({ cls: "ct-row-desc" });
		note.createSpan({ cls: "ct-row-desc-icon", text: "▤" });
		note.createSpan({ text: first.replace(/^[#>\-*\s]+/, "").slice(0, 120) });
		note.setAttribute("title", task.description);
	}

	if (occ.countdown !== undefined && !task.done) {
		const label =
			occ.countdown > 0 ? `${occ.countdown} days to ${task.target}`
			: occ.countdown === 0 ? `${task.target} is today`
			: `${task.target} has passed`;
		meta.createSpan({ cls: "ct-meta-countdown", text: label });
	}

	if (opts.showSource) {
		meta.createSpan({ cls: "ct-meta-source", text: task.path.split("/").pop() ?? task.path });
	}

	attachInteractions(row, occ, ctx);
	return row;
}

/** Drag, click-to-edit and the right-click menu, shared by chips and rows. */
function attachInteractions(el: HTMLElement, occ: TaskOccurrence, ctx: RenderCtx): void {
	// On touch devices HTML5 drag events never fire, and a draggable element
	// swallows the scroll gesture. Rescheduling there goes through the
	// context menu's date picker instead.
	el.draggable = !isTouch();

	el.addEventListener("dragstart", (e) => {
		const payload: DragPayload = {
			path: occ.task.path,
			line: occ.task.line,
			date: occ.date,
			virtual: occ.virtual,
		};
		e.dataTransfer?.setData(DRAG_MIME, JSON.stringify(payload));
		e.dataTransfer?.setData("text/plain", occ.task.title);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		el.addClass("is-dragging");
	});

	el.addEventListener("dragend", () => el.removeClass("is-dragging"));

	el.addEventListener("click", (e) => {
		e.stopPropagation();
		ctx.edit(occ);
	});

	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		showTaskMenu(e, occ, ctx);
	});
}

function showTaskMenu(e: MouseEvent, occ: TaskOccurrence, ctx: RenderCtx): void {
	const menu = new Menu();
	const { task } = occ;

	menu.addItem((i) =>
		i.setTitle(task.done ? "Mark not done" : "Mark done")
			.setIcon(task.done ? "rotate-ccw" : "check")
			.onClick(async () => {
				await ctx.store.setDone(occ, !task.done);
				ctx.refresh();
			}),
	);

	menu.addItem((i) => i.setTitle("Edit…").setIcon("pencil").onClick(() => ctx.edit(occ)));

	menu.addSeparator();

	const shift = (days: number, label: string) =>
		menu.addItem((i) =>
			i.setTitle(label).setIcon("calendar").onClick(async () => {
				const next = new Date(fromKey(occ.date));
				next.setDate(next.getDate() + days);
				await ctx.store.reschedule(occ, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`);
				ctx.refresh();
			}),
		);

	if (!occ.virtual) {
		shift(1, "Postpone 1 day");
		shift(7, "Postpone 1 week");
		menu.addItem((i) =>
			i.setTitle("Move to today").setIcon("sun").onClick(async () => {
				await ctx.store.reschedule(occ, todayKey());
				ctx.refresh();
			}),
		);
		menu.addItem((i) =>
			i.setTitle("Move to date…").setIcon("calendar-days").onClick(() => {
				new DatePromptModal(
					ctx.app,
					"Move task to",
					occ.date,
					ctx.store.settings().dateFormat,
					async (date) => {
						await ctx.store.reschedule(occ, date);
						ctx.refresh();
					},
				).open();
			}),
		);
	}

	menu.addSeparator();

	menu.addItem((i) =>
		i.setTitle("Open in note").setIcon("file-text").onClick(() => void ctx.store.revealTask(task)),
	);

	if (!occ.virtual) {
		menu.addItem((i) =>
			i.setTitle("Delete").setIcon("trash-2").onClick(async () => {
				await ctx.store.deleteTask(task);
				ctx.refresh();
			}),
		);
	}

	menu.showAtMouseEvent(e);
}

export function renderEventBar(
	parent: HTMLElement,
	event: EventItem,
	date: DateKey,
	ctx: RenderCtx,
): HTMLElement {
	const isStart = event.start === date;
	const isEnd = event.end === date;
	const bar = parent.createDiv({
		cls: [
			"ct-event",
			isStart ? "is-start" : "",
			isEnd ? "is-end" : "",
			!isStart && !isEnd ? "is-middle" : "",
		].filter(Boolean).join(" "),
	});

	if (event.color) bar.style.setProperty("--ct-event-color", event.color);

	const label = isStart || date === event.start ? event.title : "";
	bar.createSpan({ cls: "ct-event-title", text: label || " " });

	if (isStart && !event.allDay && event.startTime) {
		bar.createSpan({ cls: "ct-event-time", text: event.startTime });
	}

	bar.addEventListener("click", (e) => {
		e.stopPropagation();
		const file = ctx.app.vault.getAbstractFileByPath(event.path);
		if (file instanceof TFile) void ctx.app.workspace.getLeaf("tab").openFile(file);
	});

	return bar;
}

