import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { addDays, todayKey, toKey, type DateFormat, type DateKey } from "./dates";
import { DateField } from "./ui";
import { splitEmoji, withEmoji } from "./emoji";
import { EmojiField } from "./emojiPicker";
import { stripTags } from "./parser";
import { RecurrenceEditor } from "./recurrenceEditor";
import { TagEditor } from "./tagEditor";
import { attachNoteSuggest } from "./noteSuggest";
import { inboxNotePath } from "./settings";
import { TimeEditor } from "./timeEditor";
import { fieldHeader, flagInvalid, requiredMark } from "./ui";
import type { TaskStore } from "./store";
import {
	PRIORITIES, PRIORITY_LABEL, type EventItem, type Priority, type TaskItem,
} from "./types";

export interface TaskDraft {
	title: string;
	date?: DateKey;
	priority: Priority;
	startTime?: string;
	duration?: number;
	until?: DateKey;
	target?: string;
	untilDone?: boolean;
	description?: string;
	path?: string;
}

export class TaskModal extends Modal {
	private draft: TaskDraft;
	private recurrenceEditor?: RecurrenceEditor;
	private timeEditor?: TimeEditor;
	private tagEditor?: TagEditor;
	private titleInput?: HTMLInputElement;
	private dateField?: DateField;
	private emojiField?: EmojiField;

	constructor(
		app: App,
		private store: TaskStore,
		private options: {
			/** Existing task when editing; omitted when creating. */
			existing?: TaskItem;
			defaultDate?: DateKey;
			onSubmit?: () => void;
		} = {},
	) {
		super(app);

		const t = options.existing;
		this.draft = {
			title: splitEmoji(t?.title ?? "").text,
			date: t ? (t.due ?? t.scheduled ?? t.start) : options.defaultDate,
			priority: t?.priority ?? "none",
			startTime: t?.startTime,
			duration: t?.duration,
			until: t?.until,
			target: t?.target,
			untilDone: t?.untilDone,
			description: t?.description ?? "",
			path: t?.path,
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("ct-modal");

		this.titleEl.setText(this.options.existing ? "Edit task" : "New task");

		const taskSetting = new Setting(contentEl)
			.setName("Task")
			.addText((t) => {
				t.setPlaceholder("What needs doing?")
					.setValue(this.draft.title)
					.onChange((v) => (this.draft.title = v));
				t.inputEl.addClass("ct-modal-title-input");
				this.titleInput = t.inputEl;
				window.setTimeout(() => t.inputEl.focus(), 0);
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") { e.preventDefault(); void this.submit(); }
				});
			});

		requiredMark(taskSetting.nameEl);

		// The icon lives at the front of the title, so its control belongs
		// beside the title box rather than in a field of its own.
		this.emojiField = new EmojiField(taskSetting.controlEl, {
			value: splitEmoji(this.draft.title).emoji,
			onChange: () => undefined,
		});
		taskSetting.controlEl.prepend(this.emojiField.el);

		const dateSetting = new Setting(contentEl).setName("Date").setDesc("When the task is due.");

		const setDate = (value?: DateKey) => {
			this.draft.date = value;
			if (value) this.recurrenceEditor?.setAnchor(value);
		};

		this.dateField = new DateField(dateSetting.controlEl, {
			value: this.draft.date,
			format: this.store.settings().dateFormat,
			onChange: setDate,
		});

		const jump = (days: number) => {
			const key = toKey(addDays(new Date(), days));
			this.dateField?.setValue(key);
			setDate(key);
		};

		dateSetting
			.addExtraButton((b) => b.setIcon("sun").setTooltip("Today").onClick(() => jump(0)))
			.addExtraButton((b) => b.setIcon("arrow-right").setTooltip("Tomorrow").onClick(() => jump(1)));

		fieldHeader(contentEl, "Details", "Optional. Markdown, saved indented under the task.");
		const notes = contentEl.createEl("textarea", {
			cls: "ct-field ct-details-input",
			attr: {
				rows: "3",
				placeholder: "Anything worth remembering — links, steps, context…",
			},
		});
		notes.value = this.draft.description ?? "";
		notes.addEventListener("input", () => (this.draft.description = notes.value));

		fieldHeader(contentEl, "Time", "Optional. A start time, and how long it takes.");
		this.timeEditor = new TimeEditor(contentEl, {
			startTime: this.draft.startTime,
			duration: this.draft.duration,
		});

		new Setting(contentEl)
			.setName("Priority")
			.addDropdown((d) => {
				PRIORITIES.forEach((p) => d.addOption(p, PRIORITY_LABEL[p]));
				d.setValue(this.draft.priority).onChange((v) => (this.draft.priority = v as Priority));
			});

