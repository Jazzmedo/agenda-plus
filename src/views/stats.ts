import { applyPriorityColors } from "../render";
import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import {
	addDays, daysBetween, eachDay, fromKey, relativeLabel, startOfWeek, toKey, today, todayKey,
	weekdayName, type DateKey,
} from "../dates";
import { anchorDate } from "../parser";
import type AgendaPlusPlugin from "../main";
import { PRIORITIES, PRIORITY_LABEL, type Priority, type TaskItem } from "../types";

export const VIEW_STATS = "agenda-plus-stats";

const RANGES = [
	{ days: 7, label: "7 days" },
	{ days: 30, label: "30 days" },
	{ days: 90, label: "90 days" },
	{ days: 365, label: "1 year" },
];

export class StatsView extends ItemView {
	private rangeDays = 30;
	private unsubscribe?: () => void;

	constructor(leaf: WorkspaceLeaf, private plugin: AgendaPlusPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_STATS; }
	getDisplayText(): string { return "Task stats"; }
	getIcon(): string { return "bar-chart-3"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ct-view", "ct-stats-view");
		applyPriorityColors(this.contentEl, this.plugin.store);
		this.unsubscribe = this.plugin.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	render(): void {
		const scrollTop = this.contentEl.scrollTop;
		this.contentEl.empty();

		const tasks = this.plugin.store.allTasks().filter((t) => !t.cancelled);
		const end = today();
		const start = addDays(end, -(this.rangeDays - 1));

		this.renderHeader(this.contentEl);
		this.renderKpis(this.contentEl, tasks, start, end);
		this.renderTrend(this.contentEl, tasks, start, end);
		this.renderHeatmap(this.contentEl, tasks);
		this.renderByTag(this.contentEl, tasks, start);
		this.renderByPriority(this.contentEl, tasks);
		this.renderCountdowns(this.contentEl);

		this.contentEl.scrollTop = scrollTop;
	}

	private renderHeader(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "ct-toolbar ct-stats-toolbar" });
		bar.createDiv({ cls: "ct-toolbar-title", text: "Statistics" });

