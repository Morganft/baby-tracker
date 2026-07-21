import { describe, it, expect, vi } from 'vitest';
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
	const el = Array.from(container.querySelectorAll<HTMLElement>('[style*="top:"]')).find((n) =>
		n.textContent?.includes(text)
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
