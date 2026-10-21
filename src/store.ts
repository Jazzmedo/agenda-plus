import { App, Notice, TFile, getAllTags, normalizePath } from "obsidian";
import {
	addDays, daysBetween, fromKey, isDateKey, toKey, today, todayKey, type DateKey,
} from "./dates";
import { anchorDate, anchorField, isTaskLine, parseTaskLine, seriesKey, serializeTask } from "./parser";
import { readDescription, writeDescription } from "./description";
import { inFolder } from "./paths";
import { occurrencesBetween } from "./recurrence";
import { eventFolderPath, inboxNotePath, type AgendaPlusSettings } from "./settings";
import {
	PRIORITY_ORDER, type DayBucket, type EventItem, type Priority, type TaskItem, type TaskOccurrence,
} from "./types";

export class TaskStore {
	/** path -> tasks parsed from that file. */
	private byFile = new Map<string, TaskItem[]>();
	private events: EventItem[] = [];
	private listeners = new Set<() => void>();
	private rebuildTimer: number | null = null;

	constructor(
		private app: App,
		readonly settings: () => AgendaPlusSettings,
	) {}

	/** Cancels any queued reindex so it can't fire after unload. */
	dispose(): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}
		this.listeners.clear();
	}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
	}

	// ── Indexing ──────────────────────────────────────────────────────────

	async rebuild(): Promise<void> {
		this.byFile.clear();
		// Filtering here avoids reading files we would only discard.
		const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isIgnored(f.path));
		await Promise.all(files.map((f) => this.indexFile(f, false)));
		this.indexEvents();
		this.notify();
	}

	/** Coalesces bursts of vault events into a single reindex. */
	scheduleRebuild(delay = 400): void {
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			void this.rebuild();
		}, delay);
	}

	async indexFile(file: TFile, notify = true): Promise<void> {
		if (file.extension !== "md") return;
		if (this.isIgnored(file.path)) {
			this.byFile.delete(file.path);
			if (notify) this.notify();
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const tasks: TaskItem[] = [];

		let inFrontmatter = false;
		let inCodeFence = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
			if (inFrontmatter) {
				if (line.trim() === "---") inFrontmatter = false;
				continue;
			}
			if (/^\s*(```|~~~)/.test(line)) { inCodeFence = !inCodeFence; continue; }
			if (inCodeFence) continue;

			if (!isTaskLine(line)) continue;
			const task = parseTaskLine(line, file.path, i);
			if (!task) continue;

			const block = readDescription(lines, i);
			task.description = block.text || undefined;
			task.descriptionLines = block.lines;

			tasks.push(this.applyTagPriorities(task));
		}

		if (tasks.length) this.byFile.set(file.path, tasks);
		else this.byFile.delete(file.path);

		if (file.path.startsWith(`${eventFolderPath(this.settings())}/`)) this.indexEvents();
		if (notify) this.notify();
	}

	removeFile(path: string): void {
		this.byFile.delete(path);
		if (path.startsWith(`${eventFolderPath(this.settings())}/`)) this.indexEvents();
		this.notify();
	}

	private isIgnored(path: string): boolean {
		const settings = this.settings();

		// Scope check first: when restricted, anything outside the calendar
		// folder is invisible to the plugin regardless of other rules.
		if (settings.restrictToCalendarFolder && !inFolder(path, settings.calendarFolder)) {
			return true;
		}

		return settings.ignoredFolders.some((f) => f && inFolder(path, f));
	}

	/** A task with a configured priority tag inherits that priority. */
	private applyTagPriorities(task: TaskItem): TaskItem {
		if (task.priority !== "none") return task;
		const map = this.settings().tagPriorities;
		let best: Priority | undefined;
		for (const tag of task.tags) {
			const p = map[tag];
			if (p && (!best || PRIORITY_ORDER[p] < PRIORITY_ORDER[best])) best = p;
		}
		return best ? { ...task, priority: best } : task;
	}

	// ── Events ────────────────────────────────────────────────────────────

	private indexEvents(): void {
		const folder = eventFolderPath(this.settings());
		this.events = [];
		if (!folder) return;

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(`${folder}/`)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;

			const start = normaliseDate(fm.start ?? fm.date);
			if (!start) continue;
			const end = normaliseDate(fm.end ?? fm.endDate) ?? start;

			this.events.push({
				path: file.path,
				title: String(fm.title ?? file.basename),
				start,
				end: end < start ? start : end,
				allDay: fm.allDay !== false && !fm.startTime,
				startTime: fm.startTime ? String(fm.startTime) : undefined,
				endTime: fm.endTime ? String(fm.endTime) : undefined,
				color: fm.color ? String(fm.color) : undefined,
				tags: toArray(fm.tags).map((t) => (t.startsWith("#") ? t : `#${t}`)),
			});
		}

		this.events.sort((a, b) => a.start.localeCompare(b.start));
	}

	getEvents(): EventItem[] {
		return this.events;
	}

	findEvent(nameOrDate: string): EventItem | undefined {
		if (isDateKey(nameOrDate)) return undefined;
		const needle = nameOrDate.toLowerCase();
		return this.events.find(
			(e) =>
				e.title.toLowerCase() === needle ||
				e.path.toLowerCase() === `${needle}.md` ||
				e.path.split("/").pop()?.toLowerCase() === `${needle}.md`,
		);
	}

	/** The date a task's 🎯 target resolves to, if any. */
	targetDate(task: TaskItem): DateKey | undefined {
		if (!task.target) return undefined;
		if (isDateKey(task.target)) return task.target;
		return this.findEvent(task.target)?.start;
	}

	// ── Queries ───────────────────────────────────────────────────────────

	allTasks(): TaskItem[] {
		return [...this.byFile.values()].flat();
	}

	getTask(id: string): TaskItem | undefined {
		return this.allTasks().find((t) => t.id === id);
	}

	/**
	 * Expands every task into the concrete days it occupies within the range,
	 * including generated future repeats of recurring tasks.
	 */
	occurrencesInRange(rangeStart: Date, rangeEnd: Date): Map<DateKey, TaskOccurrence[]> {
		const out = new Map<DateKey, TaskOccurrence[]>();
		const tasks = this.allTasks();

		// Real lines that already exist for each series, so a generated repeat
		// never doubles up with a line the user (or we) actually wrote.
		const realDates = new Map<string, Set<DateKey>>();
		for (const t of tasks) {
			const d = anchorDate(t);
			if (!d) continue;
			const key = seriesKey(t);
			if (!realDates.has(key)) realDates.set(key, new Set());
			realDates.get(key)!.add(d);
		}

		const push = (date: DateKey, occ: TaskOccurrence) => {
			if (!out.has(date)) out.set(date, []);
			out.get(date)!.push(occ);
		};

		const horizon = addDays(today(), this.settings().projectionDays);
		const projectionEnd = rangeEnd.getTime() < horizon.getTime() ? rangeEnd : horizon;

		for (const task of tasks) {
			const target = this.targetDate(task);
			const countdownFor = (date: DateKey) =>
				target ? daysBetween(fromKey(date), fromKey(target)) : undefined;

			// 1. The real line, on its own anchor date.
			const anchor = anchorDate(task) ?? (task.done ? task.doneDate : undefined);
			if (anchor && inRange(anchor, rangeStart, rangeEnd)) {
				push(anchor, { task, date: anchor, virtual: false, countdown: countdownFor(anchor) });
			}

			// 2. Generated future repeats.
			if (!task.recurrence || task.done || task.cancelled) continue;
			const seriesAnchor = anchorDate(task) ?? task.createdDate ?? todayKey();
			const until = task.until ?? target;
			const existing = realDates.get(seriesKey(task)) ?? new Set<DateKey>();

			const dates = occurrencesBetween(
				task.recurrence, seriesAnchor, rangeStart, projectionEnd, until,
			);
			for (const date of dates) {
				if (existing.has(date)) continue;
				push(date, { task, date, virtual: true, countdown: countdownFor(date) });
			}
		}

		for (const list of out.values()) list.sort(compareOccurrences);
		return out;
	}

	eventsOnDate(date: DateKey): EventItem[] {
		return this.events.filter((e) => date >= e.start && date <= e.end);
	}

	buildDays(rangeStart: Date, rangeEnd: Date): DayBucket[] {
		const occs = this.occurrencesInRange(rangeStart, rangeEnd);
		const out: DayBucket[] = [];
		for (let d = rangeStart; d.getTime() <= rangeEnd.getTime(); d = addDays(d, 1)) {
			const key = toKey(d);
			out.push({ date: key, occurrences: occs.get(key) ?? [], events: this.eventsOnDate(key) });
		}
		return out;
	}

	/** Unfinished tasks whose date is strictly before today. */
	overdue(): TaskOccurrence[] {
		const t = todayKey();
		return this.allTasks()
			.filter((task) => !task.done && !task.cancelled)
			.map((task) => ({ task, date: anchorDate(task)!, virtual: false }))
			.filter((o) => o.date && o.date < t)
			.sort(compareOccurrences);
	}

	/** Undated, unfinished tasks — the backlog. */
	unscheduled(): TaskItem[] {
		return this.allTasks()
			.filter((t) => !t.done && !t.cancelled && !anchorDate(t))
			.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
	}

	/** Tags carried by indexed tasks. Drives filters and the stats breakdown. */
	allTags(): { tag: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const t of this.allTasks()) {
			for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count);
	}

	/**
	 * Every tag anywhere in the vault, task or not — inline and frontmatter,
	 * via Obsidian's own metadata cache.
	 *
	 * Task tags alone are too narrow for the tag picker: with indexing scoped
	 * to the calendar folder, a vault full of tags would offer none of them
	 * just because no task uses one yet.
	 */
	knownTags(): { tag: string; count: number }[] {
		const counts = new Map<string, number>();

		for (const { tag, count } of this.allTags()) {
			counts.set(tag, count);
		}

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			for (const tag of getAllTags(cache) ?? []) {
				// Task tags already counted above keep their (higher) weight.
				if (!counts.has(tag)) counts.set(tag, 0);
			}
		}

		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	}

	// ── Mutations ─────────────────────────────────────────────────────────

	/**
	 * Rewrites a task line in place.
	 *
	 * `span` covers the task's description block as well, so an edit that
	 * shortens or drops the description doesn't strand orphaned indented
	 * lines under the next task.
	 */
	private async editLine(
		path: string,
		line: number,
		fn: (current: string) => string | string[] | null,
		span = 1,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`AgendaPlus: file not found — ${path}`);
			return;
		}

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			if (line < 0 || line >= lines.length) return data;
			const width = Math.max(1, Math.min(span, lines.length - line));
			const replacement = fn(lines[line]);
			if (replacement === null) lines.splice(line, width);
			else lines.splice(line, width, ...(Array.isArray(replacement) ? replacement : [replacement]));
			return lines.join("\n");
		});

		await this.indexFile(file);
	}

	/**
	 * Checks a task off, or un-checks it.
	 *
	 * Recurring tasks follow the obsidian-tasks convention: the master line
	 * stays open and moves to its next date, and a completed copy is written
	 * beneath it so history (and therefore stats) survives in plain text.
	 */
	async setDone(occ: TaskOccurrence, done: boolean): Promise<void> {
		const { task } = occ;
		const stamp = this.settings().trackCompletionDates ? todayKey() : undefined;

		// "One job, repeated until done": finishing any occurrence finishes
		// the work, so the master closes and the remaining repeats — which
		// were only ever reminders of the same job — stop being generated.
		if (done && task.recurrence && task.untilDone && !task.done) {
			await this.closeSeries(task, stamp);
			return;
		}

		if (occ.virtual) {
			if (!done) return; // nothing to un-check yet
			await this.completeVirtualOccurrence(occ, stamp);
			return;
		}

		if (done && task.recurrence && !task.done) {
			await this.completeRecurringMaster(task, occ.date, stamp);
			return;
		}

		// Un-checking a completed copy has to undo the whole completion, not
		// just the checkbox — otherwise the copy survives as a second, open,
		// non-repeating task sitting next to the series it came from.
		if (!done && task.done && !task.recurrence && await this.undoSeriesCompletion(occ)) {
			return;
		}

		await this.editLine(task.path, task.line, (current) => {
			const parsed = parseTaskLine(current, task.path, task.line);
			if (!parsed) return current;
			parsed.status = done ? "x" : " ";
			parsed.done = done;
			parsed.doneDate = done ? stamp : undefined;
			return serializeTask(parsed);
		});
	}

	/**
	 * Closes a whole "until done" series in place.
	 *
	 * No completed copy is written and the master isn't rolled forward —
	 * there was only ever one job. Marking the single line done stops the
	 * remaining occurrences being generated, and un-checking it brings the
	 * whole series back.
	 */
	private async closeSeries(task: TaskItem, stamp?: DateKey): Promise<void> {
		await this.editLine(task.path, task.line, (current) => {
			const parsed = parseTaskLine(current, task.path, task.line);
			if (!parsed) return current;
			parsed.status = "x";
			parsed.done = true;
			parsed.doneDate = stamp;
			return serializeTask(parsed);
		});
	}

	/** Writes a completed copy for a generated repeat, leaving the master alone. */
	private async completeVirtualOccurrence(occ: TaskOccurrence, stamp?: DateKey): Promise<void> {
		const { task } = occ;
		await this.editLine(task.path, task.line, (current) => {
			const parsed = parseTaskLine(current, task.path, task.line);
			if (!parsed) return current;
			const copy = this.buildCompletedCopy(parsed, occ.date, stamp);
			return [current, copy];
		});
	}

	/** Completes the current occurrence and rolls the master to the next date. */
	private async completeRecurringMaster(
		task: TaskItem, date: DateKey, stamp?: DateKey,
	): Promise<void> {
		await this.editLine(task.path, task.line, (current) => {
			const parsed = parseTaskLine(current, task.path, task.line);
			if (!parsed?.recurrence) return current;

			const copy = this.buildCompletedCopy(parsed, date, stamp);

			const field = anchorField(parsed);
			// "when done" rules count from completion; otherwise from the due date.
			const from = parsed.recurrence.whenDone ? fromKey(stamp ?? todayKey()) : fromKey(date);
			const next = occurrencesBetween(
				parsed.recurrence,
				toKey(from),
				addDays(from, 1),
				addDays(from, 800),
				parsed.until ?? this.targetDate(parsed),
			)[0];

			if (!next) {
				// Series has run out — close the master line instead of rolling it.
				parsed.status = "x";
				parsed.doneDate = stamp;
				return serializeTask(parsed);
			}

			parsed[field] = next;
			return [copy, serializeTask(parsed)];
		});
	}

	/**
	 * Reverses a completion that belonged to a repeating series.
	 *
	 * Checking a repeat off writes a completed copy and — for the master
	 * line — rolls it to the next date. Both halves have to come back, so
	 * the copy is deleted and the master moved back to the date being
	 * un-checked. Where the master never moved (a generated occurrence was
	 * completed, leaving the master where it was) only the copy goes.
	 *
	 * Returns false when the line isn't part of a series, leaving the
	 * caller to un-check it the ordinary way.
	 */
	private async undoSeriesCompletion(occ: TaskOccurrence): Promise<boolean> {
		const copy = occ.task;
		const key = seriesKey(copy);

		const master = this.allTasks().find(
			(t) => t.recurrence && t.path === copy.path && t.line !== copy.line && seriesKey(t) === key,
		);
		if (!master) return false;

		const file = this.app.vault.getAbstractFileByPath(copy.path);
		if (!(file instanceof TFile)) return false;

		// The master only moved if it now sits past the date being restored.
		const anchor = anchorDate(master);
		const rollBack = !!anchor && anchor > occ.date;

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			if (copy.line >= lines.length || master.line >= lines.length) return data;

			// Rewrite the master before removing the copy, so both line
			// numbers still refer to what they did at index time.
			if (rollBack) {
				const parsed = parseTaskLine(lines[master.line], master.path, master.line);
				if (parsed?.recurrence) {
					parsed[anchorField(parsed)] = occ.date;
					lines[master.line] = serializeTask(parsed);
				}
			}

			lines.splice(copy.line, 1);
			return lines.join("\n");
		});

		await this.indexFile(file);
		return true;
	}

	private buildCompletedCopy(task: TaskItem, date: DateKey, stamp?: DateKey): string {
		const copy: TaskItem = {
			...task,
			status: "x",
			done: true,
			doneDate: stamp,
			recurrence: undefined,
			until: undefined,
			blockId: undefined,
			due: undefined,
			scheduled: undefined,
			start: undefined,
		};
		copy[anchorField(task)] = date;
		return serializeTask(copy);
	}

	/** Moves a task to another day — used by calendar drag and drop. */
	async reschedule(occ: TaskOccurrence, newDate: DateKey): Promise<void> {
		const { task } = occ;

		if (occ.virtual) {
			new Notice("Repeating occurrences can't be moved individually — edit the task to change its schedule.");
			return;
		}

		await this.editLine(task.path, task.line, (current) => {
			const parsed = parseTaskLine(current, task.path, task.line);
			if (!parsed) return current;
			parsed[anchorField(parsed)] = newDate;
			return serializeTask(parsed);
		});
	}

	async updateTask(original: TaskItem, next: Partial<TaskItem>): Promise<void> {
		// An absent key means "leave it alone"; an empty string clears it.
		const description = "description" in next ? next.description : original.description;

		await this.editLine(
			original.path,
			original.line,
			(current) => {
				const parsed = parseTaskLine(current, original.path, original.line);
				if (!parsed) return current;
				const line = serializeTask({ ...parsed, ...next });
				return [line, ...writeDescription(description ?? "", parsed.indent)];
			},
			1 + (original.descriptionLines ?? 0),
		);
	}

	async deleteTask(task: TaskItem): Promise<void> {
		// Takes the description block with it, not just the checkbox.
		await this.editLine(task.path, task.line, () => null, 1 + (task.descriptionLines ?? 0));
	}

	/** Appends a new task line to the inbox note, creating it if needed. */
	async createTask(task: Partial<TaskItem>, targetPath?: string): Promise<void> {
		const path = normalizePath(targetPath || inboxNotePath(this.settings()));
		const file = await this.ensureFile(path);

		const line = serializeTask({
			id: "", path, line: 0,
			indent: "", bullet: "-", status: " ",
			done: false, cancelled: false,
			title: (task.title ?? "Untitled").trim(),
			rawDescription: "",
			tags: task.tags ?? [],
			priority: task.priority ?? "none",
			due: task.due,
			scheduled: task.scheduled,
			start: task.start,
			createdDate: task.createdDate,
			until: task.until,
			recurrence: task.recurrence,
			target: task.target,
			untilDone: task.untilDone,
			startTime: task.startTime,
			duration: task.duration,
			doneDate: undefined,
			blockId: undefined,
		});

		const heading = this.settings().inboxHeading;
		const block = [line, ...writeDescription(task.description ?? "", "")];

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			const at = heading ? findHeadingInsertPoint(lines, heading) : -1;

			if (at >= 0) {
				lines.splice(at, 0, ...block);
				return lines.join("\n");
			}
			const sep = data.length === 0 || data.endsWith("\n") ? "" : "\n";
			return `${data}${sep}${block.join("\n")}\n`;
		});

		await this.indexFile(file);
	}

	async createEvent(event: Omit<EventItem, "path">): Promise<TFile> {
		const folder = eventFolderPath(this.settings());
		const safeName = event.title.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Event";
		const path = normalizePath(`${folder}/${safeName}.md`);

		const fm = [
			"---",
			`title: ${event.title}`,
			`start: ${event.start}`,
			`end: ${event.end}`,
			`allDay: ${event.allDay}`,
			...(event.startTime ? [`startTime: ${event.startTime}`] : []),
			...(event.endTime ? [`endTime: ${event.endTime}`] : []),
			...(event.color ? [`color: "${event.color}"`] : []),
			...(event.tags.length ? [`tags: [${event.tags.map((t) => t.replace(/^#/, "")).join(", ")}]`] : []),
			"---",
			"",
		].join("\n");

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, fm);
			this.indexEvents();
			this.notify();
			return existing;
		}

		await this.ensureFolder(folder);
		const file = await this.app.vault.create(path, fm);
		this.indexEvents();
		this.notify();
		return file;
	}

	private async ensureFile(path: string): Promise<TFile> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;

		const folder = path.split("/").slice(0, -1).join("/");
		if (folder) await this.ensureFolder(folder);
		return this.app.vault.create(path, "");
	}

	private async ensureFolder(folder: string): Promise<void> {
		const parts = folder.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					// Racing with another creation is fine.
				}
			}
		}
	}

	/** Reveals a task's line in the editor. */
	async revealTask(task: TaskItem): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { eState: { line: task.line } });
	}
}

