<p align="center">
  <img src="assets/banner.svg" alt="AgendaPlus: tasks, events and stats on one calendar, inside Obsidian" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Jazzmedo/agenda-plus/releases/latest"><img src="https://img.shields.io/github/v/release/Jazzmedo/agenda-plus?style=flat-square&color=7c3aed&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Jazzmedo/agenda-plus?style=flat-square&color=db2777" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Obsidian-1.5%2B-705dc1?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian 1.5 and later">
  <img src="https://img.shields.io/badge/task%20syntax-obsidian--tasks%20compatible-a882ff?style=flat-square" alt="obsidian-tasks compatible syntax">
</p>

An Obsidian plugin that puts your calendar, tasks, events and progress stats in one place.

Tasks stay as ordinary markdown checkboxes in your notes — nothing is locked in a database,
and the metadata syntax is the same one the `obsidian-tasks` plugin uses, so your notes stay
portable.

## Views

| View | What it's for |
|---|---|
| **Calendar** — Month | The whole month. Events as coloured bars, tasks as chips. Drag a task to another day to reschedule it. |
| **Calendar** — Week | The current week as seven columns, with a done/total progress bar for the week. |
| **Calendar** — Day | A single day's agenda, with the source note shown for each task. |
| **Today** | Overdue rollover, today's list, a completion ring, quick-add, and a collapsible undated backlog. |
| **Stats** | Completed/open/overdue KPIs, completion rate, streak, per-day trend, a 12-week consistency heatmap, and breakdowns by tag and priority. |

Open them from the ribbon icons, or the command palette (`AgendaPlus: Open …`).

## Task syntax

A task is any markdown checkbox. Metadata is appended with emoji markers:

```markdown
- [ ] Study TOEFL vocab #toefl ⏫ 🔁 every day 🛫 2026-08-01 🎯 [[TOEFL Exam]]
- [ ] Pay rent 🔁 every month on the 1st 📅 2026-08-01
- [ ] Gym 🔁 every Mon, Wed, Fri 📅 2026-07-20 🏁 2026-12-31
- [x] Crash Course #english 📅 2026-07-19 ✅ 2026-07-19
```

