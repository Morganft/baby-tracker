import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';
import { project } from '$lib/projection/project';
import { groupDay, groupDayForKey, completedProjection } from '$lib/server/queries/day';
import type { TemplateConfig } from '$lib/projection/types';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({ goto: () => {} }));

const TZ = 'UTC';
// epoch-ms for a clock time on a given day of July 2026 (UTC).
const on = (day: number, hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return Date.UTC(2026, 6, day, h, m);
};
const at = (hhmm: string) => on(9, hhmm);

const template: TemplateConfig = {
	referenceWakeTime: '07:00',
	napCount: 2,
	wakeWindows: [120, 150, 240],
	expectedNapDurations: [90, 60]
};

const sleepEntry = (over: Partial<PageData['entries'][string]> & { id: string }) => ({
	startTime: 0,
	endTime: null,
	startTimezone: TZ,
	endTimezone: null,
	type: 'night' as const,
	location: null,
	putDown: null,
	notes: null,
	nightWakings: [],
	createdAt: 0,
	updatedAt: 0,
	...over
});

// Faithful to today's server load path: the same grouping + projection the page
// server runs, given a single logged bedtime (tonight, in progress) and nothing else.
function todayWithOnlyBedtime(): PageData {
	const now = at('18:05');
	const entries = [{ id: 'night', type: 'night' as const, start: at('18:00'), end: null }];
	const g = groupDay(entries, now, TZ);
	const projection = project({
		now,
		timeZone: TZ,
		template,
		settings: { shortNapThresholdMin: 15, shortNapReductionPercent: 30 },
		sleeps: g.sleeps,
		morningWake: g.morningWake
	});

	return {
		viewedDayKey: '2026-07-09',
		todayKey: '2026-07-09',
		isToday: true,
		prevKey: '2026-07-08',
		nextKey: null,
		minKey: '2026-07-01',
		label: 'Thu 9 Jul 2026',
		now,
		timeZone: TZ,
		clock24h: true,
		templateName: 'Test plan',
		entryZones: {},
		entries: { night: sleepEntry({ id: 'night', startTime: at('18:00') }) },
		overnightEntryId: g.overnightEntryId,
		overnightDraft: { start: projection.anchor - 12 * 3_600_000, end: projection.anchor },
		overrideActive: false,
		plan: template,
		projection
	} as unknown as PageData;
}

// Today, awake past the first wake window: a morning wake at 07:00, no naps yet,
// and it's now 09:45 — 45m past the 09:00 the first nap was due. The projected tail
// is still editable (bedtime not logged), so the current awake block should grow to
// the now-line and the rest of the day cascade from there.
function todayAwakePastWindow(): PageData {
	const now = at('09:45');
	const entries = [
		{ id: 'lastnight', type: 'night' as const, start: on(8, '19:00'), end: at('07:00') }
	];
	const g = groupDay(entries, now, TZ);
	const projection = project({
		now,
		timeZone: TZ,
		template,
		settings: { shortNapThresholdMin: 15, shortNapReductionPercent: 30 },
		sleeps: g.sleeps,
		morningWake: g.morningWake
	});

	return {
		viewedDayKey: '2026-07-09',
		todayKey: '2026-07-09',
		isToday: true,
		prevKey: '2026-07-08',
		nextKey: null,
		minKey: '2026-07-01',
		label: 'Thu 9 Jul 2026',
		now,
		timeZone: TZ,
		clock24h: true,
		templateName: 'Test plan',
		entryZones: {},
		entries: {},
		overnightEntryId: g.overnightEntryId,
		overnightDraft: { start: projection.anchor - 12 * 3_600_000, end: projection.anchor },
		overrideActive: false,
		plan: template,
		projection
	} as unknown as PageData;
}

// Faithful to the PAST-day server load path: real `groupDayForKey` + the exported
// `completedProjection`, fed the morning reference (07:00) as its fallback anchor
// exactly as `+page.server.ts` does. The only entries are last night's still-open
// overnight (no morning wake recorded) and today's bedtime — no naps.
function pastDayWithOnlyBedtime(): PageData {
	const entries = [
		{ id: 'lastnight', type: 'night' as const, start: on(8, '19:00'), end: null },
		{ id: 'night', type: 'night' as const, start: at('18:00'), end: null }
	];
	const grouping = groupDayForKey(entries, '2026-07-09', TZ);
	const fallbackAnchor = at('07:00'); // resolved morning reference for the viewed day
	const projection = completedProjection(grouping, 15, fallbackAnchor);

	return {
		viewedDayKey: '2026-07-09',
		todayKey: '2026-07-10',
		isToday: false,
		prevKey: '2026-07-08',
		nextKey: '2026-07-10',
		minKey: '2026-07-01',
		label: 'Thu 9 Jul 2026',
		now: at('23:59'),
		timeZone: TZ,
		clock24h: true,
		templateName: 'Test plan',
		entryZones: {},
		entries: {
			night: sleepEntry({ id: 'night', startTime: at('18:00') }),
			lastnight: sleepEntry({ id: 'lastnight', startTime: on(8, '19:00') })
		},
		overnightEntryId: grouping.overnightEntryId,
		overnightDraft: null,
		overrideActive: false,
		plan: null,
		projection
	} as unknown as PageData;
}

