/** Pure tag helpers — no Obsidian import, so they're unit testable. */

import type { Priority } from "./types";

/**
 * Tags that still carry settings but no longer appear on any task.
 *
 * These must not sit in the main tag list: a tag the user has deleted from
 * their notes should disappear from it immediately. They're surfaced
 * separately so the leftover settings can be removed rather than lingering
 * unreachable in data.json.
 */
export function findOrphanedTags(
	tagColors: Record<string, string>,
	tagPriorities: Record<string, Priority>,
	discovered: string[],
): string[] {
	const known = new Set(discovered);
	return [...new Set([...Object.keys(tagColors), ...Object.keys(tagPriorities)])]
		.filter((tag) => !known.has(tag))
		.sort();
}

/** Normalises user input to a leading-# tag. */
export function normaliseTag(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return "";
	return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
