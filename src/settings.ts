import { App, PluginSettingTab, Setting } from "obsidian";
import { DATE_FORMATS, WEEKEND_PRESETS, weekdayName, type DateFormat } from "./dates";
import type AgendaPlusPlugin from "./main";
import { findOrphanedTags, normaliseTag } from "./tags";
import { PRIORITIES, PRIORITY_FALLBACK, PRIORITY_LABEL, type Priority } from "./types";

export interface AgendaPlusSettings {
	/** Root folder holding everything this plugin owns. */
	calendarFolder: string;
	/** Heading inside the inbox note to append under; empty = end of file. */
	inboxHeading: string;
	/** When true, only notes inside the calendar folder are indexed at all. */
	restrictToCalendarFolder: boolean;
	/** Folders excluded from task indexing (one per line, prefix match). */
	ignoredFolders: string[];
	firstDayOfWeek: number;
	/** Days shaded as the weekend, 0 = Sunday. Independent of the week start. */
	weekendDays: number[];
	/** How dates are displayed and read back. Storage stays ISO regardless. */
	dateFormat: DateFormat;
	/** Max task chips rendered per month-view day cell before "+N more". */
	maxChipsPerDay: number;
	/** Tag -> priority overrides, e.g. "#urgent": "highest". */
	tagPriorities: Record<string, Priority>;
	/** Colour per tag for chips, e.g. "#study": "#89b4fa". */
	tagColors: Record<string, string>;
	/** Colour per priority. Absent entries fall back to the theme default. */
	priorityColors: Partial<Record<Priority, string>>;
	/** Show tasks whose due date has passed on today's list. */
	rolloverOverdue: boolean;
	/** How far ahead recurring tasks are projected, in days. */
	projectionDays: number;
	/** Write ✅ completion dates when checking a task off. */
	trackCompletionDates: boolean;
	/** Open the calendar automatically on startup. */
	openOnStartup: boolean;
}

export const DEFAULT_SETTINGS: AgendaPlusSettings = {
	calendarFolder: "Calendar",
	inboxHeading: "Inbox",
	restrictToCalendarFolder: true,
	ignoredFolders: ["attachments", "Excalidraw", ".trash"],
	firstDayOfWeek: 0,
	weekendDays: [6, 0],
	dateFormat: "YYYY-MM-DD",
	maxChipsPerDay: 4,
	tagPriorities: {
		"#urgent": "highest",
		"#important": "high",
		"#someday": "low",
	},
	tagColors: {},
	priorityColors: {},
	rolloverOverdue: true,
	projectionDays: 400,
	trackCompletionDates: true,
	openOnStartup: false,
};

/** Everything the plugin owns lives under the calendar folder. */
export function eventFolderPath(s: AgendaPlusSettings): string {
	return `${s.calendarFolder}/Events`;
}

export function inboxNotePath(s: AgendaPlusSettings): string {
	return `${s.calendarFolder}/Tasks.md`;
}

/** Carries older configs (separate inbox/event paths) onto `calendarFolder`. */
export function migrateSettings(raw: Record<string, unknown> | null): Partial<AgendaPlusSettings> {
	if (!raw) return {};
	const out = { ...raw } as Record<string, unknown>;

	if (!out.calendarFolder) {
		const legacyEvents = typeof out.eventFolder === "string" ? out.eventFolder : "";
		// "Events" -> vault root wasn't a folder we owned; fall back to the default.
		const parent = legacyEvents.includes("/") ? legacyEvents.split("/").slice(0, -1).join("/") : "";
		if (parent) out.calendarFolder = parent;
	}

	delete out.eventFolder;
	delete out.inboxNote;
	return out as Partial<AgendaPlusSettings>;
}