/** The absolute-positioned block whose label contains `text`, or undefined. */
function blockTop(container: HTMLElement, text: string): number | undefined {
	return blockBox(container, text)?.top;
}

// Every sleep/awake block stacks two text rows: a label ("Nap N", `text-sm`) and a
// time/duration row ("HH:MM–HH:MM · Dur", also carrying a `text-sm` figure). Each row
// is ~20px, so a block needs ~40px to show both without the second being clipped by
// its `overflow-hidden`. The warped axis guarantees every block at least this tall.
const MIN_TWO_LINE_PX = 40;

/** Top + rendered height (px, from the inline style) of the block labelled `text`. */
function blockBox(
	container: HTMLElement,
	text: string
): { top: number; height: number } | undefined {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[style*="top:"]')).find((n) =>
		n.textContent?.includes(text)
	);
	const style = el?.getAttribute('style') ?? '';
	const top = style.match(/top:\s*([\d.]+)px/);
	const height = style.match(/height:\s*([\d.]+)px/);
	return top && height ? { top: Number(top[1]), height: Number(height[1]) } : undefined;
}

// A past day whose log is a normal morning wake, one very short nap (≤ the 15-min
// short-nap threshold) and one full-length nap. Built through the real past-day
// path (`groupDayForKey` + `completedProjection`) so the short nap renders as a
// genuine `completed` block, exactly as the server would emit it.
function pastDayWithShortNap(): PageData {
	const entries = [
		{ id: 'lastnight', type: 'night' as const, start: on(8, '19:00'), end: at('07:00') },
		{ id: 'shortnap', type: 'nap' as const, start: at('09:00'), end: at('09:12') }, // 12 min
		{ id: 'longnap', type: 'nap' as const, start: at('12:00'), end: at('13:30') } // 90 min
	];
	const grouping = groupDayForKey(entries, '2026-07-09', TZ);
	const projection = completedProjection(grouping, 15, at('07:00'));

	return {
		viewedDayKey: '2026-07-09',
		todayKey: '2026-07-10',
		isToday: false,
		prevKey: '2026-07-08',
		nextKey: '2026-07-10',
		minKey: '2026-07-01',
		label: 'Thu 9 Jul 2026',
		now: at('23:59'),
		timeZone: TZ,
		clock24h: true,
		templateName: 'Test plan',
		entryZones: {},
		entries: {
			shortnap: sleepEntry({
				id: 'shortnap',
				type: 'nap',
				startTime: at('09:00'),
				endTime: at('09:12')
			}),
			longnap: sleepEntry({
				id: 'longnap',
				type: 'nap',
				startTime: at('12:00'),
				endTime: at('13:30')
			}),
			lastnight: sleepEntry({ id: 'lastnight', startTime: on(8, '19:00'), endTime: at('07:00') })
		},
		overnightEntryId: grouping.overnightEntryId,
		overnightDraft: null,
		overrideActive: false,
		plan: null,
		projection
	} as unknown as PageData;
}

// A past day with three ~10-min naps packed back-to-back (short windows between).
// Every block — naps and the awake gaps — is under the min-height, so the whole run
// stretches the axis rather than collapsing or overlapping.
function pastDayWithShortNapRun(): PageData {
	const entries = [
		{ id: 'lastnight', type: 'night' as const, start: on(8, '19:00'), end: at('07:00') },
		{ id: 'n1', type: 'nap' as const, start: at('09:00'), end: at('09:10') },
		{ id: 'n2', type: 'nap' as const, start: at('09:25'), end: at('09:35') },
		{ id: 'n3', type: 'nap' as const, start: at('09:50'), end: at('10:00') }
	];
	const grouping = groupDayForKey(entries, '2026-07-09', TZ);
	const projection = completedProjection(grouping, 15, at('07:00'));

	return {
		viewedDayKey: '2026-07-09',
		todayKey: '2026-07-10',
		isToday: false,
		prevKey: '2026-07-08',
		nextKey: '2026-07-10',
		minKey: '2026-07-01',
		label: 'Thu 9 Jul 2026',
		now: at('23:59'),
		timeZone: TZ,
		clock24h: true,
		templateName: 'Test plan',
		entryZones: {},
		entries: {
			n1: sleepEntry({ id: 'n1', type: 'nap', startTime: at('09:00'), endTime: at('09:10') }),
			n2: sleepEntry({ id: 'n2', type: 'nap', startTime: at('09:25'), endTime: at('09:35') }),
			n3: sleepEntry({ id: 'n3', type: 'nap', startTime: at('09:50'), endTime: at('10:00') }),
			lastnight: sleepEntry({ id: 'lastnight', startTime: on(8, '19:00'), endTime: at('07:00') })
		},
		overnightEntryId: grouping.overnightEntryId,
		overnightDraft: null,
		overrideActive: false,
		plan: null,
		projection
	} as unknown as PageData;
}

