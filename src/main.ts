import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { todayKey } from "./dates";
import { EventModal, TaskModal } from "./modals";
import { anchorDate } from "./parser";
import {
	AgendaPlusSettingTab, DEFAULT_SETTINGS, eventFolderPath, migrateSettings,
	type AgendaPlusSettings,
} from "./settings";
import { TaskStore } from "./store";
import { CalendarView, VIEW_CALENDAR } from "./views/calendar";
import { StatsView, VIEW_STATS } from "./views/stats";
import { TodayView, VIEW_TODAY } from "./views/today";

export default class AgendaPlusPlugin extends Plugin {
	settings!: AgendaPlusSettings;
	store!: TaskStore;
	private statusBar?: HTMLElement;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new TaskStore(this.app, () => this.settings);

		this.registerView(VIEW_CALENDAR, (leaf) => new CalendarView(leaf, this));
		this.registerView(VIEW_TODAY, (leaf) => new TodayView(leaf, this));
		this.registerView(VIEW_STATS, (leaf) => new StatsView(leaf, this));

		this.addSettingTab(new AgendaPlusSettingTab(this.app, this));

		this.addRibbonIcon("calendar-days", "AgendaPlus", () => void this.activateView(VIEW_CALENDAR));
		this.addRibbonIcon("check-circle", "Today's tasks", () => void this.activateView(VIEW_TODAY, "right"));

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass("ct-status");
		this.register(this.store.onChange(() => this.updateStatusBar()));

		this.registerCommands();
		this.registerVaultEvents();

		// The metadata cache isn't populated until layout is ready; indexing
		// before that would miss event frontmatter.
		this.app.workspace.onLayoutReady(async () => {
			await this.store.rebuild();
			this.updateStatusBar();
			if (this.settings.openOnStartup) await this.activateView(VIEW_CALENDAR);
		});
	}

	onunload(): void {
		// Leaves are detached by Obsidian and views clean up their own
		// listeners; only the debounced reindex needs cancelling.
		this.store.dispose();
	}

	// ── Settings ──────────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettings(await this.loadData()));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ── Views ─────────────────────────────────────────────────────────────

	async activateView(type: string, side: "main" | "right" = "main"): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(type);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf: WorkspaceLeaf | null =
			side === "right"
				? this.app.workspace.getRightLeaf(false)
				: this.app.workspace.getLeaf("tab");

		if (!leaf) return;
		await leaf.setViewState({ type, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshViews(): void {
		for (const type of [VIEW_CALENDAR, VIEW_TODAY, VIEW_STATS]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view as { render?: () => void };
				view.render?.();
			}
		}
	}

	private updateStatusBar(): void {
		if (!this.statusBar) return;
		const key = todayKey();
		const tasks = this.store.allTasks().filter((t) => !t.cancelled);

		const dueToday = tasks.filter((t) => !t.done && anchorDate(t) === key).length;
		const overdue = this.store.overdue().length;

		this.statusBar.setText(
			overdue > 0 ? `✓ ${dueToday} today · ⚠ ${overdue} overdue` : `✓ ${dueToday} today`,
		);
		this.statusBar.setAttribute(
			"aria-label",
			`${dueToday} tasks due today, ${overdue} overdue — click to open Today`,
		);
		this.statusBar.onclick = () => void this.activateView(VIEW_TODAY, "right");
	}

	// ── Commands ──────────────────────────────────────────────────────────

	private registerCommands(): void {
		this.addCommand({
			id: "open-calendar",
			name: "Open calendar",
			callback: () => void this.activateView(VIEW_CALENDAR),
		});

		this.addCommand({
			id: "open-today",
			name: "Open today's tasks",
			callback: () => void this.activateView(VIEW_TODAY, "right"),
		});

		this.addCommand({
			id: "open-stats",
			name: "Open statistics",
			callback: () => void this.activateView(VIEW_STATS),
		});

		this.addCommand({
			id: "new-task",
			name: "New task",
			callback: () =>
				new TaskModal(this.app, this.store, {
					defaultDate: todayKey(),
					onSubmit: () => this.refreshViews(),
				}).open(),
		});

		this.addCommand({
			id: "new-event",
			name: "New event",
			callback: () =>
				new EventModal(this.app, this.store, {
					defaultDate: todayKey(),
					onSubmit: () => this.refreshViews(),
				}).open(),
		});

		this.addCommand({
			id: "toggle-task",
			name: "Toggle task on current line",
			editorCallback: async (editor) => {
				const lineNo = editor.getCursor().line;
				const file = this.app.workspace.getActiveFile();
				if (!file) return;

				const task = this.store
					.allTasks()
					.find((t) => t.path === file.path && t.line === lineNo);

				if (!task) {
					new Notice("No task on this line.");
					return;
				}

				await this.store.setDone(
					{ task, date: anchorDate(task) ?? todayKey(), virtual: false },
					!task.done,
				);
				this.refreshViews();
			},
		});

		this.addCommand({
			id: "reindex",
			name: "Rebuild task index",
			callback: async () => {
				await this.store.rebuild();
				new Notice(`AgendaPlus: indexed ${this.store.allTasks().length} tasks.`);
			},
		});
	}

	// ── Vault wiring ──────────────────────────────────────────────────────

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				if (file instanceof TFile) void this.store.indexFile(file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (file instanceof TFile) void this.store.indexFile(file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => this.store.removeFile(file.path)),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				this.store.removeFile(oldPath);
				if (file instanceof TFile) void this.store.indexFile(file);
			}),
		);

		// Frontmatter changes only surface through the metadata cache.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (file.path.startsWith(`${eventFolderPath(this.settings)}/`)) this.store.scheduleRebuild(200);
			}),
		);
	}
}