export class AgendaPlusSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AgendaPlusPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Storage").setHeading();

		const folderSetting = new Setting(containerEl)
			.setName("Calendar folder")
			.setDesc("Everything this plugin creates lives here.")
			.addText((t) =>
				t
					.setPlaceholder("Calendar")
					.setValue(this.plugin.settings.calendarFolder)
					.onChange(async (v) => {
						this.plugin.settings.calendarFolder = v.trim().replace(/^\/+|\/+$/g, "") || "Calendar";
						await this.plugin.saveSettings();
						describeFolder();
						void this.plugin.store.rebuild();
					}),
			);

		const paths = containerEl.createEl("p", { cls: "ct-settings-hint" });
		const describeFolder = () => {
			paths.empty();
			paths.createEl("code", { text: inboxNotePath(this.plugin.settings) });
			paths.createSpan({ text: " — tasks you add from the calendar. " });
			paths.createEl("code", { text: `${eventFolderPath(this.plugin.settings)}/` });
			paths.createSpan({ text: " — one note per event." });
		};
		describeFolder();
		folderSetting.settingEl.addClass("ct-folder-setting");

		new Setting(containerEl)
			.setName("Append under heading")
			.setDesc("Optional heading inside the inbox note to append beneath, e.g. \"Inbox\". Leave empty to append at the end of the file.")
			.addText((t) =>
				t
					.setPlaceholder("(end of file)")
					.setValue(this.plugin.settings.inboxHeading)
					.onChange(async (v) => {
						this.plugin.settings.inboxHeading = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Only index the calendar folder")
			.setDesc("When on, tasks anywhere else in the vault are ignored completely. Turn off to index the whole vault.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.restrictToCalendarFolder).onChange(async (v) => {
					this.plugin.settings.restrictToCalendarFolder = v;
					await this.plugin.saveSettings();
					await this.plugin.store.rebuild();
				}),
			);

		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc("One path prefix per line. Tasks inside these folders are not indexed, even inside the calendar folder.")
			.addTextArea((t) => {
				t.setValue(this.plugin.settings.ignoredFolders.join("\n")).onChange(async (v) => {
					this.plugin.settings.ignoredFolders = v
						.split("\n")
						.map((s) => s.trim().replace(/\/+$/, ""))
						.filter(Boolean);
					await this.plugin.saveSettings();
					this.plugin.store.rebuild();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("First day of week")
			.addDropdown((d) => {
				["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach(
					(name, i) => d.addOption(String(i), name),
				);
				d.setValue(String(this.plugin.settings.firstDayOfWeek)).onChange(async (v) => {
					this.plugin.settings.firstDayOfWeek = Number(v);
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					// The weekend toggles below are ordered by this setting.
					this.display();
				});
			});

		this.renderWeekendDays(containerEl);

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("How dates are shown and typed throughout the plugin. Your notes always store the ISO form, so this is safe to change at any time.")
			.addDropdown((d) => {
				DATE_FORMATS.forEach((f) => d.addOption(f.value, f.label));
				d.setValue(this.plugin.settings.dateFormat).onChange(async (v) => {
					this.plugin.settings.dateFormat = v as DateFormat;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});

		new Setting(containerEl)
			.setName("Tasks shown per day (month view)")
			.setDesc("Extra tasks collapse into a \"+N more\" row.")
			.addSlider((s) =>
				s
					.setLimits(2, 12, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.maxChipsPerDay)
					.onChange(async (v) => {
						this.plugin.settings.maxChipsPerDay = v;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Roll over overdue tasks")
			.setDesc("Show unfinished tasks from past days at the top of the Today list.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.rolloverOverdue).onChange(async (v) => {
					this.plugin.settings.rolloverOverdue = v;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				}),
			);

		new Setting(containerEl)
			.setName("Open calendar on startup")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.openOnStartup).onChange(async (v) => {
					this.plugin.settings.openOnStartup = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Behaviour").setHeading();

		new Setting(containerEl)
			.setName("Track completion dates")
			.setDesc("Append ✅ YYYY-MM-DD when a task is checked off. Required for completion statistics over time.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.trackCompletionDates).onChange(async (v) => {
					this.plugin.settings.trackCompletionDates = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Project recurring tasks ahead")
			.setDesc("How many days into the future repeating tasks are generated for the calendar.")
			.addSlider((s) =>
				s
					.setLimits(30, 730, 10)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.projectionDays)
					.onChange(async (v) => {
						this.plugin.settings.projectionDays = v;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		this.renderPriorityColors(containerEl);
		this.renderTags(containerEl);
	}

	/**
	 * Colour per priority.
	 *
	 * Priority is shown as colour rather than an emoji badge, so these are
	 * the only thing distinguishing levels at a glance — worth making them
	 * match whatever theme the user runs.
	 */
	private renderPriorityColors(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Priority colours").setHeading();

		containerEl.createEl("p", {
			cls: "ct-settings-hint",
			text: "Tasks are tinted by priority. A tag colour, where one is set, takes precedence on the chip itself.",
		});

		for (const priority of PRIORITIES) {
			const configured = this.plugin.settings.priorityColors[priority];

			const setting = new Setting(containerEl)
				.setName(PRIORITY_LABEL[priority])
				.setDesc(configured ? configured : "theme default");

			const swatch = setting.nameEl.createSpan({ cls: "ct-tagcolor-swatch" });
			swatch.addClass(`ct-pri-${priority}`);
			if (configured) swatch.style.background = configured;
			else swatch.addClass("is-priority-default");

			setting.addColorPicker((cp) =>
				cp.setValue(configured ?? PRIORITY_FALLBACK[priority]).onChange(async (v) => {
					this.plugin.settings.priorityColors[priority] = v;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					swatch.removeClass("is-priority-default");
					swatch.style.background = v;
					setting.setDesc(v);
				}),
			);

			setting.addExtraButton((b) =>
				b.setIcon("rotate-ccw").setTooltip("Back to the theme default").onClick(async () => {
					delete this.plugin.settings.priorityColors[priority];
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					this.display();
				}),
			);
		}
	}

	/**
	 * Weekend days, as toggles plus regional shortcuts.
	 *
	 * Kept separate from the week-start setting on purpose: an Egyptian
	 * week starts on Saturday and rests Friday–Saturday, so neither
	 * setting can be derived from the other.
	 */
	private renderWeekendDays(containerEl: HTMLElement): void {
		const setting = new Setting(containerEl)
			.setName("Weekend days")
			.setDesc("Shaded in the month and week views. Separate from which day the week starts on.");
		setting.settingEl.addClass("ct-weekend-setting");

		const wrap = setting.controlEl.createDiv({ cls: "ct-weekend-picker" });

		const draw = () => {
			wrap.empty();
			const selected = new Set(this.plugin.settings.weekendDays);

			const days = wrap.createDiv({ cls: "ct-recur-days" });
			for (let i = 0; i < 7; i++) {
				const day = (this.plugin.settings.firstDayOfWeek + i) % 7;
				const btn = days.createEl("button", {
					cls: `ct-day-toggle${selected.has(day) ? " is-active" : ""}`,
					text: weekdayName(day, true).slice(0, 2),
					attr: { type: "button", "aria-label": weekdayName(day) },
				});
				btn.addEventListener("click", async () => {
					if (selected.has(day)) selected.delete(day);
					else selected.add(day);
					await commit([...selected]);
				});
			}

			const presets = wrap.createDiv({ cls: "ct-field-presets" });
			for (const p of WEEKEND_PRESETS) {
				const b = presets.createEl("button", {
					cls: "ct-mini-btn",
					text: p.label,
					attr: { type: "button" },
				});
				b.addEventListener("click", () => void commit(p.days));
			}
		};

		const commit = async (days: number[]) => {
			this.plugin.settings.weekendDays = [...new Set(days)].sort((a, b) => a - b);
			await this.plugin.saveSettings();
			this.plugin.refreshViews();
			draw();
		};

		draw();
	}

	/**
	 * One row per tag, carrying both its colour and its priority override.
	 *
	 * The list mirrors what's actually in your notes. A tag whose last task
	 * is deleted drops out of the main list immediately; if it still had
	 * settings attached those move to "Unused" so they can be removed rather
	 * than lingering invisibly in data.json.
	 */
	private renderTags(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Tags").setHeading();

		containerEl.createEl("p", {
			cls: "ct-settings-hint",
			text: "Every tag in your vault. Set a colour for its chips and pills, and a priority that any task carrying the tag inherits automatically.",
		});

		const section = containerEl.createDiv();
		let filter = "";

		const toolbar = section.createDiv({ cls: "ct-tag-toolbar" });

		const search = toolbar.createEl("input", {
			cls: "ct-tag-search",
			attr: { type: "search", placeholder: "Filter tags…" },
		});
		search.addEventListener("input", () => {
			filter = search.value.trim().toLowerCase();
			redraw();
		});

		const rescan = toolbar.createEl("button", { cls: "ct-btn", text: "Rescan" });
		rescan.setAttribute("aria-label", "Rescan the vault for tags");
		rescan.addEventListener("click", async () => {
			await this.plugin.store.rebuild();
			redraw();
		});

		const list = section.createDiv({ cls: "ct-tagcolor-list" });
		const unusedWrap = section.createDiv();

		const redraw = () => {
			list.empty();
			unusedWrap.empty();

			const discovered = this.plugin.store.knownTags();
			const known = new Set(discovered.map((d) => d.tag));

			const visible = discovered.filter((d) => !filter || d.tag.toLowerCase().includes(filter));

			if (!discovered.length) {
				list.createEl("p", {
					cls: "ct-settings-hint",
					text: "No tags found in this vault yet. Add a #tag to any note, then hit rescan.",
				});
			} else if (!visible.length) {
				list.createEl("p", { cls: "ct-settings-hint", text: `No tag matches "${filter}".` });
			}

			for (const { tag, count } of visible) {
				const desc = count
					? `${count} task${count === 1 ? "" : "s"}`
					: "in your vault, not on a task yet";
				this.renderTagRow(list, tag, desc, false, redraw);
			}

			// Settings left behind by tags that no longer exist in any note.
			const orphans = findOrphanedTags(
				this.plugin.settings.tagColors,
				this.plugin.settings.tagPriorities,
				[...known],
			);

			if (!orphans.length) return;

			new Setting(unusedWrap)
				.setName(`Unused (${orphans.length})`)
				.setDesc("These tags aren't anywhere in your vault any more. Their settings are kept only so you can remove them.")
				.addButton((b) =>
					b.setButtonText("Remove all").setWarning().onClick(async () => {
						for (const tag of orphans) {
							delete this.plugin.settings.tagColors[tag];
							delete this.plugin.settings.tagPriorities[tag];
						}
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
						redraw();
					}),
				)
				.settingEl.addClass("ct-unused-header");

			for (const tag of orphans) {
				this.renderTagRow(unusedWrap, tag, "not found in this vault", true, redraw);
			}
		};

		redraw();

		// Lets you configure a tag before any task uses it.
		let pending = "";
		new Setting(containerEl)
			.setName("Add a tag")
			.setDesc("Configure a tag ahead of using it in a note.")
			.addText((t) => t.setPlaceholder("#urgent").onChange((v) => (pending = v.trim())))
			.addButton((b) =>
				b.setButtonText("Add").setCta().onClick(async () => {
					if (!pending) return;
					const tag = normaliseTag(pending);
					// Seed a colour so the tag has something to show up with.
					this.plugin.settings.tagColors[tag] = this.plugin.settings.tagColors[tag] ?? "#89b4fa";
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					this.display();
				}),
			);
	}

	/** A single tag row: swatch, colour picker, priority, and remove. */
	private renderTagRow(
		parent: HTMLElement,
		tag: string,
		desc: string,
		orphaned: boolean,
		redraw: () => void,
	): void {
		const colour = this.plugin.settings.tagColors[tag];
		const priority = this.plugin.settings.tagPriorities[tag] ?? "none";

		const setting = new Setting(parent).setName(tag).setDesc(desc);
		if (orphaned) setting.settingEl.addClass("is-unused");

		const swatch = setting.nameEl.createSpan({ cls: "ct-tagcolor-swatch" });
		if (colour) swatch.style.background = colour;
		else swatch.addClass("is-unset");

		setting.addColorPicker((cp) =>
			cp.setValue(colour ?? "#89b4fa").onChange(async (v) => {
				this.plugin.settings.tagColors[tag] = v;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
				swatch.removeClass("is-unset");
				swatch.style.background = v;
			}),
		);

		setting.addDropdown((d) => {
			PRIORITIES.forEach((p) => d.addOption(p, p === "none" ? "No override" : PRIORITY_LABEL[p]));
			d.setValue(priority).onChange(async (v) => {
				// "none" means no override at all, so drop the entry entirely.
				if (v === "none") delete this.plugin.settings.tagPriorities[tag];
				else this.plugin.settings.tagPriorities[tag] = v as Priority;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			});
		});

		// Always present, on every row — including rows with nothing set yet.
		setting.addExtraButton((b) =>
			b
				.setIcon(orphaned ? "trash-2" : "rotate-ccw")
				.setTooltip(orphaned ? "Remove this tag's settings" : "Reset colour and priority")
				.onClick(async () => {
					delete this.plugin.settings.tagColors[tag];
					delete this.plugin.settings.tagPriorities[tag];
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					redraw();
				}),
		);
	}
}
