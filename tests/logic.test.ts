/**
 * Tests for the pure logic (no Obsidian API involved).
 * Run with: npm test
 */
import {
	addDays, daysBetween, formatDate, formatShort, fromKey, isWeekend, isoWeekNumber,
	parseDateInput, startOfWeek, toKey,
} from "../src/dates";
import {
	anchorDate, anchorField, durationBetween, endTimeOf, formatDuration, parseDuration,
	parseTaskLine, parseTime, serializeTask, seriesKey, stripTags, timeToMinutes,
} from "../src/parser";
import { readDescription, writeDescription } from "../src/description";
import { EMOJI_PALETTE, RESERVED_EMOJI, isUsableEmoji, splitEmoji, withEmoji } from "../src/emoji";
import { parseNaturalDate } from "../src/naturalDate";
import { noteBasename, noteFolder, resolveNotePath, scoreNote } from "../src/notePath";
import { inFolder } from "../src/paths";
import { findOrphanedTags, normaliseTag } from "../src/tags";
import { buildRecurrenceText, describeRecurrence, occurrencesBetween, parseRecurrence } from "../src/recurrence";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passed++;
	} else {
		failed++;
		console.error(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`);
	}
}

function ok(name: string, condition: boolean): void {
	check(name, condition, true);
}

// ── dates ────────────────────────────────────────────────────────────────

check("toKey pads", toKey(new Date(2026, 0, 5)), "2026-01-05");
check("fromKey round trip", toKey(fromKey("2026-09-01")), "2026-09-01");
check("addDays crosses month", toKey(addDays(fromKey("2026-01-31"), 1)), "2026-02-01");
check("daysBetween forward", daysBetween(fromKey("2026-07-19"), fromKey("2026-09-01")), 44);
check("daysBetween negative", daysBetween(fromKey("2026-07-19"), fromKey("2026-07-18")), -1);
check("startOfWeek Sunday", toKey(startOfWeek(fromKey("2026-07-22"), 0)), "2026-07-19");
check("startOfWeek Monday", toKey(startOfWeek(fromKey("2026-07-22"), 1)), "2026-07-20");
check("isoWeekNumber", isoWeekNumber(fromKey("2026-01-05")), 2);

// ── parser ───────────────────────────────────────────────────────────────

const plain = parseTaskLine("- [ ] Crash Course", "a.md", 3)!;
check("plain title", plain.title, "Crash Course");
check("plain not done", plain.done, false);
check("plain has no date", anchorDate(plain), undefined);
check("plain id", plain.id, "a.md:3");

const rich = parseTaskLine(
	"    * [x] Study vocab #toefl #study ⏫ 🔁 every Mon, Wed 🛫 2026-08-01 📅 2026-09-01 ✅ 2026-07-19",
	"b.md",
	7,
)!;
check("rich title", rich.title, "Study vocab #toefl #study");
check("rich tags", rich.tags, ["#toefl", "#study"]);
check("rich priority", rich.priority, "high");
check("rich done", rich.done, true);
check("rich start", rich.start, "2026-08-01");
check("rich due", rich.due, "2026-09-01");
check("rich doneDate", rich.doneDate, "2026-07-19");
check("rich recurrence weekdays", rich.recurrence?.weekdays, [1, 3]);
check("rich anchor prefers due", anchorDate(rich), "2026-09-01");
check("rich anchorField", anchorField(rich), "due");
check("rich indent preserved", rich.indent, "    ");
check("rich bullet preserved", rich.bullet, "*");

// Round-tripping must not corrupt the line.
const roundTrip = serializeTask(rich);
const reparsed = parseTaskLine(roundTrip, "b.md", 7)!;
check("round trip title", reparsed.title, rich.title);
check("round trip due", reparsed.due, rich.due);
check("round trip start", reparsed.start, rich.start);
check("round trip priority", reparsed.priority, rich.priority);
check("round trip recurrence", reparsed.recurrence?.raw, rich.recurrence?.raw);
check("round trip doneDate", reparsed.doneDate, rich.doneDate);
check("round trip status", reparsed.status, "x");

// Kanban-style line with a block id (the user's existing vault format).
const kanban = parseTaskLine("- [x] [[Grammar Khan Academy]] ^0y57z0", "c.md", 2)!;
check("kanban title keeps link", kanban.title, "[[Grammar Khan Academy]]");
check("kanban blockId", kanban.blockId, "0y57z0");
check("kanban round trip", serializeTask(kanban), "- [x] [[Grammar Khan Academy]] ^0y57z0");

// Event link target.
const targeted = parseTaskLine("- [ ] Revise 🔁 every day 🎯 [[TOEFL Exam]] 📅 2026-08-01", "d.md", 0)!;
check("target parsed", targeted.target, "TOEFL Exam");
check("target title clean", targeted.title, "Revise");

// Non-task lines are rejected.
ok("plain text is not a task", parseTaskLine("Just a sentence", "e.md", 0) === undefined);
ok("heading is not a task", parseTaskLine("## Heading", "e.md", 0) === undefined);
ok("numbered task is a task", parseTaskLine("1. [ ] Numbered", "e.md", 0) !== undefined);

check("seriesKey normalises", seriesKey(plain), "a.md::crash course");

// ── tag editing round trip ───────────────────────────────────────────────
//
// Tags live inline in the description. The edit form rebuilds the title from
// a stripped base plus the current selection — without that, DEselecting a
// tag left it stranded in the text and it came straight back on reparse.

check("stripTags removes tags", stripTags("Study vocab #toefl #study"), "Study vocab");
check("stripTags leaves plain text", stripTags("Study vocab"), "Study vocab");
check("stripTags collapses whitespace", stripTags("Read #a paper #b"), "Read paper");
check("stripTags handles tag-only title", stripTags("#toefl"), "");

/** Mirrors what TaskModal.submit does. */
const rebuild = (title: string, tags: string[]) => [stripTags(title), ...tags].join(" ").trim();

check("adding a tag", rebuild("Study vocab", ["#toefl"]), "Study vocab #toefl");
check("removing a tag", rebuild("Study vocab #toefl #study", ["#study"]), "Study vocab #study");
check("removing every tag", rebuild("Study vocab #toefl", []), "Study vocab");
check("replacing tags", rebuild("Study vocab #old", ["#new", "#other"]), "Study vocab #new #other");
check("no duplication on re-save", rebuild("Study vocab #toefl", ["#toefl"]), "Study vocab #toefl");

// And the rebuilt title must survive a parse.
const retagged = parseTaskLine(`- [ ] ${rebuild("Gym #old", ["#health"])} 📅 2026-07-20`, "r.md", 0)!;
check("rebuilt title reparses", retagged.title, "Gym #health");
check("rebuilt tags reparse", retagged.tags, ["#health"]);
check("old tag is gone", retagged.tags.includes("#old"), false);

// ── folder scoping ───────────────────────────────────────────────────────

ok("file inside folder", inFolder("Calender/Tasks.md", "Calender"));
ok("nested file inside folder", inFolder("Calender/Events/Exam.md", "Calender"));
ok("the folder itself", inFolder("Calender", "Calender"));
ok("sibling prefix is NOT inside", !inFolder("CalenderOld/note.md", "Calender"));
ok("similarly named file is NOT inside", !inFolder("Calender.md", "Calender"));
ok("unrelated path is outside", !inFolder("Work/Sprint.md", "Calender"));
ok("empty folder matches nothing", !inFolder("Calender/Tasks.md", ""));
ok("case is significant", !inFolder("calender/Tasks.md", "Calender"));

// ── tag settings ─────────────────────────────────────────────────────────
//
// A tag the user removes from their notes must drop out of the settings
// list. Previously configured tags were merged back in unconditionally,
// so a deleted tag appeared forever.

check(
	"tag still in use is not orphaned",
	findOrphanedTags({ "#work": "#89b4fa" }, {}, ["#work", "#study"]),
	[],
);
check(
	"deleted tag becomes orphaned",
	findOrphanedTags({ "#work": "#89b4fa" }, {}, ["#study"]),
	["#work"],
);
check(
	"orphan detected via priority map alone",
	findOrphanedTags({}, { "#urgent": "highest" }, ["#study"]),
	["#urgent"],
);
check(
	"a tag in both maps is reported once",
	findOrphanedTags({ "#old": "#fff" }, { "#old": "high" }, []),
	["#old"],
);
check(
	"orphans are sorted",
	findOrphanedTags({ "#zeta": "#fff", "#alpha": "#000" }, {}, []),
	["#alpha", "#zeta"],
);
check("nothing configured means no orphans", findOrphanedTags({}, {}, ["#a"]), []);
check(
	"every configured tag orphaned when index is empty",
	findOrphanedTags({ "#a": "#fff" }, { "#b": "low" }, []),
	["#a", "#b"],
);

check("normaliseTag adds hash", normaliseTag("urgent"), "#urgent");
check("normaliseTag keeps existing hash", normaliseTag("#urgent"), "#urgent");
check("normaliseTag trims", normaliseTag("  urgent  "), "#urgent");
check("normaliseTag rejects empty", normaliseTag("   "), "");

// ── time and duration ────────────────────────────────────────────────────

check("parseTime pads", parseTime("9:05"), "09:05");
check("parseTime dot separator", parseTime("9.05"), "09:05");
check("parseTime midnight", parseTime("00:00"), "00:00");
check("parseTime rejects hour 24", parseTime("24:00"), undefined);
check("parseTime rejects minute 60", parseTime("10:60"), undefined);
check("parseTime rejects words", parseTime("morning"), undefined);

check("parseDuration bare minutes", parseDuration("90"), 90);
check("parseDuration m suffix", parseDuration("45m"), 45);
check("parseDuration hours", parseDuration("2h"), 120);
check("parseDuration h+m", parseDuration("1h30m"), 90);
check("parseDuration h then m no suffix", parseDuration("1h30"), 90);
check("parseDuration fractional hours", parseDuration("1.5h"), 90);
check("parseDuration rejects zero", parseDuration("0"), undefined);
check("parseDuration rejects words", parseDuration("ages"), undefined);

check("formatDuration minutes", formatDuration(45), "45m");
check("formatDuration whole hours", formatDuration(120), "2h");
check("formatDuration mixed", formatDuration(90), "1h30m");
check("duration round trip", parseDuration(formatDuration(215)), 215);

check("endTimeOf simple", endTimeOf("09:00", 90), "10:30");
check("endTimeOf wraps midnight", endTimeOf("23:30", 60), "00:30");

check("timeToMinutes", timeToMinutes("09:15"), 555);
check("timeToMinutes midnight", timeToMinutes("00:00"), 0);
check("timeToMinutes rejects junk", timeToMinutes("nope"), undefined);

// End time is converted to a duration on entry — that's the only thing stored.
check("durationBetween simple", durationBetween("09:00", "10:30"), 90);
check("durationBetween sub-hour", durationBetween("14:00", "14:25"), 25);
check("durationBetween across midnight", durationBetween("23:00", "01:00"), 120);
check("durationBetween equal times rejected", durationBetween("09:00", "09:00"), undefined);
check("durationBetween invalid end", durationBetween("09:00", "oops"), undefined);
check("durationBetween invalid start", durationBetween("oops", "10:00"), undefined);

// Entering an end time then reading it back must be lossless.
for (const [start, end] of [["09:00", "10:30"], ["23:15", "00:45"], ["07:05", "07:10"]]) {
	const mins = durationBetween(start, end)!;
	check(`end time round trip ${start}->${end}`, endTimeOf(start, mins), end);
}

const timed = parseTaskLine("- [ ] Standup #work ⏰ 09:15 ⏱ 1h30m 📅 2026-07-20", "t.md", 0)!;
check("timed startTime", timed.startTime, "09:15");
check("timed duration", timed.duration, 90);
check("timed due survives", timed.due, "2026-07-20");
check("timed title clean", timed.title, "Standup #work");
check(
	"timed round trip",
	serializeTask(timed),
	"- [ ] Standup #work 📅 2026-07-20 ⏰ 09:15 ⏱ 1h30m",
);
check("timed reparse", parseTaskLine(serializeTask(timed), "t.md", 0)?.duration, 90);

// Duration without a start time is valid — it's just an estimate.
const estimate = parseTaskLine("- [ ] Read paper ⏱ 45m", "t.md", 1)!;
check("duration alone", estimate.duration, 45);
check("no start time", estimate.startTime, undefined);

// Emoji typed with a variation selector must still parse.
const vs16 = parseTaskLine("- [ ] Gym ⏱️ 30m", "t.md", 2)!;
check("variation selector tolerated", vs16.duration, 30);
check("variation selector title clean", vs16.title, "Gym");

// Garbage after a marker falls back into the description rather than vanishing.
const garbage = parseTaskLine("- [ ] Call mum ⏰ sometime", "t.md", 3)!;
check("unparseable time ignored", garbage.startTime, undefined);
check("unparseable time kept in title", garbage.title, "Call mum sometime");

// ── recurrence ───────────────────────────────────────────────────────────

check("daily", parseRecurrence("every day")?.freq, "daily");
check("interval days", parseRecurrence("every 3 days")?.interval, 3);
check("weekday preset", parseRecurrence("every weekday")?.weekdays, [1, 2, 3, 4, 5]);
check("weekend preset", parseRecurrence("every weekend")?.weekdays, [0, 6]);
check("named weekdays", parseRecurrence("every Mon, Wed, Fri")?.weekdays, [1, 3, 5]);
check("weekly interval", parseRecurrence("every 2 weeks")?.interval, 2);
check("monthly on day", parseRecurrence("every month on the 15th")?.monthDay, 15);
check("when done flag", parseRecurrence("every day when done")?.whenDone, true);
check("describe weekdays", describeRecurrence(parseRecurrence("every Mon, Wed")!), "every Mon, Wed");

// Daily series across a week.
check(
	"daily occurrences",
	occurrencesBetween(parseRecurrence("every day")!, "2026-07-19", fromKey("2026-07-19"), fromKey("2026-07-23")),
	["2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"],
);

// Every 3 days keeps its phase.
check(
	"interval occurrences",
	occurrencesBetween(parseRecurrence("every 3 days")!, "2026-07-19", fromKey("2026-07-19"), fromKey("2026-07-28")),
	["2026-07-19", "2026-07-22", "2026-07-25", "2026-07-28"],
);

// 2026-07-19 is a Sunday; Mon/Wed should land on 20th and 22nd.
check(
	"weekday occurrences",
	occurrencesBetween(parseRecurrence("every Mon, Wed")!, "2026-07-19", fromKey("2026-07-19"), fromKey("2026-07-30")),
	["2026-07-20", "2026-07-22", "2026-07-27", "2026-07-29"],
);

// Monthly clamps to the last valid day, then RECOVERS the anchor day —
// a February clamp must not drag every later month down with it.
check(
	"monthly clamp does not drift",
	occurrencesBetween(parseRecurrence("every month")!, "2026-01-31", fromKey("2026-01-31"), fromKey("2026-05-31")),
	["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
);

// Leap day: 2028 is a leap year, so Feb 29 exists there but not in 2027.
check(
	"yearly leap day",
	occurrencesBetween(parseRecurrence("every year")!, "2028-02-29", fromKey("2028-02-29"), fromKey("2030-03-01")),
	["2028-02-29", "2029-03-01", "2030-03-01"],
);

// Explicit day-of-month rules clamp per month without drifting.
check(
	"monthly on the 31st",
	occurrencesBetween(parseRecurrence("every month on the 31st")!, "2026-01-31", fromKey("2026-01-01"), fromKey("2026-04-30")),
	["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
);

// A long-running daily series must still be fast and correct far from anchor.
const longRun = occurrencesBetween(
	parseRecurrence("every day")!, "2020-01-01", fromKey("2026-07-19"), fromKey("2026-07-21"),
);
check("long series stays aligned", longRun, ["2026-07-19", "2026-07-20", "2026-07-21"]);

// The "month of prep before an event" case the user asked for.
const prep = occurrencesBetween(
	parseRecurrence("every day")!,
	"2026-08-02",
	fromKey("2026-08-02"),
	fromKey("2026-12-31"),
	"2026-09-01", // linked event date
);
check("prep series starts at anchor", prep[0], "2026-08-02");
check("prep series stops at event", prep[prep.length - 1], "2026-09-01");
check("prep series length", prep.length, 31);

// A range starting after the anchor still gets the right phase.
check(
	"range offset from anchor",
	occurrencesBetween(parseRecurrence("every 7 days")!, "2026-07-01", fromKey("2026-08-01"), fromKey("2026-08-31")),
	["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"],
);

// ── recurrence picker round trip ─────────────────────────────────────────
//
// The picker builds rule TEXT from structured state, and that text is what
// lands in the markdown. If it doesn't parse back to the same rule, a task
// silently changes schedule the next time it's read. Cover every shape the
// picker can emit.

check("build daily", buildRecurrenceText({ freq: "daily", interval: 1, weekdays: [], whenDone: false }), "every day");
check("build daily interval", buildRecurrenceText({ freq: "daily", interval: 3, weekdays: [], whenDone: false }), "every 3 days");
check("build weekly days", buildRecurrenceText({ freq: "weekly", interval: 1, weekdays: [1, 3], whenDone: false }), "every week on Mon, Wed");
check("build weekly interval days", buildRecurrenceText({ freq: "weekly", interval: 2, weekdays: [1, 5], whenDone: false }), "every 2 weeks on Mon, Fri");
check("build monthly day", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 15, whenDone: false }), "every month on the 15th");
check("build when done", buildRecurrenceText({ freq: "daily", interval: 1, weekdays: [], whenDone: true }), "every day when done");
check("ordinal 1", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 1, whenDone: false }), "every month on the 1st");
check("ordinal 2", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 2, whenDone: false }), "every month on the 2nd");
check("ordinal 3", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 3, whenDone: false }), "every month on the 3rd");
check("ordinal 11 is th", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 11, whenDone: false }), "every month on the 11th");
check("ordinal 21 is st", buildRecurrenceText({ freq: "monthly", interval: 1, weekdays: [], monthDay: 21, whenDone: false }), "every month on the 21st");

const WEEKDAY_SETS = [[], [0], [1, 3], [1, 2, 3, 4, 5], [0, 6], [0, 1, 2, 3, 4, 5, 6]];
let roundTrips = 0;

for (const freq of ["daily", "weekly", "monthly", "yearly"] as const) {
	for (const interval of [1, 2, 7]) {
		for (const whenDone of [false, true]) {
			const weekdaySets = freq === "weekly" ? WEEKDAY_SETS : [[]];
			const monthDays = freq === "monthly" ? [undefined, 1, 15, 28, 31] : [undefined];

			for (const weekdays of weekdaySets) {
				for (const monthDay of monthDays) {
					const built = { freq, interval, weekdays, monthDay, whenDone };
					const text = buildRecurrenceText(built);
					const back = parseRecurrence(text);

					if (
						back?.freq !== freq ||
						back.interval !== interval ||
						back.whenDone !== whenDone ||
						JSON.stringify(back.weekdays) !== JSON.stringify(weekdays) ||
						back.monthDay !== monthDay
					) {
						failed++;
						console.error(`✗ round trip "${text}"\n    built: ${JSON.stringify(built)}\n    back:  ${JSON.stringify(back)}`);
					} else {
						roundTrips++;
					}
				}
			}
		}
	}
}

check(`picker round trips (${roundTrips} combinations)`, roundTrips > 0 && failed === 0, true);

// A rule built by the picker must actually generate the dates it promises.
const built = parseRecurrence(
	buildRecurrenceText({ freq: "weekly", interval: 2, weekdays: [1, 4], whenDone: false }),
)!;
check(
	"picker rule generates correctly",
	occurrencesBetween(built, "2026-07-20", fromKey("2026-07-20"), fromKey("2026-08-14")),
	["2026-07-20", "2026-07-23", "2026-08-03", "2026-08-06"],
);

// ── date format ──────────────────────────────────────────────────────────

check("format ISO", formatDate("2026-07-21", "YYYY-MM-DD"), "2026-07-21");
check("format day first", formatDate("2026-07-21", "DD/MM/YYYY"), "21/07/2026");
check("format month first", formatDate("2026-07-21", "MM/DD/YYYY"), "07/21/2026");
check("format leaves non-dates alone", formatDate("", "DD/MM/YYYY"), "");

check("parse day first", parseDateInput("21/07/2026", "DD/MM/YYYY"), "2026-07-21");
check("parse month first", parseDateInput("07/21/2026", "MM/DD/YYYY"), "2026-07-21");
check("parse ISO regardless of format", parseDateInput("2026-07-21", "MM/DD/YYYY"), "2026-07-21");
check("parse tolerates dashes", parseDateInput("21-07-2026", "DD/MM/YYYY"), "2026-07-21");
check("parse tolerates dots", parseDateInput("21.07.2026", "DD/MM/YYYY"), "2026-07-21");
check("parse tolerates single digits", parseDateInput("1/7/2026", "DD/MM/YYYY"), "2026-07-01");
check("parse expands two-digit year", parseDateInput("21/07/26", "DD/MM/YYYY"), "2026-07-21");

// An out-of-range first part can only be the day, whatever the setting says.
check("parse disambiguates by range", parseDateInput("21/07/2026", "MM/DD/YYYY"), "2026-07-21");
check("parse ambiguous follows setting", parseDateInput("07/08/2026", "DD/MM/YYYY"), "2026-08-07");
check("parse ambiguous follows setting (US)", parseDateInput("07/08/2026", "MM/DD/YYYY"), "2026-07-08");

check("parse rejects rubbish", parseDateInput("not a date", "DD/MM/YYYY"), null);
check("parse rejects empty", parseDateInput("   ", "DD/MM/YYYY"), null);
check("parse rejects month 13", parseDateInput("13/13/2026", "DD/MM/YYYY"), null);
// Date() would silently roll 31 February into March; the parser must not.
check("parse rejects overflow day", parseDateInput("31/02/2026", "DD/MM/YYYY"), null);
check("parse rejects partial", parseDateInput("21/07", "DD/MM/YYYY"), null);

// Round trip: whatever is shown must read back to the same key.
{
	let roundTripped = 0;
	let broke = 0;
	for (const fmt of ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const) {
		for (let i = 0; i < 400; i++) {
			const key = toKey(addDays(fromKey("2026-01-01"), i));
			if (parseDateInput(formatDate(key, fmt), fmt) === key) roundTripped++;
			else broke++;
		}
	}
	check(`date round trips (${roundTripped} dates)`, broke === 0 && roundTripped === 1200, true);
}

check("short date is day first", formatShort(fromKey("2026-07-21"), "DD/MM/YYYY"), "Tue, 21 Jul");
check("short date is month first", formatShort(fromKey("2026-07-21"), "MM/DD/YYYY"), "Tue, Jul 21");

// ── weekend days ─────────────────────────────────────────────────────────

check("western weekend", isWeekend(fromKey("2026-07-19"), [6, 0]), true); // Sunday
check("western weekday", isWeekend(fromKey("2026-07-21"), [6, 0]), false); // Tuesday
check("gulf weekend includes Friday", isWeekend(fromKey("2026-07-24"), [5, 6]), true);
check("gulf weekend excludes Sunday", isWeekend(fromKey("2026-07-19"), [5, 6]), false);
check("single-day weekend", isWeekend(fromKey("2026-07-25"), [5]), false); // Saturday
check("empty weekend shades nothing", isWeekend(fromKey("2026-07-19"), []), false);

// ── recurring completion / un-completion ─────────────────────────────────

// Checking a repeat off writes a plain completed copy and rolls the master
// forward. Both lines share a series key, which is what lets un-checking
// find the master again and put it back.
{
	const master = parseTaskLine(
		"- [ ] Change Icons \u23eb \ud83d\udd01 every day \ud83c\udfc1 2026-07-21 \u2795 2026-07-20 \ud83d\udcc5 2026-07-21",
		"Calendar/Tasks.md",
		3,
	)!;
	const copy = parseTaskLine(
		"- [ ] Change Icons \u23eb \u2795 2026-07-20 \ud83d\udcc5 2026-07-20",
		"Calendar/Tasks.md",
		2,
	)!;

	check("master keeps its recurrence", master.recurrence?.raw, "every day");
	check("master keeps its end date", master.until, "2026-07-21");
	check("master rolled to the next date", master.due, "2026-07-21");

	// The copy is deliberately plain — that is why editing it showed "Never".
	check("completed copy carries no recurrence", copy.recurrence, undefined);
	check("completed copy carries no end date", copy.until, undefined);

	check("copy and master share a series key", seriesKey(copy) === seriesKey(master), true);

	// A different task in the same note must not be mistaken for the master.
	const other = parseTaskLine("- [ ] Ali CV \u23eb \ud83d\udcc5 2026-07-20", "Calendar/Tasks.md", 4)!;
	check("unrelated task has a different series key", seriesKey(other) === seriesKey(master), false);
}

// ── repeat modes: habit vs one job ───────────────────────────────────────

{
	const PIN = "\ud83d\udccc";

	// A habit — no pin marker, so every occurrence stands alone.
	const habit = parseTaskLine(
		"- [ ] English \ud83d\udd01 every day \ud83d\udcc5 2026-07-20",
		"Calendar/Tasks.md",
		0,
	)!;
	check("habit repeats independently", habit.untilDone, undefined);
	check("habit keeps its recurrence", habit.recurrence?.raw, "every day");

	// One job, reminded about daily until it's finished.
	const job = parseTaskLine(
		`- [ ] Write report \ud83d\udd01 every day ${PIN} \ud83c\udfc1 2026-07-22 \ud83d\udcc5 2026-07-20`,
		"Calendar/Tasks.md",
		1,
	)!;
	check("one-job repeat is flagged", job.untilDone, true);
	check("one-job repeat keeps its rule", job.recurrence?.raw, "every day");
	check("one-job repeat keeps its deadline", job.until, "2026-07-22");
	check("flag is not swallowed into the title", job.title, "Write report");

	// The flag must survive a write-back untouched.
	check("one-job repeat round trips", parseTaskLine(serializeTask(job), "x", 0)!.untilDone, true);
	check("habit round trips", parseTaskLine(serializeTask(habit), "x", 0)!.untilDone, undefined);

	// Without a repeat the flag is meaningless, so it is never written.
	const plain = { ...habit, recurrence: undefined, untilDone: true };
	check("flag is dropped from non-repeating tasks", serializeTask(plain).includes(PIN), false);

	// A pin in the description text must not be read as the flag... it is a
	// marker like any other, so it is consumed — document that trade-off.
	const serialized = serializeTask(job);
	check("flag is written once", serialized.split(PIN).length - 1, 1);
}

// ── task descriptions ────────────────────────────────────────────────────

{
	const doc = [
		"- [ ] Book the flights \ud83d\udcc5 2026-08-01",
		"\tWindow seat if possible.",
		"\tSee [[Trip planning]] for the budget.",
		"- [ ] Pack",
	];
	const block = readDescription(doc, 0);
	check("description text", block.text, "Window seat if possible.\nSee [[Trip planning]] for the budget.");
	check("description line count", block.lines, 2);
	check("next task has none", readDescription(doc, 3).lines, 0);

	// A nested checkbox is a subtask, not prose.
	check("nested task ends the block", readDescription([
		"- [ ] Parent",
		"\tcontext line",
		"\t- [ ] Child",
		"\tnot mine",
	], 0), { text: "context line", lines: 1 });

	// Interior blank lines are kept; trailing ones are not.
	check("interior blank kept", readDescription([
		"- [ ] T",
		"\tone",
		"",
		"\ttwo",
		"",
		"- [ ] Next",
	], 0), { text: "one\n\ntwo", lines: 3 });

	// Deeper indentation inside the block is preserved relative to the block.
	check("relative indent preserved", readDescription([
		"- [ ] T",
		"\tsteps:",
		"\t\t- one",
	], 0).text, "steps:\n\t- one");

	// An indented task keeps its own deeper continuation.
	check("indented task", readDescription([
		"\t- [ ] Sub",
		"\t\tdetail",
		"\tsibling text",
	], 0), { text: "detail", lines: 1 });

	check("no description", readDescription(["- [ ] Bare", "- [ ] Other"], 0), { text: "", lines: 0 });
	check("end of file", readDescription(["- [ ] Bare"], 0).lines, 0);

	// Round trip through the writer.
	check("write indents under the task", writeDescription("a\nb", ""), ["\ta", "\tb"]);
	check("write nests under an indented task", writeDescription("a", "\t"), ["\t\ta"]);
	check("write drops empty", writeDescription("   \n  ", ""), []);

	const text = "line one\n\nline two";
	const written = writeDescription(text, "");
	check("description round trips", readDescription(["- [ ] T", ...written], 0).text, text);
}

// ── natural language dates ───────────────────────────────────────────────

{
	// Monday 2026-07-20 as the reference day throughout.
	const mon = fromKey("2026-07-20");

	check("today", parseNaturalDate("today", mon), "2026-07-20");
	check("tomorrow", parseNaturalDate("Tomorrow", mon), "2026-07-21");
	check("yesterday", parseNaturalDate("yesterday", mon), "2026-07-19");
	check("in 3 days", parseNaturalDate("in 3 days", mon), "2026-07-23");
	check("in 2 weeks", parseNaturalDate("in 2 weeks", mon), "2026-08-03");
	check("in 1 month", parseNaturalDate("in 1 month", mon), "2026-08-20");
	check("3 days ago", parseNaturalDate("3 days ago", mon), "2026-07-17");
	check("next week", parseNaturalDate("next week", mon), "2026-07-27");
	check("next month", parseNaturalDate("next month", mon), "2026-08-20");
	check("end of month", parseNaturalDate("end of month", mon), "2026-07-31");

	// A bare weekday and "next <weekday>" both mean the coming one.
	check("friday", parseNaturalDate("friday", mon), "2026-07-24");
	check("next friday", parseNaturalDate("next friday", mon), "2026-07-24");
	check("fri short form", parseNaturalDate("fri", mon), "2026-07-24");
	check("last friday", parseNaturalDate("last friday", mon), "2026-07-17");

	// Naming today's own weekday means a week out, not today — except for
	// "this monday", where staying put is what people mean.
	check("monday from monday", parseNaturalDate("monday", mon), "2026-07-27");
	check("this monday from monday", parseNaturalDate("this monday", mon), "2026-07-20");
	check("last monday from monday", parseNaturalDate("last monday", mon), "2026-07-13");

	check("case and spacing", parseNaturalDate("  NEXT   Friday ", mon), "2026-07-24");

	// Anything unrecognised must fail rather than guess.
	check("rejects nonsense", parseNaturalDate("someday", mon), undefined);
	check("rejects empty", parseNaturalDate("", mon), undefined);
	check("rejects partial phrase", parseNaturalDate("in 3", mon), undefined);
	check("rejects a bare number", parseNaturalDate("5", mon), undefined);
}

// ── 🏁 must not be claimed: it is the Tasks plugin's "On Completion" ──────

{
	const OLD = "\ud83c\udfc1";   // 🏁 — Tasks' On Completion signifier
	const NEW = "\ud83d\udd1a";   // 🔚 — our recurrence end date

	// Notes already written with 🏁 <date> still read correctly.
	const legacy = parseTaskLine(
		`- [ ] Report \ud83d\udd01 every day ${OLD} 2026-07-21 \ud83d\udcc5 2026-07-20`,
		"n.md", 0,
	)!;
	check("legacy end date still parses", legacy.until, "2026-07-21");
	check("legacy marker leaves no residue in the title", legacy.title, "Report");

	// ...but it is rewritten to our own marker on the next save.
	const rewritten = serializeTask(legacy);
	check("writes the new marker", rewritten.includes(`${NEW} 2026-07-21`), true);
	check("stops writing the Tasks marker", rewritten.includes(OLD), false);
	check("new marker round trips", parseTaskLine(rewritten, "n.md", 0)!.until, "2026-07-21");

	// A genuine Tasks "On Completion" action must survive untouched.
	const onCompletion = parseTaskLine(`- [ ] Tidy up ${OLD} delete \ud83d\udcc5 2026-07-20`, "n.md", 0)!;
	check("on-completion is not read as an end date", onCompletion.until, undefined);
	check("on-completion survives in the line", onCompletion.title.includes(`${OLD} delete`), true);
	check("on-completion keeps its due date", onCompletion.due, "2026-07-20");
	check(
		"on-completion round trips",
		parseTaskLine(serializeTask(onCompletion), "n.md", 0)!.title.includes(`${OLD} delete`),
		true,
	);
}

// ── per-task emoji ───────────────────────────────────────────────────────

{
	check("splits a leading emoji", splitEmoji("\ud83d\udcda Read chapter 4"),
		{ emoji: "\ud83d\udcda", text: "Read chapter 4" });
	check("no emoji", splitEmoji("Read chapter 4"), { text: "Read chapter 4" });
	check("emoji only", splitEmoji("\ud83d\udcda"), { emoji: "\ud83d\udcda", text: "" });
	check("mid-title emoji is left alone", splitEmoji("Read \ud83d\udcda now").emoji, undefined);

	// Multi-codepoint emoji must not be sliced apart.
	check("zwj sequence stays whole", splitEmoji("\ud83d\udc68\u200d\ud83d\udcbb Ship it").emoji,
		"\ud83d\udc68\u200d\ud83d\udcbb");
	check("skin tone stays whole", splitEmoji("\ud83d\udc4d\ud83c\udffd Approve").emoji,
		"\ud83d\udc4d\ud83c\udffd");
	check("variation selector stays whole", splitEmoji("\u2764\ufe0f Call mum").text, "Call mum");

	// A metadata marker at the start is data, never decoration.
	check("due marker is not an icon", splitEmoji("\ud83d\udcc5 2026-01-01").emoji, undefined);
	check("priority marker is not an icon", splitEmoji("\u23eb Urgent thing").emoji, undefined);

	check("adds an icon", withEmoji("Read", "\ud83d\udcda"), "\ud83d\udcda Read");
	check("replaces an icon", withEmoji("\ud83d\udcda Read", "\ud83c\udfc3"), "\ud83c\udfc3 Read");
	check("clears an icon", withEmoji("\ud83d\udcda Read", undefined), "Read");
	check("refuses a reserved marker", withEmoji("Read", "\ud83d\udcc5"), "Read");
	check("round trips", splitEmoji(withEmoji("Read", "\u2b50")), { emoji: "\u2b50", text: "Read" });

	check("accepts a single emoji", isUsableEmoji("\ud83d\ude80"), true);
	check("rejects two emoji", isUsableEmoji("\ud83d\ude80\ud83d\ude80"), false);
	check("rejects plain text", isUsableEmoji("hi"), false);
	check("rejects a reserved marker", isUsableEmoji("\ud83d\udd01"), false);
	check("rejects empty", isUsableEmoji("  "), false);

	// The palette must never offer something that would be refused.
	const offered = EMOJI_PALETTE.flatMap((g) => g.emoji);
	check("palette has no reserved markers", offered.some((e) => RESERVED_EMOJI.has(e)), false);
	check("every palette entry is usable", offered.every(isUsableEmoji), true);
	check("palette is non-empty", offered.length > 40, true);
}

// ── note picker paths ────────────────────────────────────────────────────

{
	// A bare name is filed in the calendar folder rather than the vault root.
	check("bare name lands in the folder", resolveNotePath("Groceries", "Calendar"), "Calendar/Groceries.md");
	check("adds the extension", resolveNotePath("Groceries.md", "Calendar"), "Calendar/Groceries.md");
	check("extension case is respected", resolveNotePath("Notes.MD", "Calendar"), "Calendar/Notes.MD");

	// Any slash means the location was chosen deliberately.
	check("explicit path is left alone", resolveNotePath("Work/Sprint", "Calendar"), "Work/Sprint.md");
	check("leading slash is trimmed", resolveNotePath("/Work/Sprint", "Calendar"), "Work/Sprint.md");
	check("no default folder", resolveNotePath("Groceries", ""), "Groceries.md");

	// Characters Obsidian refuses must never reach the vault.
	check("illegal characters stripped", resolveNotePath('Re:port*?"', "Calendar"), "Calendar/Report.md");
	check("empty input", resolveNotePath("   ", "Calendar"), undefined);
	check("only illegal characters", resolveNotePath("??", "Calendar"), undefined);
	check("collapses empty segments", resolveNotePath("a//b", "Calendar"), "a/b.md");

	check("basename", noteBasename("Calendar/Tasks.md"), "Tasks");
	check("basename at root", noteBasename("Tasks.md"), "Tasks");
	check("folder", noteFolder("Calendar/Sub/Tasks.md"), "Calendar/Sub");
	check("folder at root", noteFolder("Tasks.md"), "");

	// Ranking: an exact name must beat a folder that merely contains the word.
	check("exact name wins", scoreNote("Calendar/Tasks.md", "tasks") > scoreNote("Tasks/Other.md", "tasks"), true);
	check("prefix beats contains",
		scoreNote("A/Taskboard.md", "task") > scoreNote("A/Mytask.md", "task"), true);
	check("path match still counts", scoreNote("Work/Notes.md", "work") > 0, true);
	check("subsequence match", scoreNote("Calendar/Tasks.md", "cltk") > 0, true);
	check("no match", scoreNote("Calendar/Tasks.md", "zzzz"), 0);
	check("empty query matches everything", scoreNote("Anything.md", ""), 1);
	check("case insensitive", scoreNote("Calendar/TASKS.md", "tasks"), 100);
}

// ── result ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