		const modes = bar.createDiv({ cls: "ct-mode-switch" });
		for (const range of RANGES) {
			const b = modes.createEl("button", {
				cls: `ct-mode-btn${this.rangeDays === range.days ? " is-active" : ""}`,
				text: range.label,
			});
			b.addEventListener("click", () => { this.rangeDays = range.days; this.render(); });
		}
	}

	// ── KPI tiles ─────────────────────────────────────────────────────────

	private renderKpis(parent: HTMLElement, tasks: TaskItem[], start: Date, end: Date): void {
		const startKey = toKey(start);
		const endKey = toKey(end);

		const completed = tasks.filter(
			(t) => t.done && t.doneDate && t.doneDate >= startKey && t.doneDate <= endKey,
		).length;

		const open = tasks.filter((t) => !t.done).length;
		const overdue = this.plugin.store.overdue().length;

		// Rate over work that was actually due in the window: completed vs
		// completed + still-open-and-due. Undated backlog is excluded so the
		// number reflects scheduled commitments, not the whole vault.
		const dueOpen = tasks.filter((t) => {
			if (t.done) return false;
			const d = anchorDate(t);
			return !!d && d >= startKey && d <= endKey;
		}).length;
		const rate = completed + dueOpen > 0 ? Math.round((completed / (completed + dueOpen)) * 100) : 0;

		const grid = parent.createDiv({ cls: "ct-kpi-grid" });

		const tile = (label: string, value: string, sub: string, cls = "") => {
			const t = grid.createDiv({ cls: `ct-kpi ${cls}`.trim() });
			t.createDiv({ cls: "ct-kpi-value", text: value });
			t.createDiv({ cls: "ct-kpi-label", text: label });
			t.createDiv({ cls: "ct-kpi-sub", text: sub });
		};

		tile("Completed", String(completed), `in the last ${this.rangeDays} days`, "is-good");
		tile("Still open", String(open), "across the vault");
		tile("Overdue", String(overdue), overdue ? "needs attention" : "all clear", overdue ? "is-bad" : "");
		tile("Completion rate", `${rate}%`, "of work due in range");
		tile("Current streak", `${this.streak(tasks)}`, "consecutive days");
	}

	/** Consecutive days up to today with at least one completion. */
	private streak(tasks: TaskItem[]): number {
		const done = new Set(tasks.filter((t) => t.done && t.doneDate).map((t) => t.doneDate!));
		let count = 0;
		let cursor = today();
		// Today not being finished yet shouldn't break yesterday's streak.
		if (!done.has(toKey(cursor))) cursor = addDays(cursor, -1);
		while (done.has(toKey(cursor))) {
			count++;
			cursor = addDays(cursor, -1);
		}
		return count;
	}

	// ── Daily trend ───────────────────────────────────────────────────────

	private renderTrend(parent: HTMLElement, tasks: TaskItem[], start: Date, end: Date): void {
		const section = this.section(parent, "Completed per day");

		const counts = new Map<DateKey, number>();
		for (const t of tasks) {
			if (!t.done || !t.doneDate) continue;
			counts.set(t.doneDate, (counts.get(t.doneDate) ?? 0) + 1);
		}

		const days = eachDay(start, end);
		const max = Math.max(1, ...days.map((d) => counts.get(toKey(d)) ?? 0));

		const chart = section.createDiv({ cls: "ct-bars" });
		// Long ranges get thin bars and no labels; short ranges get both.
		const showLabels = days.length <= 31;

		for (const d of days) {
			const key = toKey(d);
			const value = counts.get(key) ?? 0;
			const col = chart.createDiv({ cls: "ct-bar-col", attr: { "aria-label": `${key}: ${value}` } });
			const bar = col.createDiv({ cls: `ct-bar${value ? "" : " is-empty"}` });
			bar.style.height = `${Math.max(2, (value / max) * 100)}%`;
			if (key === todayKey()) bar.addClass("is-today");
			if (showLabels) col.createDiv({ cls: "ct-bar-label", text: String(d.getDate()) });
		}

		const total = days.reduce((sum, d) => sum + (counts.get(toKey(d)) ?? 0), 0);
		section.createDiv({
			cls: "ct-chart-caption",
			text: `${total} completed · peak ${max} in a day · avg ${(total / days.length).toFixed(1)}/day`,
		});
	}

	// ── Heatmap ───────────────────────────────────────────────────────────

	private renderHeatmap(parent: HTMLElement, tasks: TaskItem[]): void {
		const section = this.section(parent, "Consistency — last 12 weeks");

		const counts = new Map<DateKey, number>();
		for (const t of tasks) {
			if (!t.done || !t.doneDate) continue;
			counts.set(t.doneDate, (counts.get(t.doneDate) ?? 0) + 1);
		}

		const first = this.plugin.settings.firstDayOfWeek;
		const end = today();
		const start = startOfWeek(addDays(end, -83), first);

		const wrap = section.createDiv({ cls: "ct-heatmap-wrap" });

		const labels = wrap.createDiv({ cls: "ct-heatmap-labels" });
		for (let i = 0; i < 7; i++) {
			labels.createDiv({
				cls: "ct-heatmap-label",
				text: i % 2 === 1 ? weekdayName((first + i) % 7, true) : "",
			});
		}

		const grid = wrap.createDiv({ cls: "ct-heatmap" });
		const max = Math.max(1, ...[...counts.values()]);

		for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
			const key = toKey(d);
			const value = counts.get(key) ?? 0;
			// 0–4 intensity buckets, mirroring the familiar contribution grid.
			const level = value === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
			const cell = grid.createDiv({
				cls: `ct-heat ct-heat-${level}`,
				attr: { "aria-label": `${key}: ${value} completed` },
			});
			if (key === todayKey()) cell.addClass("is-today");
		}
	}

	// ── Breakdowns ────────────────────────────────────────────────────────

	private renderByTag(parent: HTMLElement, tasks: TaskItem[], start: Date): void {
		const startKey = toKey(start);
		const stats = new Map<string, { done: number; open: number }>();

		for (const t of tasks) {
			const counted = t.done ? t.doneDate && t.doneDate >= startKey : true;
			if (!counted) continue;
			for (const tag of t.tags) {
				if (!stats.has(tag)) stats.set(tag, { done: 0, open: 0 });
				const entry = stats.get(tag)!;
				if (t.done) entry.done++;
				else entry.open++;
			}
		}

		const rows = [...stats.entries()]
			.map(([tag, v]) => ({ tag, ...v, total: v.done + v.open }))
			.sort((a, b) => b.total - a.total)
			.slice(0, 12);

		const section = this.section(parent, "By tag");
		if (!rows.length) {
			section.createDiv({ cls: "ct-empty", text: "No tagged tasks yet. Add #tags to prioritise and group." });
			return;
		}

		const max = Math.max(...rows.map((r) => r.total));

		const tagColors = this.plugin.settings.tagColors;

		for (const row of rows) {
			const line = section.createDiv({ cls: "ct-breakdown-row" });
			const label = line.createDiv({ cls: "ct-breakdown-label" });
			if (tagColors[row.tag]) {
				const dot = label.createSpan({ cls: "ct-tagcolor-swatch is-inline" });
				dot.style.background = tagColors[row.tag];
			}
			label.createSpan({ text: row.tag });

			const track = line.createDiv({ cls: "ct-breakdown-track" });
			const done = track.createDiv({ cls: "ct-breakdown-done" });
			done.style.width = `${(row.done / max) * 100}%`;
			const open = track.createDiv({ cls: "ct-breakdown-open" });
			open.style.width = `${(row.open / max) * 100}%`;

			line.createDiv({
				cls: "ct-breakdown-value",
				text: `${row.done}/${row.total}`,
			});
		}

		const legend = section.createDiv({ cls: "ct-legend" });
		legend.createSpan({ cls: "ct-legend-swatch is-done" });
		legend.createSpan({ text: "completed" });
		legend.createSpan({ cls: "ct-legend-swatch is-open" });
		legend.createSpan({ text: "open" });
	}

	private renderByPriority(parent: HTMLElement, tasks: TaskItem[]): void {
		const section = this.section(parent, "Open work by priority");
		const open = tasks.filter((t) => !t.done);
		const counts = new Map<Priority, number>();
		for (const t of open) counts.set(t.priority, (counts.get(t.priority) ?? 0) + 1);

		const max = Math.max(1, ...counts.values());
		let any = false;

		for (const p of PRIORITIES) {
			const value = counts.get(p) ?? 0;
			if (!value) continue;
			any = true;
			const line = section.createDiv({ cls: "ct-breakdown-row" });
			line.createDiv({ cls: "ct-breakdown-label", text: PRIORITY_LABEL[p] });
			const track = line.createDiv({ cls: "ct-breakdown-track" });
			const fill = track.createDiv({ cls: `ct-breakdown-open ct-pri-${p}` });
			fill.style.width = `${(value / max) * 100}%`;
			line.createDiv({ cls: "ct-breakdown-value", text: String(value) });
		}

		if (!any) section.createDiv({ cls: "ct-empty", text: "No open tasks." });
	}

	private renderCountdowns(parent: HTMLElement): void {
		const events = this.plugin.store
			.getEvents()
			.filter((e) => e.end >= todayKey())
			.slice(0, 8);

		const section = this.section(parent, "Upcoming events");
		if (!events.length) {
			section.createDiv({ cls: "ct-empty", text: "No upcoming events. Create one from the calendar's + menu." });
			return;
		}

		for (const event of events) {
			const days = daysBetween(today(), fromKey(event.start));
			const row = section.createDiv({ cls: "ct-countdown-row" });
			if (event.color) row.style.setProperty("--ct-event-color", event.color);
			row.createDiv({ cls: "ct-countdown-dot" });
			row.createDiv({ cls: "ct-countdown-title", text: event.title });
			row.createDiv({ cls: "ct-countdown-when", text: relativeLabel(event.start) });
			row.createDiv({
				cls: "ct-countdown-days",
				text: days > 0 ? `${days}d` : days === 0 ? "today" : "ongoing",
			});
			row.addEventListener("click", () => {
				const file = this.app.vault.getAbstractFileByPath(event.path);
				if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
			});
		}
	}

	private section(parent: HTMLElement, title: string): HTMLElement {
		const wrap = parent.createDiv({ cls: "ct-section" });
		wrap.createDiv({ cls: "ct-section-title", text: title });
		return wrap;
	}
}
