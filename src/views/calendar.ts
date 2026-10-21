import { ItemView, Menu, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import {
	addDays, addMonths, endOfMonth, endOfWeek, formatMonthYear, formatShort, fromKey,
	isoWeekNumber, isWeekend, startOfMonth, startOfWeek, toKey, today, todayKey, weekdayName,
	type DateKey,
} from "../dates";
import { EventModal, TaskModal } from "../modals";
import { DRAG_MIME, applyPriorityColors, renderChip, renderEventBar, renderRow, type DragPayload, type RenderCtx } from "../render";
import type AgendaPlusPlugin from "../main";
import type { DayBucket, TaskOccurrence } from "../types";

export const VIEW_CALENDAR = "agenda-plus-calendar";

type Mode = "month" | "week" | "day";

export class CalendarView extends ItemView {
	private cursor: Date = today();
	private mode: Mode = Platform.isPhone ? "day" : "month";
	private filterText = "";
	private filterTag = "";
	private hideDone = false;
	private unsubscribe?: () => void;

	constructor(leaf: WorkspaceLeaf, private plugin: AgendaPlusPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_CALENDAR; }
	getDisplayText(): string { return "AgendaPlus"; }
	getIcon(): string { return "calendar-days"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-calendar-view");
		applyPriorityColors(this.contentEl, this.plugin.store);
		this.unsubscribe = this.plugin.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	setMode(mode: Mode): void {
		this.mode = mode;
		this.render();
	}

	goToDate(date: Date): void {
		this.cursor = date;
		this.render();
	}

	private get ctx(): RenderCtx {
		return {
			app: this.app,
			store: this.plugin.store,
			refresh: () => this.render(),
			edit: (occ) =>
				new TaskModal(this.app, this.plugin.store, {
					existing: occ.task,
					onSubmit: () => this.render(),
				}).open(),
		};
	}

	render(): void {
		const scrollTop = this.contentEl.scrollTop;
		this.contentEl.empty();
		this.renderToolbar(this.contentEl);

		const body = this.contentEl.createDiv({ cls: "ct-cal-body" });
		if (this.mode === "month") this.renderMonth(body);
		else if (this.mode === "week") this.renderWeek(body);
		else this.renderDay(body);

		this.contentEl.scrollTop = scrollTop;
	}

	// ── Toolbar ───────────────────────────────────────────────────────────

	private renderToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "ct-toolbar" });

		const nav = bar.createDiv({ cls: "ct-toolbar-nav" });

		const navButton = (icon: string, tooltip: string, fn: () => void) => {
			const b = nav.createEl("button", { cls: "ct-icon-btn", attr: { "aria-label": tooltip } });
			setIcon(b, icon);
			b.addEventListener("click", fn);
		};

		navButton("chevron-left", "Previous", () => { this.cursor = this.step(-1); this.render(); });
		nav.createEl("button", { cls: "ct-btn ct-today-btn", text: "Today" })
			.addEventListener("click", () => { this.cursor = today(); this.render(); });
		navButton("chevron-right", "Next", () => { this.cursor = this.step(1); this.render(); });

		bar.createDiv({ cls: "ct-toolbar-title", text: this.periodTitle() });

		const modes = bar.createDiv({ cls: "ct-mode-switch" });
		(["month", "week", "day"] as Mode[]).forEach((m) => {
			const b = modes.createEl("button", {
				cls: `ct-mode-btn${this.mode === m ? " is-active" : ""}`,
				text: m[0].toUpperCase() + m.slice(1),
			});
			b.addEventListener("click", () => this.setMode(m));
		});

		const tools = bar.createDiv({ cls: "ct-toolbar-tools" });

		const search = tools.createEl("input", {
			cls: "ct-search",
			attr: { type: "search", placeholder: "Filter tasks…" },
		});
		search.value = this.filterText;
		search.addEventListener("input", () => {
			this.filterText = search.value;
			this.render();
			// Re-focus and restore the caret after the rebuild.
			const next = this.contentEl.querySelector<HTMLInputElement>(".ct-search");
			next?.focus();
			next?.setSelectionRange(next.value.length, next.value.length);
		});

		const tagSelect = tools.createEl("select", { cls: "ct-tag-select" });
		tagSelect.createEl("option", { value: "", text: "All tags" });
		for (const { tag, count } of this.plugin.store.allTags()) {
			tagSelect.createEl("option", { value: tag, text: `${tag} (${count})` });
		}
		tagSelect.value = this.filterTag;
		tagSelect.addEventListener("change", () => { this.filterTag = tagSelect.value; this.render(); });

		const doneToggle = tools.createEl("button", {
			cls: `ct-icon-btn${this.hideDone ? " is-active" : ""}`,
			attr: { "aria-label": this.hideDone ? "Show completed" : "Hide completed" },
		});
		setIcon(doneToggle, this.hideDone ? "eye-off" : "eye");
		doneToggle.addEventListener("click", () => { this.hideDone = !this.hideDone; this.render(); });

		const add = tools.createEl("button", { cls: "ct-btn ct-btn-cta", text: "+ Add" });
		add.addEventListener("click", (e) => {
			const menu = new Menu();
			menu.addItem((i) =>
				i.setTitle("New task").setIcon("check-square").onClick(() =>
					new TaskModal(this.app, this.plugin.store, {
						defaultDate: todayKey(),
						onSubmit: () => this.render(),
					}).open(),
				),
			);
			menu.addItem((i) =>
				i.setTitle("New event").setIcon("calendar-plus").onClick(() =>
					new EventModal(this.app, this.plugin.store, {
						defaultDate: todayKey(),
						onSubmit: () => this.render(),
					}).open(),
				),
			);
			menu.showAtMouseEvent(e);
		});
	}

	private step(direction: number): Date {
		if (this.mode === "month") return addMonths(this.cursor, direction);
		if (this.mode === "week") return addDays(this.cursor, 7 * direction);
		return addDays(this.cursor, direction);
	}

	private periodTitle(): string {
		if (this.mode === "month") return formatMonthYear(this.cursor);
		if (this.mode === "week") {
			const start = startOfWeek(this.cursor, this.settings.firstDayOfWeek);
			const end = endOfWeek(this.cursor, this.settings.firstDayOfWeek);
			const fmt = this.settings.dateFormat;
			return `Week ${isoWeekNumber(start)} · ${formatShort(start, fmt)} – ${formatShort(end, fmt)}`;
		}
		return formatShort(this.cursor, this.settings.dateFormat);
	}

	private get settings() { return this.plugin.settings; }

	/**
	 * Month cells are far smaller on a phone, so cap the chips shown there.
	 * Nothing is lost — the overflow still surfaces as "+N more", which
	 * opens the day view.
	 */
	private get chipLimit(): number {
		const configured = this.settings.maxChipsPerDay;
		if (Platform.isPhone) return Math.min(configured, 2);
		if (Platform.isMobile) return Math.min(configured, 3);
		return configured;
	}

	// ── Month ─────────────────────────────────────────────────────────────

	private renderMonth(parent: HTMLElement): void {
		const first = this.settings.firstDayOfWeek;
		const rangeStart = startOfWeek(startOfMonth(this.cursor), first);
		const rangeEnd = endOfWeek(endOfMonth(this.cursor), first);
		const days = this.plugin.store.buildDays(rangeStart, rangeEnd);

		const grid = parent.createDiv({ cls: "ct-month-grid" });

		const head = grid.createDiv({ cls: "ct-month-head" });
		for (let i = 0; i < 7; i++) {
			head.createDiv({ cls: "ct-weekday", text: weekdayName((first + i) % 7, true) });
		}

		const cells = grid.createDiv({ cls: "ct-month-cells" });
		const month = this.cursor.getMonth();

		for (const day of days) {
			const date = fromKey(day.date);
			const cell = cells.createDiv({
				cls: [
					"ct-day-cell",
					date.getMonth() === month ? "" : "is-outside",
					day.date === todayKey() ? "is-today" : "",
					isWeekend(date, this.settings.weekendDays) ? "is-weekend" : "",
				].filter(Boolean).join(" "),
			});

			this.makeDropTarget(cell, day.date);

			const header = cell.createDiv({ cls: "ct-day-header" });
			const num = header.createSpan({ cls: "ct-day-number", text: String(date.getDate()) });
			num.addEventListener("click", (e) => {
				e.stopPropagation();
				this.cursor = date;
				this.setMode("day");
			});

			const visible = this.filtered(day.occurrences);
			const remaining = visible.filter((o) => !o.task.done).length;
			if (remaining > 0) header.createSpan({ cls: "ct-day-count", text: String(remaining) });

			for (const event of day.events) renderEventBar(cell, event, day.date, this.ctx);

			const list = cell.createDiv({ cls: "ct-day-tasks" });
			const limit = this.chipLimit;
			visible.slice(0, limit).forEach((occ) => renderChip(list, occ, this.ctx));

			if (visible.length > limit) {
				const more = list.createDiv({
					cls: "ct-more",
					text: `+${visible.length - limit} more`,
				});
				more.addEventListener("click", (e) => {
					e.stopPropagation();
					this.cursor = date;
					this.setMode("day");
				});
			}

			cell.addEventListener("click", () => this.startInlineAdd(cell, day.date));
			cell.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.showDayMenu(e, day.date);
			});
		}
	}

	// ── Week ──────────────────────────────────────────────────────────────

	private renderWeek(parent: HTMLElement): void {
		const first = this.settings.firstDayOfWeek;
		const rangeStart = startOfWeek(this.cursor, first);
		const rangeEnd = endOfWeek(this.cursor, first);
		const days = this.plugin.store.buildDays(rangeStart, rangeEnd);

		this.renderWeekSummary(parent, days);

		const grid = parent.createDiv({ cls: "ct-week-grid" });

		for (const day of days) {
			const date = fromKey(day.date);
			const col = grid.createDiv({
				cls: [
					"ct-week-col",
					day.date === todayKey() ? "is-today" : "",
					isWeekend(date, this.settings.weekendDays) ? "is-weekend" : "",
				].filter(Boolean).join(" "),
			});

			this.makeDropTarget(col, day.date);

			const head = col.createDiv({ cls: "ct-week-col-head" });
			head.createDiv({ cls: "ct-week-dayname", text: weekdayName(date.getDay(), true) });
			head.createDiv({ cls: "ct-week-daynum", text: String(date.getDate()) });

			const visible = this.filtered(day.occurrences);
			const done = visible.filter((o) => o.task.done).length;
			if (visible.length) {
				head.createDiv({ cls: "ct-week-progress", text: `${done}/${visible.length}` });
			}

			for (const event of day.events) renderEventBar(col, event, day.date, this.ctx);

			const list = col.createDiv({ cls: "ct-week-tasks" });
			if (!visible.length) list.createDiv({ cls: "ct-empty-hint", text: "—" });
			visible.forEach((occ) => renderRow(list, occ, this.ctx));

			const add = col.createDiv({ cls: "ct-week-add", text: "+ add" });
			add.addEventListener("click", () => this.startInlineAdd(col, day.date));
		}
	}

	private renderWeekSummary(parent: HTMLElement, days: DayBucket[]): void {
		const all = days.flatMap((d) => this.filtered(d.occurrences));
		const done = all.filter((o) => o.task.done).length;
		const pct = all.length ? Math.round((done / all.length) * 100) : 0;

		const box = parent.createDiv({ cls: "ct-week-summary" });
		box.createSpan({ cls: "ct-week-summary-label", text: "This week" });

		const track = box.createDiv({ cls: "ct-progress-track" });
		track.createDiv({ cls: "ct-progress-fill" }).style.width = `${pct}%`;

		box.createSpan({ cls: "ct-week-summary-value", text: `${done}/${all.length} done · ${pct}%` });
	}

	// ── Day ───────────────────────────────────────────────────────────────

	private renderDay(parent: HTMLElement): void {
		const [day] = this.plugin.store.buildDays(this.cursor, this.cursor);
		const wrap = parent.createDiv({ cls: "ct-day-view" });
		this.makeDropTarget(wrap, day.date);

		if (day.events.length) {
			const section = wrap.createDiv({ cls: "ct-section" });
			section.createDiv({ cls: "ct-section-title", text: "Events" });
			for (const event of day.events) renderEventBar(section, event, day.date, this.ctx);
		}

		const visible = this.filtered(day.occurrences);
		const section = wrap.createDiv({ cls: "ct-section" });
		section.createDiv({ cls: "ct-section-title", text: `Tasks (${visible.filter((o) => !o.task.done).length} open)` });

		if (!visible.length) {
			section.createDiv({ cls: "ct-empty", text: "Nothing scheduled. Click below to add something." });
		}
		visible.forEach((occ) => renderRow(section, occ, this.ctx, { showSource: true }));

		const add = wrap.createDiv({ cls: "ct-week-add", text: "+ add task" });
		add.addEventListener("click", () => this.startInlineAdd(wrap, day.date));
	}

	// ── Shared behaviour ──────────────────────────────────────────────────

	private filtered(occurrences: TaskOccurrence[]): TaskOccurrence[] {
		const text = this.filterText.trim().toLowerCase();
		return occurrences.filter((o) => {
			if (this.hideDone && o.task.done) return false;
			if (this.filterTag && !o.task.tags.includes(this.filterTag)) return false;
			if (text && !o.task.title.toLowerCase().includes(text)) return false;
			return true;
		});
	}

	private makeDropTarget(el: HTMLElement, date: DateKey): void {
		el.addEventListener("dragover", (e) => {
			if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			el.addClass("is-drop-target");
		});

		el.addEventListener("dragleave", () => el.removeClass("is-drop-target"));

		el.addEventListener("drop", async (e) => {
			el.removeClass("is-drop-target");
			const raw = e.dataTransfer?.getData(DRAG_MIME);
			if (!raw) return;
			e.preventDefault();
			e.stopPropagation();

			let payload: DragPayload;
			try {
				payload = JSON.parse(raw);
			} catch {
				return;
			}
			if (payload.date === date) return;

			const task = this.plugin.store.getTask(`${payload.path}:${payload.line}`);
			if (!task) {
				new Notice("That task moved in its note — refreshing.");
				this.plugin.store.scheduleRebuild(0);
				return;
			}

			await this.plugin.store.reschedule(
				{ task, date: payload.date, virtual: payload.virtual },
				date,
			);
			this.render();
		});
	}

	/** Replaces a cell's footer with a text input for fast task capture. */
	private startInlineAdd(container: HTMLElement, date: DateKey): void {
		if (container.querySelector(".ct-inline-add")) return;

		const input = container.createEl("input", {
			cls: "ct-inline-add",
			attr: { type: "text", placeholder: "Task… (#tags work)" },
		});
		input.focus();

		// Enter commits and then blurs, and Escape blurs too — without this
		// latch the blur handler would fire a second (or cancelled) create.
		let settled = false;

		const commit = async () => {
			if (settled) return;
			settled = true;

			const title = input.value.trim();
			input.remove();
			if (!title) return;

			await this.plugin.store.createTask({
				title,
				due: date,
				createdDate: todayKey(),
				tags: [],
			});
			this.render();
		};

		const cancel = () => {
			if (settled) return;
			settled = true;
			input.remove();
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); void commit(); }
			if (e.key === "Escape") { e.preventDefault(); cancel(); }
		});
		input.addEventListener("blur", () => void commit());
		input.addEventListener("click", (e) => e.stopPropagation());
	}

	private showDayMenu(e: MouseEvent, date: DateKey): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle("New task here").setIcon("check-square").onClick(() =>
				new TaskModal(this.app, this.plugin.store, {
					defaultDate: date,
					onSubmit: () => this.render(),
				}).open(),
			),
		);
		menu.addItem((i) =>
			i.setTitle("New event here").setIcon("calendar-plus").onClick(() =>
				new EventModal(this.app, this.plugin.store, {
					defaultDate: date,
					onSubmit: () => this.render(),
				}).open(),
			),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Open day view").setIcon("calendar").onClick(() => {
				this.cursor = fromKey(date);
				this.setMode("day");
			}),
		);
		menu.showAtMouseEvent(e);
	}
}
