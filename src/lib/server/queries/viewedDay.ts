/**
 * Resolve which calendar day the Home / Today views render, from the
 * `?date=YYYY-MM-DD` query param, plus the surrounding navigation keys. A
 * missing / invalid / future param falls back to today, so those views keep
 * their live path; a valid past key drives the actuals-only path. Back
 * navigation is capped at the earliest logged sleep (`minKey`).
 */
import { localDateKey, shiftDateKey } from './day';
import { earliestDayKey } from './sleeps';
import { fmtDayHeading } from '$lib/format';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ViewedDay {
	/** The 'YYYY-MM-DD' day the page should render (today or a past day). */
	viewedDayKey: string;
	/** Today's key in the display zone. */
	todayKey: string;
	isToday: boolean;
	/** Previous day, or null when it would precede the earliest logged sleep. */
	prevKey: string | null;
	/** Next day, or null when already on today (no future navigation). */
	nextKey: string | null;
	/** Earliest selectable day (day of the earliest logged sleep), or null. */
	minKey: string | null;
	/** Heading label for `viewedDayKey`, e.g. 'Wed 9 Jul 2026'. */
	label: string;
}

/**
 * Heading label for a 'YYYY-MM-DD' key. A calendar date carries no instant, so
 * we format a fixed UTC-noon reference in UTC — the weekday/day/month/year are
 * the key's own, independent of any display zone.
 */
function keyLabel(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	return fmtDayHeading(Date.UTC(y, m - 1, d, 12), 'UTC');
}

/** Resolve the viewed day + navigation keys for a page load. */
export function resolveViewedDay(
	dateParam: string | null | undefined,
	timeZone: string
): ViewedDay {
	const todayKey = localDateKey(Date.now(), timeZone);
	const minKey = earliestDayKey(timeZone);
	// Honour only a well-formed, non-future key; anything else renders today.
	const requested = dateParam && KEY_RE.test(dateParam) ? dateParam : todayKey;
	const viewedDayKey = requested > todayKey ? todayKey : requested;
	const isToday = viewedDayKey === todayKey;

	// Lexicographic compare on 'YYYY-MM-DD' is chronological.
	const prev = shiftDateKey(viewedDayKey, -1);
	const prevKey = minKey == null || prev < minKey ? null : prev;
	// Never future: when not today, viewedDayKey < todayKey, so +1 day ≤ today.
	const nextKey = isToday ? null : shiftDateKey(viewedDayKey, 1);

	return {
		viewedDayKey,
		todayKey,
		isToday,
		prevKey,
		nextKey,
		minKey,
		label: keyLabel(viewedDayKey)
	};
}