/** Top (px) of the hour-gridline row whose label is exactly `label`, or undefined. */
function gridlineTop(container: HTMLElement, label: string): number | undefined {
	const el = Array.from(container.querySelectorAll<HTMLElement>('[style*="top:"]')).find(
		(n) => n.textContent?.trim() === label
	);
	const m = el?.getAttribute('style')?.match(/top:\s*([\d.]+)px/);
	return m ? Number(m[1]) : undefined;
}

describe('Timeline — past day, only a bedtime logged (no morning wake)', () => {
	it('anchors the day at the morning reference, not the bedtime', () => {
		expect(pastDayWithOnlyBedtime().projection.anchor).toBe(at('07:00'));
	});

	it('does not render the bedtime at the very top — it sits low, leaving a gap above', () => {
		const { container } = render(Page, { props: { data: pastDayWithOnlyBedtime(), form: null } });
		const top = blockTop(container, 'Bedtime');
		expect(top).toBeGreaterThan(300); // was ~42px (collapsed onto the anchor) before the fix
	});

	it('shows the overnight waking at the morning reference, not the bedtime time', () => {
		render(Page, { props: { data: pastDayWithOnlyBedtime(), form: null } });
		const overnight = screen.getByText(/Overnight/).closest('button');
		expect(overnight?.textContent).toMatch(/07:00/);
		expect(overnight?.textContent).not.toMatch(/18:00/);
	});

	it('leaves the stretch above the bedtime unallocated (no Awake block)', () => {
		render(Page, { props: { data: pastDayWithOnlyBedtime(), form: null } });
		expect(screen.queryByText('Awake')).not.toBeInTheDocument();
	});
});

describe('Timeline — Add sleep keeps the viewed day', () => {
	it('carries the viewed day into the Add-sleep link on a past day', () => {
		render(Page, { props: { data: pastDayWithOnlyBedtime(), form: null } });
		const add = screen.getByRole('link', { name: /Add sleep/ });
		expect(add).toHaveAttribute('href', '/add?from=/timeline&date=2026-07-09');
	});

	it('omits the day from the Add-sleep link when viewing today', () => {
		render(Page, { props: { data: todayWithOnlyBedtime(), form: null } });
		const add = screen.getByRole('link', { name: /Add sleep/ });
		expect(add).toHaveAttribute('href', '/add?from=/timeline');
	});
});

describe('Timeline — today, only tonight’s bedtime logged', () => {
	it('shows the logged bedtime block (in-progress, not planned)', () => {
		render(Page, { props: { data: todayWithOnlyBedtime(), form: null } });
		const bedtime = screen.getByText(/🌙 Bedtime/);
		expect(bedtime).toBeInTheDocument();
		expect(bedtime.textContent).not.toMatch(/planned/);
	});

	it('still projects the day’s naps as planned blocks', () => {
		render(Page, { props: { data: todayWithOnlyBedtime(), form: null } });
		expect(screen.getByText('Nap 1')).toBeInTheDocument();
		expect(screen.getByText('Nap 2')).toBeInTheDocument();
		expect(screen.getByText('~1h 30m')).toBeInTheDocument();
		expect(screen.getByText('~1h 00m')).toBeInTheDocument();
	});

	it('renders the planned awake windows leading into each sleep', () => {
		render(Page, { props: { data: todayWithOnlyBedtime(), form: null } });
		expect(screen.getAllByText('Awake')).toHaveLength(3);
	});

	it('does not offer the inline tail editor once bedtime is logged', () => {
		render(Page, { props: { data: todayWithOnlyBedtime(), form: null } });
		expect(screen.queryByRole('button', { name: '+ Add nap' })).not.toBeInTheDocument();
	});
});

