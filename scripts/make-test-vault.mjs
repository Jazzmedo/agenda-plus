// Builds a throwaway Obsidian vault preloaded with the plugin and sample data.
// Usage: node scripts/make-test-vault.mjs [vaultPath]
//
// Every date is generated relative to *today*, so the sample stays meaningful
// no matter when you run it.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const force = args.includes("--force");
const vault = args.find((a) => !a.startsWith("--")) ?? "/home/hanafi/Documents/agenda-plus-testvault";
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

// ── date helpers ─────────────────────────────────────────────────────────

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date key for today + n days. */
const key = (n) => {
	const d = new Date(today);
	d.setDate(d.getDate() + n);
	return fmt(d);
};

/** Next occurrence of a weekday (0=Sun), today counts. */
const nextWeekday = (target) => {
	const d = new Date(today);
	d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
	return fmt(d);
};

/** The 1st of next month. */
const nextFirst = () => fmt(new Date(today.getFullYear(), today.getMonth() + 1, 1));

// ── files ────────────────────────────────────────────────────────────────

// The sample notes are regenerated wholesale; --clean also drops folders
// left behind by an older layout so nothing stale lingers.
if (clean && fs.existsSync(vault)) {
	for (const dir of ["Calender", "_Dashboard", "Events", "Study", "Work", "Personal", "Archive", "Outside Notes"]) {
		fs.rmSync(path.join(vault, dir), { recursive: true, force: true });
	}
	fs.rmSync(path.join(vault, "START HERE.md"), { force: true });
}

let skipped = 0;

// Never clobber a file that already exists. Once you've opened the vault and
// started ticking things off, a re-run must not throw that away — pass
// --force (or --clean) when you genuinely want the samples rewritten.
const write = (rel, content) => {
	const full = path.join(vault, rel);
	if (!force && !clean && fs.existsSync(full)) {
		skipped++;
		return;
	}
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
};