| Marker | Meaning |
|---|---|
| `📅` | Due date |
| `⏳` | Scheduled date |
| `🛫` | Start date |
| `✅` | Completion date |
| `➕` | Created date |
| `🔁` | Repeat rule |
| `🏁` | Repeat until (this plugin's extension) |
| `🎯` | Linked event — the countdown anchor (this plugin's extension) |
| `🔺 ⏫ 🔼 🔽 ⏬` | Highest / high / medium / low / lowest priority |

> [!TIP]
> You never have to type these by hand — the **New task** form writes them for you.

### Repeat rules

The task form has a structured **repeat picker** — you never type a rule by hand:

- **Never / Daily / Weekly / Monthly / Yearly**
- **Every [N]** days/weeks/months/years, with steppers
- **Weekly**: seven day toggles, plus *Weekdays* / *Weekend* / *All* shortcuts. The last
  selected day can't be removed — a weekly rule with no days can never fire.
- **Monthly**: a day-of-month field that notes shorter months fall back to their last day
- **Ends**: *Never*, *On date*, or *At event*
- A live preview of the next five dates and the total occurrence count

The picker writes plain readable text, and hand-written rules parse too:

`every day` · `every 3 days` · `every week` · `every 2 weeks` · `every Mon, Wed, Fri` ·
`every weekday` · `every weekend` · `every month` · `every month on the 15th` · `every year`

Append `when done` (e.g. `every 3 days when done`) to count the next occurrence from the
completion date instead of the due date.

> [!NOTE]
> Monthly rules keep their anchor day: a task on the 31st gives Jan 31 → Feb 28 → **Mar 31**,
> rather than drifting to the 28th forever after one short month.

### The "a month of prep before an event" pattern

This is what event linking is for. Create the event, then link a repeating task to it:

```markdown
- [ ] Practice listening 🔁 every day 🛫 2026-08-01 🎯 [[TOEFL Exam]]
```

The task generates a daily instance from Aug 1, **stops automatically** on the event date,
and every chip shows a countdown (`31d`, `30d`, …) so you can see the deadline closing in.

### Recurring tasks and history

Checking off a repeat writes a completed copy beneath the master line and rolls the master
forward to its next date:

```markdown
- [ ] Gym 🔁 every Mon, Wed, Fri 📅 2026-07-22
- [x] Gym 🔁 every Mon, Wed, Fri 📅 2026-07-20 ✅ 2026-07-20
```

The history is plain text, which is what makes the stats view possible.

## Tags: priority and colour

**Priority by tag** — rather than typing priority emoji, map tags to priorities in settings.
Out of the box: `#urgent` → highest, `#important` → high, `#someday` → low. A tagged task
inherits that priority automatically, and tags double as calendar filters.

Both live in one **Tags** section in settings: a row per tag with a colour picker, a
priority dropdown, and a reset button — every row, always, whether or not anything is set
on it. There's a filter box and a rescan button.

The list mirrors your notes. Delete a tag from your tasks and it drops out of the list on the
next rescan; if it still had a colour or priority attached, those move to an **Unused**
group where they can be removed individually or all at once.

## Where files live

Everything the plugin owns sits under one folder, set by **Calendar folder** in settings
(default `Calender/`):

```
Calender/
├── Tasks.md        ← tasks added from the calendar land here, under "## Inbox"
└── Events/         ← one note per event
    └── TOEFL Exam.md
```

By default the plugin **only looks inside this folder**. Notes elsewhere in the vault are
invisible to it — they aren't indexed, don't appear on the calendar, and don't count toward
stats. Turn off **Only index the calendar folder** in settings to index the whole vault
instead.

`Ignored folders` still applies within the scope, so you can exclude e.g.
`Calender/Archive` from indexing while keeping it in the folder.

## Events

Events are notes in `<calendar folder>/Events/` with frontmatter:

```yaml
---
title: TOEFL Exam
start: 2026-09-01
end: 2026-09-01
allDay: true
color: "#f38ba8"
---
```

Create them from the calendar's **+ Add → New event** menu. Multi-day events render as a
bar spanning their days.

## Install

<details open>
<summary><b>Community plugin marketplace</b> (once listed)</summary>

In Obsidian: <kbd>Settings</kbd> → <kbd>Community plugins</kbd> → <kbd>Browse</kbd>, search for
**AgendaPlus**, install and enable it.

> [!NOTE]
> The marketplace submission is still in review. Until it's listed, use one of the methods
> below — they install the exact same build.

</details>

<details>
<summary><b>Manual</b> (any release)</summary>

1. Download `agenda-plus-<version>.zip` from the
   [latest release](https://github.com/Jazzmedo/agenda-plus/releases/latest).
2. Create the folder `<your vault>/.obsidian/plugins/agenda-plus/` and extract the zip
   into it — the folder should end up containing `main.js`, `manifest.json` and
   `styles.css`.
3. In Obsidian: <kbd>Settings</kbd> → <kbd>Community plugins</kbd>, turn off restricted
   mode if asked, then enable **AgendaPlus**.

</details>

<details>
<summary><b>BRAT</b> (tracks pre-releases too)</summary>

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin and enable it.
2. <kbd>Settings</kbd> → <kbd>BRAT</kbd> → <kbd>Add Beta plugin</kbd>.
3. Enter `Jazzmedo/agenda-plus` and enable **AgendaPlus** once BRAT installs it.

</details>

<details>
<summary><b>From source</b></summary>

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| npm | 9 or later |

```bash
git clone https://github.com/Jazzmedo/agenda-plus.git
cd agenda-plus
npm install
npm run build
npm run deploy -- /path/to/your/vault    # defaults to the vault in scripts/deploy.mjs
```

Then enable **AgendaPlus** in Obsidian's community plugin settings.

</details>

## Development

```bash
npm run dev    # rebuild on save, with inline sourcemaps
npm test       # pure logic: date maths, task parsing, recurrence
npm run build  # typecheck + production bundle
```

`src/` layout:

- `dates.ts` — local-midnight date helpers; days are identified by `YYYY-MM-DD`, never UTC timestamps
- `recurrence.ts` — repeat-rule parsing and occurrence generation
- `parser.ts` — markdown checkbox ⇄ task object, round-trip safe
- `paths.ts` — folder scoping (prefix matching that won't confuse `Calender` with `CalenderOld`)
- `store.ts` — vault index, occurrence expansion, and all file mutations
- `render.ts` — shared chip/row rendering, drag-and-drop, context menus
- `recurrenceEditor.ts` — the structured repeat picker
- `views/` — calendar, today and stats panes

### Test vault

`node scripts/make-test-vault.mjs [path]` builds a throwaway vault with the plugin
installed, ~170 sample tasks, four events and 90 days of completion history, all dated
relative to today.

Re-running it **never overwrites notes that already exist** — the plugin binaries are
refreshed and everything else is left alone, so edits you made while testing survive.
Pass `--force` to rewrite the sample notes, or `--clean` to also delete the sample folders
first. Use `npm run deploy -- <vault>` when you only want to push a new build.

## Contributing

Issues and pull requests are welcome at
[Jazzmedo/agenda-plus](https://github.com/Jazzmedo/agenda-plus). For bugs, include your
Obsidian version and a sample task line that triggers the problem.

## License

MIT. See [LICENSE](LICENSE). © Jazzmedo