describe('Timeline — today, awake past the current wake window', () => {
	// The live now-line reads the real clock after mount, so pin it to the mocked
	// "now" (09:45) — otherwise the client-side grow-to-now floors to the wall clock.
	afterEach(() => vi.useRealTimers());

	it('grows the current awake block to the now-line and cascades from there', () => {
		vi.useFakeTimers({ now: at('09:45'), toFake: ['Date'] });
		const { container } = render(Page, { props: { data: todayAwakePastWindow(), form: null } });
		// The current awake window spans 07:00 → now (09:45), 2h 45m, not the plan's 2h,
		// and Nap 1 (planned) then starts at the grown window's end, not the lapsed 09:00.
		expect(blockBox(container, '07:00–09:45')).toBeDefined();
		expect(blockBox(container, '09:45–11:15')).toBeDefined();
	});
});

describe('Timeline — short sleep blocks stay readable', () => {
	it('renders both text rows of a ≤15-min nap', () => {
		render(Page, { props: { data: pastDayWithShortNap(), form: null } });
		// Label row and time/duration row must both be present and legible.
		expect(screen.getByText('Nap 1')).toBeInTheDocument();
		expect(screen.getByText('12m')).toBeInTheDocument();
		expect(screen.getByText(/09:00–09:12/)).toBeInTheDocument();
	});

	it('gives the short nap block enough height for its two text rows', () => {
		const { container } = render(Page, { props: { data: pastDayWithShortNap(), form: null } });
		// 12 min * 1.4 px/min ≈ 17px of timeline span — well under one line, let alone
		// two. The block must be lifted to at least a readable two-line height so the
		// time/duration row isn't hidden.
		const short = blockBox(container, 'Nap 1');
		expect(short).toBeDefined();
		expect(short!.height).toBeGreaterThanOrEqual(MIN_TWO_LINE_PX);
	});

	it('never sizes the short nap smaller than a normal-length one', () => {
		const { container } = render(Page, { props: { data: pastDayWithShortNap(), form: null } });
		// A 90-min nap has room to spare; the 12-min nap carries the same two rows and
		// must not be squeezed below what a comfortable block gets.
		const short = blockBox(container, 'Nap 1');
		const long = blockBox(container, 'Nap 2');
		expect(short!.height).toBeGreaterThanOrEqual(Math.min(long!.height, MIN_TWO_LINE_PX));
	});
});

describe('Timeline — blocks do not overlap their neighbour', () => {
	it('keeps the short nap block from spilling into the awake window below it', () => {
		const { container } = render(Page, { props: { data: pastDayWithShortNap(), form: null } });
		// The nap runs 09:00–09:12; the next block is the awake window 09:12–12:00,
		// positioned by clock time at ~17px below the nap's top. If the nap's box is
		// taller than its true span it overruns that boundary and covers the awake
		// window's start. A block must end at or above where the next one begins.
		const nap = blockBox(container, 'Nap 1');
		const awake = blockBox(container, '09:12–12:00');
		expect(nap).toBeDefined();
		expect(awake).toBeDefined();
		expect(nap!.top + nap!.height).toBeLessThanOrEqual(awake!.top);
	});

	it('keeps a run of short naps readable, ordered and non-overlapping', () => {
		const { container } = render(Page, { props: { data: pastDayWithShortNapRun(), form: null } });
		const naps = ['Nap 1', 'Nap 2', 'Nap 3'].map((n) => blockBox(container, n));
		// Each short nap still gets its full readable height…
		for (const nap of naps) {
			expect(nap).toBeDefined();
			expect(nap!.height).toBeGreaterThanOrEqual(MIN_TWO_LINE_PX);
		}
		// …and they stay in order, each ending at or above where the next one begins,
		// so the packed run stretches the axis instead of collapsing onto itself.
		for (let i = 1; i < naps.length; i++) {
			expect(naps[i - 1]!.top + naps[i - 1]!.height).toBeLessThanOrEqual(naps[i]!.top);
		}
	});

	it('keeps each block sitting on its own time gridline', () => {
		const { container } = render(Page, { props: { data: pastDayWithShortNap(), form: null } });
		// Nap 1 starts at 09:00, so its top must line up with the 09:00 hour gridline —
		// blocks and gridlines both read the same warped axis, so a stretched region
		// never desynchronises the two.
		const nap = blockBox(container, 'Nap 1');
		const grid = gridlineTop(container, '09:00');
		expect(nap).toBeDefined();
		expect(grid).toBeDefined();
		expect(grid!).toBeCloseTo(nap!.top, 1);
	});
});