// Plugin install + enablement
fs.mkdirSync(path.join(vault, ".obsidian", "plugins", manifest.id), { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
	if (!fs.existsSync(file)) {
		console.error(`Missing ${file} — run "npm run build" first.`);
		process.exit(1);
	}
	fs.copyFileSync(file, path.join(vault, ".obsidian", "plugins", manifest.id, file));
}

write(".obsidian/community-plugins.json", JSON.stringify([manifest.id], null, 2));
write(".obsidian/app.json", JSON.stringify({ promptDelete: false }, null, 2));

// Plugin settings — mostly defaults, plus tag colours to show them off.
write(
	`.obsidian/plugins/${manifest.id}/data.json`,
	JSON.stringify(
		{
			calendarFolder: "Calender",
			inboxHeading: "Inbox",
			restrictToCalendarFolder: true,
			ignoredFolders: ["attachments", ".trash"],
			firstDayOfWeek: 0,
			maxChipsPerDay: 4,
			tagPriorities: { "#urgent": "highest", "#important": "high", "#someday": "low" },
			tagColors: { "#toefl": "#cba6f7", "#work": "#89b4fa", "#health": "#a6e3a1", "#personal": "#fab387" },
			rolloverOverdue: true,
			projectionDays: 400,
			trackCompletionDates: true,
			openOnStartup: true,
		},
		null,
		2,
	),
);

// ── events ───────────────────────────────────────────────────────────────

const event = (title, start, end, color, extra = "") =>
	`---\ntitle: ${title}\nstart: ${start}\nend: ${end}\nallDay: true\ncolor: "${color}"\n${extra}---\n\nNotes about ${title}.\n`;

write("Calender/Events/TOEFL Exam.md", event("TOEFL Exam", key(44), key(44), "#f38ba8"));
write("Calender/Events/Cyber Bootcamp.md", event("Cyber Bootcamp", key(5), key(8), "#89b4fa"));
write("Calender/Events/Team Offsite.md", event("Team Offsite", key(21), key(21), "#a6e3a1"));
write("Calender/Events/Project Deadline.md", event("Project Deadline", key(30), key(30), "#cba6f7"));

// ── tasks ────────────────────────────────────────────────────────────────

write(
	"Calender/Tasks.md",
	`# Tasks

## Inbox

- [ ] Book dentist appointment #personal 📅 ${key(-3)}
- [ ] Reply to supervisor email #work ⏫ 📅 ${key(-1)}
- [ ] Review lecture notes #study 📅 ${key(0)} ⏰ 14:00 ⏱ 1h30m
- [ ] Grocery run #personal 🔽 📅 ${key(0)} ⏱ 45m
- [x] Morning standup #work 📅 ${key(0)} ⏰ 09:00 ⏱ 15m ✅ ${key(0)}
- [ ] Draft CV section #important 📅 ${key(1)}
- [ ] Renew library card #someday 📅 ${key(5)}
- [ ] Plan weekend trip #personal 📅 ${key(9)}

## Backlog (no date)

- [ ] Fix laptop battery #urgent
- [ ] Read paper on eBPF #study
- [ ] Clean up old screenshots #someday
`,
);

// The "month of prep before an event" pattern — the headline feature.
write(
	"Calender/Study — TOEFL.md",
	`# TOEFL preparation

Exam is on ${key(44)}. Prep ramps up one month out and stops on exam day.

- [ ] Practice listening #toefl 🔁 every day 🛫 ${key(13)} ⏰ 19:00 ⏱ 45m 🎯 [[TOEFL Exam]]
- [ ] Vocab drill #toefl ⏫ 🔁 every day 🛫 ${key(13)} ⏰ 07:30 ⏱ 30m 🎯 [[TOEFL Exam]]
- [ ] Mock speaking test #toefl 🔁 every Mon, Thu 📅 ${nextWeekday(1)} 🎯 [[TOEFL Exam]]
- [ ] Book the exam slot #toefl #urgent 📅 ${key(2)}
`,
);

write(
	"Calender/Work — Sprint.md",
	`# Current sprint

- [ ] Weekly report #work 🔁 every Fri 📅 ${nextWeekday(5)} ⏰ 16:00 ⏱ 1h
- [ ] Standup notes #work 🔁 every weekday 📅 ${key(0)} ⏰ 09:00 ⏱ 15m
- [ ] Team retro #work 🔼 📅 ${key(2)}
- [ ] Prep offsite slides #work #important 📅 ${key(19)} 🎯 [[Team Offsite]]
- [ ] Ship auth refactor #work #urgent 📅 ${key(28)} 🎯 [[Project Deadline]]
`,
);

write(
	"Calender/Personal — Routines.md",
	`# Routines

- [ ] Gym session #health 🔁 every Mon, Wed, Fri 📅 ${nextWeekday(1)} ⏰ 18:00 ⏱ 1h15m
- [ ] Meal prep #health 🔁 every Sun 📅 ${nextWeekday(0)} ⏰ 11:00 ⏱ 2h
- [ ] Pay rent #personal 🔁 every month on the 1st 📅 ${nextFirst()}
- [ ] Backup laptop #personal 🔁 every 2 weeks 📅 ${key(3)}
- [ ] Deep clean flat #personal 🔁 every month 📅 ${key(11)}
`,
);

// Deliberately OUTSIDE the calendar folder — proves scoping works.
write(
	"Outside Notes/Not Indexed.md",
	`# Not indexed

This note lives outside \`Calender/\`, so with **Only index the calendar folder** on
(the default) none of these tasks appear anywhere in the plugin.

- [ ] SHOULD NOT APPEAR anywhere in the calendar 📅 ${key(0)} ⏫
- [ ] SHOULD NOT APPEAR either #work 📅 ${key(1)}
- [x] SHOULD NOT count toward stats 📅 ${key(-1)} ✅ ${key(-1)}

Turn the setting off in **Settings → AgendaPlus → Storage** and these three appear.
Turn it back on and they vanish again.
`,
);

// ── completion history (drives the stats view) ───────────────────────────

const LABELS = [
	["Vocab drill", "#toefl"], ["Gym session", "#health"], ["Standup notes", "#work"],
	["Read chapter", "#study"], ["Inbox zero", "#work"], ["Meal prep", "#health"],
	["Practice listening", "#toefl"], ["Code review", "#work"], ["Evening walk", "#health"],
];

// Deterministic pseudo-random so repeated runs produce the same vault.
let seed = 20260719;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const history = [];
for (let i = 89; i >= 0; i--) {
	const date = key(-i);
	const dow = new Date(today.getTime() - i * 86400000).getDay();

	// Quieter weekends, an intentional dry spell ~5 weeks back so the
	// heatmap and streak have something to show.
	let count = Math.floor(rand() * 5);
	if (dow === 0 || dow === 6) count = Math.max(0, count - 2);
	if (i > 33 && i < 40) count = 0;
	if (i <= 3) count = Math.max(1, count); // keep a live streak

	for (let n = 0; n < count; n++) {
		const [label, tag] = LABELS[Math.floor(rand() * LABELS.length)];
		history.push(`- [x] ${label} ${tag} 📅 ${date} ✅ ${date}`);
	}
}

write(
	"Calender/Completed Log.md",
	`# Completed log\n\nGenerated history so the Stats view has something to chart.\n\n${history.join("\n")}\n`,
);

// ── guide ────────────────────────────────────────────────────────────────

write(
	"START HERE.md",
	`# AgendaPlus — test vault

The plugin is already installed and enabled. If the calendar doesn't open by itself,
click the calendar icon in the left ribbon.

## Try this

**Month view**
- Drag a task chip from one day to another — the date rewrites in the source note.
- Click a chip's checkbox to complete it; click the chip body to edit it.
- Right-click a chip for postpone / move-to-today / delete.
- Right-click an empty part of a day to add a task or event there.
- Click empty space in a day cell to type a task inline (Enter saves, Esc cancels).
- Note the coloured bars: **Cyber Bootcamp** (${key(5)}–${key(8)}) spans four days.

**Week view** — the current week with a done/total progress bar.

**Day view** — click any day number to drill in.

**Today** (second ribbon icon)
- Overdue rollover at the top (two tasks are deliberately in the past).
- Completion ring, quick-add box, and a collapsible undated **Backlog**.

**Stats** — command palette → \`AgendaPlus: Open statistics\`
- KPIs, completion rate, current streak, per-day trend.
- 12-week heatmap; there's a deliberate dry spell about five weeks back.
- Breakdown by tag and by priority.

## The headline feature — a month of prep before an event

Open \`Calender/Study — TOEFL.md\`. The exam is an event on **${key(44)}**. Two daily tasks are linked
to it with 🎯 and start one month out on **${key(13)}**:

- They generate a daily instance from ${key(13)} onward.
- They **stop automatically** on exam day — scroll past ${key(44)} and they're gone.
- Every chip shows a live countdown (\`31d\`, \`30d\`, …).

## The repeat picker

Click any task, or **+ Add → New task**, and look at the **Repeat** block:

- **Never / Daily / Weekly / Monthly / Yearly** across the top.
- **Every [N] weeks** with − / + steppers.
- **Weekly** shows seven day circles — tap to toggle. Shortcuts: *Weekdays*, *Weekend*, *All*.
  (You can't deselect the last day; a weekly rule with no days can never fire.)
- **Monthly** asks for a day of the month, and warns that short months use their last day.
- **Ends: Never / On date / At event** — "At event" is what stops prep tasks on exam day.
- A live **preview** shows the next five dates and the total count, so the rule is never a guess.

Everything you pick is written back as readable text, e.g. \`🔁 every 2 weeks on Mon, Fri\`.

## Everything lives in Calender/

\`Calender/Tasks.md\` — where tasks you add from the calendar go (under \`## Inbox\`).
\`Calender/Events/\` — one note per event.
The other \`Calender/*.md\` notes are sample project notes; tasks are indexed from anywhere
in the vault, not just this folder.

## Start time and duration (both optional)

Open **New task** — under the date there's **Start time** and **Duration**. Either can be
left empty; a task with neither is all-day, exactly as before.

- Timed tasks show the clock on their calendar chip and sort **by time within the day**,
  above untimed ones regardless of priority.
- With both set, rows read as a span: \`14:00 – 15:30\`.
- The **Today** header totals the durations of your unfinished tasks — \`2h 30m planned\`.
- In markdown it's \`⏰ 14:00 ⏱ 1h30m\`. Durations accept \`45m\`, \`1h30m\`, \`1.5h\` or
  plain minutes; the picker offers common values with a Custom option.

Today's list already has a few: *Review lecture notes* (14:00, 1h30m), *Grocery run*
(45m estimate, no time), and the recurring *Vocab drill* at 07:30.

## Scoping — only Calender/ is indexed

**Settings → AgendaPlus → Storage → Only index the calendar folder** is ON by default.
\`Outside Notes/Not Indexed.md\` contains three loud tasks that should appear **nowhere** in
the plugin. Toggle the setting off and they show up; toggle it on and they vanish.

## Tag colours

**Settings → AgendaPlus → Tag colours** lists every tag found in your indexed notes,
each with a colour picker and a task count. Pick a colour and it applies immediately to
that tag's calendar chips, its tag pill, and its bar in the Stats breakdown. The circular
arrow resets a tag to the default. Four are preset here: \`#toefl\`, \`#work\`, \`#health\`,
\`#personal\` — try changing \`#toefl\` to something loud and watch the TOEFL chips update.

## Priority by tag

\`#urgent\` → highest, \`#important\` → high, \`#someday\` → low (Settings → AgendaPlus).
"Fix laptop battery" is tagged \`#urgent\` and sorts to the top with no priority emoji typed.

## Recurring completion

Tick **Gym session** in \`Calender/Personal — Routines.md\`. A completed copy is written beneath it and
the master line rolls forward to the next Mon/Wed/Fri. Open the note to see the markdown.

## Reset

Delete this folder and re-run \`node scripts/make-test-vault.mjs\` from the plugin repo.
`,
);

console.log(`Test vault ready at: ${vault}`);
console.log(`  ${manifest.name} v${manifest.version} installed (plugin files always refreshed)`);
if (skipped) {
	console.log(`  ${skipped} existing file(s) left untouched — pass --force to rewrite them`);
} else {
	console.log(`  ${history.length} historical completions generated`);
}
console.log(`\nIn Obsidian: "Open folder as vault" -> ${vault}`);