// ── helpers ─────────────────────────────────────────────────────────────

function inRange(date: DateKey, start: Date, end: Date): boolean {
	return date >= toKey(start) && date <= toKey(end);
}

function compareOccurrences(a: TaskOccurrence, b: TaskOccurrence): number {
	if (a.task.done !== b.task.done) return a.task.done ? 1 : -1;

	// Within a day the clock outranks priority: a 09:00 task belongs above a
	// high-priority one with no time. Untimed tasks fall to the bottom.
	const at = a.task.startTime;
	const bt = b.task.startTime;
	if (at && bt && at !== bt) return at.localeCompare(bt);
	if (at && !bt) return -1;
	if (!at && bt) return 1;

	const p = PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority];
	if (p !== 0) return p;
	return a.task.title.localeCompare(b.task.title);
}

function normaliseDate(value: unknown): DateKey | undefined {
	if (!value) return undefined;
	if (value instanceof Date) return toKey(value);
	const s = String(value).trim();
	const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : undefined;
}

function toArray(value: unknown): string[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map(String);
	return String(value).split(/[,\s]+/).filter(Boolean);
}

/** Line index to insert at: just after `## heading`'s last content line. */
function findHeadingInsertPoint(lines: string[], heading: string): number {
	const needle = heading.replace(/^#+\s*/, "").toLowerCase();
	let start = -1;
	let level = 0;

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
		if (!m) continue;
		if (start === -1 && m[2].trim().toLowerCase() === needle) {
			start = i;
			level = m[1].length;
			continue;
		}
		// Next heading of the same or shallower level closes the section.
		if (start !== -1 && m[1].length <= level) return i;
	}

	return start === -1 ? -1 : lines.length;
}
