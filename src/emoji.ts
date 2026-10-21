/**
 * Per-task emoji.
 *
 * The emoji is simply the first character of the task's description, so
 * it needs no marker of its own and shows up correctly in any other
 * plugin, in search, and in the raw markdown. That does mean it shares a
 * namespace with the metadata markers, so anything the parser treats as
 * a field is refused — picking 📅 as your icon would otherwise turn into
 * a due date the next time the line was read.
 */

import { LEGACY_UNTIL, PRIORITIES, PRIORITY_EMOJI, SYM } from "./types";

/** Emoji that mean something to the parser and so can't be used as icons. */
export const RESERVED_EMOJI = new Set<string>([
	...Object.values(SYM),
	LEGACY_UNTIL,
	...PRIORITIES.filter((p) => p !== "none").map((p) => PRIORITY_EMOJI[p]),
]);

/**
 * A leading pictograph, plus any variation selector, zero-width joiner
 * sequence or skin-tone modifier that belongs with it — so 👨‍💻 and 👍🏽
 * are each treated as one character rather than being sliced apart.
 */
const LEADING_EMOJI =
	/^(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/u;

export interface TitleParts {
	/** The icon, or undefined when the title doesn't start with one. */
	emoji?: string;
	/** The title with the icon removed. */
	text: string;
}

/** Splits a leading icon off a task title. */
export function splitEmoji(title: string): TitleParts {
	const trimmed = title.trim();
	const m = trimmed.match(LEADING_EMOJI);
	if (!m) return { text: trimmed };

	const emoji = m[1];
	// A metadata marker at the start is data, not decoration.
	if (RESERVED_EMOJI.has(emoji)) return { text: trimmed };

	return { emoji, text: trimmed.slice(emoji.length).trim() };
}

/** Sets, replaces, or (with no emoji) clears a title's leading icon. */
export function withEmoji(title: string, emoji?: string): string {
	const { text } = splitEmoji(title);
	if (!emoji || RESERVED_EMOJI.has(emoji)) return text;
	return `${emoji} ${text}`.trim();
}

/** True when the string is a single usable icon. */
export function isUsableEmoji(input: string): boolean {
	const s = input.trim();
	if (!s || RESERVED_EMOJI.has(s)) return false;
	const m = s.match(LEADING_EMOJI);
	return !!m && m[1] === s;
}

/**
 * A small curated palette — enough to label the common kinds of work
 * without becoming a full emoji keyboard. Anything else can be typed or
 * pasted into the field beside it.
 */
export const EMOJI_PALETTE: { group: string; emoji: string[] }[] = [
	{ group: "Work", emoji: ["💼", "📊", "📈", "🖥", "⌨️", "🗂", "📎", "🧾", "📁", "🖊"] },
	{ group: "Study", emoji: ["📚", "✏️", "🎓", "🔬", "🧪", "🧠", "📖", "🗒", "🔖", "💡"] },
	{ group: "Life", emoji: ["🏠", "🛒", "🍳", "🧺", "🧹", "🐈", "🌱", "🔧", "💊", "🩺"] },
	{ group: "Health", emoji: ["🏃", "🏋️", "🧘", "🚴", "⚽", "🥗", "💧", "😴", "🦷", "❤️"] },
	{ group: "Social", emoji: ["👥", "📞", "💬", "🎉", "🎁", "🍽", "✈️", "🚗", "🎬", "🎵"] },
	// No 🎯 / ⏳ / ⏰ / 📌 here — those are metadata markers, so they are
	// filtered out anyway and would only render as dead buttons.
	{ group: "Signals", emoji: ["⭐", "🔥", "⚡", "🚧", "🐛", "🧩", "🔑", "💰", "🏆", "❗"] },
].map((g) => ({ ...g, emoji: g.emoji.filter((e) => !RESERVED_EMOJI.has(e)) }));
