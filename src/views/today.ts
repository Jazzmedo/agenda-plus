import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { formatShort, today, todayKey } from "../dates";
import { TaskModal } from "../modals";
import { formatDuration } from "../parser";
import { applyPriorityColors, renderEventBar, renderRow, type RenderCtx } from "../render";
import type AgendaPlusPlugin from "../main";
import type { TaskItem, TaskOccurrence } from "../types";

export const VIEW_TODAY = "agenda-plus-today";

export class TodayView extends ItemView {
	private unsubscribe?: () => void;
	private showBacklog = false;

	constructor(leaf: WorkspaceLeaf, private plugin: AgendaPlusPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TODAY; }
	getDisplayText(): string { return "Today"; }
	getIcon(): string { return "check-circle"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-today-view");
		applyPriorityColors(this.contentEl, this.plugin.store);
		this.unsubscribe = this.plugin.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
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

		const now = today();
		const key = todayKey();
		const [day] = this.plugin.store.buildDays(now, now);
		const overdue = this.plugin.store.settings().rolloverOverdue
			? this.plugin.store.overdue()
			: [];

		this.renderHeader(this.contentEl, key, day.occurrences, overdue);

		if (day.events.length) {
			const section = this.section(this.contentEl, "Today's events", day.events.length);
			for (const event of day.events) renderEventBar(section, event, key, this.ctx);
		}

		if (overdue.length) {
			const section = this.section(this.contentEl, "Overdue", overdue.length, "is-overdue-section");
			overdue.forEach((occ) => renderRow(section, occ, this.ctx, { showDate: true, showSource: true }));
		}

		const open = day.occurrences.filter((o) => !o.task.done);
		const done = day.occurrences.filter((o) => o.task.done);

		const openSection = this.section(this.contentEl, "To do", open.length);
		if (!open.length) {
			openSection.createDiv({
				cls: "ct-empty",
				text: done.length ? "All done for today. 🎉" : "Nothing scheduled for today.",
			});
		}
		open.forEach((occ) => renderRow(openSection, occ, this.ctx, { showSource: true }));

		const quick = openSection.createDiv({ cls: "ct-quick-add" });
		const input = quick.createEl("input", {
			cls: "ct-inline-add",
			attr: { type: "text", placeholder: "Add a task for today… (#tags work)" },
		});
		input.addEventListener("keydown", async (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const title = input.value.trim();
			if (!title) return;
			input.value = "";
			await this.plugin.store.createTask({ title, due: key, createdDate: key, tags: [] });
			this.render();
		});

		if (done.length) {
			const doneSection = this.section(this.contentEl, "Completed today", done.length, "is-done-section");
			done.forEach((occ) => renderRow(doneSection, occ, this.ctx, { showSource: true }));
		}

		this.renderBacklog(this.contentEl);

		this.contentEl.scrollTop = scrollTop;
	}

	private renderHeader(
		parent: HTMLElement,
		key: string,
		occurrences: TaskOccurrence[],
		overdue: TaskOccurrence[],
	): void {
		const header = parent.createDiv({ cls: "ct-today-header" });

		const left = header.createDiv({ cls: "ct-today-heading" });
		left.createDiv({ cls: "ct-today-date", text: formatShort(today(), this.plugin.settings.dateFormat) });
		left.createDiv({
			cls: "ct-today-sub",
			text: overdue.length ? `${overdue.length} overdue` : "Nothing overdue",
		});

		const total = occurrences.length;
		const done = occurrences.filter((o) => o.task.done).length;
		const pct = total ? Math.round((done / total) * 100) : 0;

		const ring = header.createDiv({ cls: "ct-ring" });
		ring.style.setProperty("--ct-ring-pct", String(pct));
		ring.createDiv({ cls: "ct-ring-label", text: `${pct}%` });

		const stats = header.createDiv({ cls: "ct-today-stats" });
		stats.createDiv({ cls: "ct-stat-mini" }).setText(`${done} done`);
		stats.createDiv({ cls: "ct-stat-mini" }).setText(`${total - done} left`);

		// Only tasks that carry a duration contribute, so this reads as
		// "time you've actually budgeted", not an estimate of everything.
		const planned = occurrences
			.filter((o) => !o.task.done && o.task.duration)
			.reduce((sum, o) => sum + (o.task.duration ?? 0), 0);

		if (planned > 0) {
			stats.createDiv({ cls: "ct-stat-mini is-planned" }).setText(`${formatDuration(planned)} planned`);
		}
	}

	private renderBacklog(parent: HTMLElement): void {
		const backlog = this.plugin.store.unscheduled();
		if (!backlog.length) return;

		const wrap = parent.createDiv({ cls: "ct-section" });
		const title = wrap.createDiv({ cls: "ct-section-title is-clickable" });
		const chevron = title.createSpan({ cls: "ct-chevron" });
		setIcon(chevron, this.showBacklog ? "chevron-down" : "chevron-right");
		title.createSpan({ text: `Backlog — no date (${backlog.length})` });

		title.addEventListener("click", () => {
			this.showBacklog = !this.showBacklog;
			this.render();
		});

		if (!this.showBacklog) return;

		for (const task of backlog.slice(0, 100)) {
			const occ: TaskOccurrence = { task, date: todayKey(), virtual: false };
			const row = renderRow(wrap, occ, this.ctx, { showSource: true });
			const schedule = row.createDiv({
				cls: "ct-row-action",
				attr: { "aria-label": "Schedule for today" },
			});
			setIcon(schedule, "calendar-plus");
			schedule.addEventListener("click", async (e) => {
				e.stopPropagation();
				await this.plugin.store.updateTask(task, { due: todayKey() });
				this.render();
			});
		}
	}

	private section(parent: HTMLElement, title: string, count: number, cls = ""): HTMLElement {
		const wrap = parent.createDiv({ cls: `ct-section ${cls}`.trim() });
		const head = wrap.createDiv({ cls: "ct-section-title" });
		head.createSpan({ text: title });
		head.createSpan({ cls: "ct-section-count", text: String(count) });
		return wrap;
	}
}

/** Exported for the status-bar summary in main.ts. */
export function summarise(tasks: TaskItem[]): { done: number; open: number } {
	let done = 0;
	let open = 0;
	for (const t of tasks) {
		if (t.cancelled) continue;
		if (t.done) done++;
		else open++;
	}
	return { done, open };
}