		fieldHeader(contentEl, "Tags", "Pick from tags already in your vault, or type a new one.");
		this.tagEditor = new TagEditor(contentEl, {
			selected: this.options.existing?.tags ?? [],
			available: this.store.knownTags(),
			colors: this.store.settings().tagColors,
		});

		fieldHeader(contentEl, "Repeat", "How often this task comes back.");
		this.recurrenceEditor = new RecurrenceEditor(contentEl, {
			initial: this.options.existing?.recurrence,
			until: this.draft.until,
			target: this.draft.target,
			untilDone: this.draft.untilDone,
			anchor: this.draft.date,
			firstDayOfWeek: this.store.settings().firstDayOfWeek,
			weekendDays: this.store.settings().weekendDays,
			dateFormat: this.store.settings().dateFormat,
			events: this.store.getEvents(),
		});

		if (!this.options.existing) {
			const settings = this.store.settings();
			new Setting(contentEl)
				.setName("Add to")
				.setDesc("Start typing to search your notes, or type a new name to create one.")
				.addText((t) => {
					t.setPlaceholder(inboxNotePath(settings));
					t.inputEl.addClass("ct-note-input");
					attachNoteSuggest(this.app, t.inputEl, {
						defaultFolder: settings.calendarFolder,
						inboxPath: inboxNotePath(settings),
						onChoose: (path) => (this.draft.path = path),
					});
				});
		}

		const buttons = new Setting(contentEl);

		if (this.options.existing) {
			buttons.addButton((b) =>
				b.setButtonText("Delete").setWarning().onClick(async () => {
					await this.store.deleteTask(this.options.existing!);
					this.options.onSubmit?.();
					this.close();
				}),
			);
			buttons.addButton((b) =>
				b.setButtonText("Open note").onClick(async () => {
					await this.store.revealTask(this.options.existing!);
					this.close();
				}),
			);
		}

		buttons.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		buttons.addButton((b) =>
			b.setButtonText(this.options.existing ? "Save" : "Create").setCta().onClick(() => void this.submit()),
		);
	}

	private async submit(): Promise<void> {
		// Picks up a date typed but not yet blurred out of.
		this.draft.date = this.dateField?.getValue();

		const title = this.draft.title.trim();
		if (!title) {
			new Notice("Give the task a title.");
			if (this.titleInput) flagInvalid(this.titleInput);
			return;
		}

		const { recurrence, until, target, untilDone } = this.recurrenceEditor?.value() ?? {};
		const { startTime, duration } = this.timeEditor?.value() ?? {};

		const tags = this.tagEditor?.value() ?? [];

		// Tags live inside the description. Strip whatever is there and re-add
		// the current selection, otherwise a removed tag would survive in the
		// title text forever.
		const titleWithTags = withEmoji(
			[stripTags(title), ...tags].join(" ").trim(),
			this.emojiField?.getValue(),
		);

		if (this.options.existing) {
			await this.store.updateTask(this.options.existing, {
				title: titleWithTags,
				priority: this.draft.priority,
				due: this.draft.date,
				scheduled: undefined,
				start: undefined,
				startTime: this.draft.startTime,
				duration: this.draft.duration,
				recurrence,
				until,
				target,
				untilDone,
				description: this.draft.description ?? "",
			});
		} else {
			await this.store.createTask(
				{
					title: titleWithTags,
					priority: this.draft.priority,
					due: this.draft.date,
					startTime,
					duration,
					recurrence,
					until,
					target,
					untilDone,
					description: this.draft.description,
					createdDate: todayKey(),
					tags,
				},
				this.draft.path,
			);
		}

		this.options.onSubmit?.();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const EVENT_COLORS = [
	{ value: "#f38ba8", label: "Red" },
	{ value: "#fab387", label: "Peach" },
	{ value: "#f9e2af", label: "Yellow" },
	{ value: "#a6e3a1", label: "Green" },
	{ value: "#89b4fa", label: "Blue" },
	{ value: "#cba6f7", label: "Mauve" },
];

export class EventModal extends Modal {
	private draft: Omit<EventItem, "path">;
	private titleInput?: HTMLInputElement;
	private startInput?: HTMLInputElement;

	constructor(
		app: App,
		private store: TaskStore,
		private options: { existing?: EventItem; defaultDate?: DateKey; onSubmit?: () => void } = {},
	) {
		super(app);
		const e = options.existing;
		const date = options.defaultDate ?? todayKey();
		this.draft = {
			title: e?.title ?? "",
			start: e?.start ?? date,
			end: e?.end ?? date,
			allDay: e?.allDay ?? true,
			startTime: e?.startTime,
			endTime: e?.endTime,
			color: e?.color ?? EVENT_COLORS[4].value,
			tags: e?.tags ?? [],
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("ct-modal");
		this.titleEl.setText(this.options.existing ? "Edit event" : "New event");

		const titleSetting = new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("TOEFL exam").setValue(this.draft.title).onChange((v) => (this.draft.title = v));
			this.titleInput = t.inputEl;
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		requiredMark(titleSetting.nameEl);

		const format = this.store.settings().dateFormat;

		const startSetting = new Setting(contentEl).setName("Starts");
		const startField = new DateField(startSetting.controlEl, {
			value: this.draft.start,
			format,
			onChange: (v) => {
				this.draft.start = v ?? "";
				// Keep the range valid rather than letting it end before it starts.
				if (v && this.draft.end < v) {
					this.draft.end = v;
					endField.setValue(v);
				}
			},
		});
		this.startInput = startField.inputEl;
		requiredMark(startSetting.nameEl);

		const endSetting = new Setting(contentEl)
			.setName("Ends")
			.setDesc("Same as the start date for a single-day event.");
		const endField = new DateField(endSetting.controlEl, {
			value: this.draft.end,
			format,
			onChange: (v) => (this.draft.end = v ?? this.draft.start),
		});

		new Setting(contentEl)
			.setName("All day")
			.addToggle((t) =>
				t.setValue(this.draft.allDay).onChange((v) => {
					this.draft.allDay = v;
					this.contentEl.empty();
					this.onOpen();
				}),
			);

		if (!this.draft.allDay) {
			new Setting(contentEl).setName("Start time").addText((t) => {
				t.inputEl.type = "time";
				t.setValue(this.draft.startTime ?? "09:00").onChange((v) => (this.draft.startTime = v));
				if (!this.draft.startTime) this.draft.startTime = "09:00";
			});
			new Setting(contentEl).setName("End time").addText((t) => {
				t.inputEl.type = "time";
				t.setValue(this.draft.endTime ?? "10:00").onChange((v) => (this.draft.endTime = v));
				if (!this.draft.endTime) this.draft.endTime = "10:00";
			});
		}

		new Setting(contentEl).setName("Colour").addDropdown((d) => {
			EVENT_COLORS.forEach((c) => d.addOption(c.value, c.label));
			d.setValue(this.draft.color ?? EVENT_COLORS[4].value).onChange((v) => (this.draft.color = v));
		});

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText(this.options.existing ? "Save" : "Create").setCta().onClick(async () => {
					this.draft.start = startField.getValue() ?? "";
					this.draft.end = endField.getValue() ?? this.draft.start;

					if (!this.draft.title.trim()) {
						new Notice("Give the event a title.");
						if (this.titleInput) flagInvalid(this.titleInput);
						return;
					}
					// A start date is what places the event on the calendar at
					// all; without it the note is written but never shown.
					if (!this.draft.start) {
						new Notice("Give the event a start date.");
						if (this.startInput) flagInvalid(this.startInput);
						return;
					}
					const file = await this.store.createEvent(this.draft);
					if (file instanceof TFile) this.options.onSubmit?.();
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Minimal date picker — the touch-friendly path for rescheduling. */
export class DatePromptModal extends Modal {
	private dateInput?: HTMLInputElement;

	constructor(
		app: App,
		private heading: string,
		private initial: DateKey,
		private format: DateFormat,
		private onPick: (date: DateKey) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("ct-modal");
		this.titleEl.setText(this.heading);

		let value: DateKey | undefined = this.initial;

		const setting = new Setting(this.contentEl).setName("Date");
		const field = new DateField(setting.controlEl, {
			value,
			format: this.format,
			onChange: (v) => (value = v),
		});
		this.dateInput = field.inputEl;
		window.setTimeout(() => field.inputEl.focus(), 0);
		requiredMark(setting.nameEl);
		setting.settingEl.addClass("ct-date-prompt");

		const quick = this.contentEl.createDiv({ cls: "ct-quick-dates" });
		const shortcut = (label: string, days: number) => {
			const b = quick.createEl("button", { cls: "ct-mini-btn", text: label });
			b.addEventListener("click", () => {
				this.onPick(toKey(addDays(new Date(), days)));
				this.close();
			});
		};
		shortcut("Today", 0);
		shortcut("Tomorrow", 1);
		shortcut("Next week", 7);

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText("Move").setCta().onClick(() => {
					value = field.getValue();
					if (!value) {
						new Notice("Pick a date to move the task to.");
						if (this.dateInput) flagInvalid(this.dateInput);
						return;
					}
					this.onPick(value);
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	constructor(app: App, private message: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText("Confirm").setWarning().onClick(() => { this.onConfirm(); this.close(); }),
			);
	}
}
