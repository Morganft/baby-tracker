import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';
import { groupDay } from '$lib/server/queries/day';
import { project } from '$lib/projection/project';
import type { TemplateConfig } from '$lib/projection/types';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({ goto: () => {} }));

const TZ = 'UTC';

const template: TemplateConfig = {
	referenceWakeTime: '07:00',
	napCount: 2,
	wakeWindows: [120, 150, 240],
	expectedNapDurations: [90, 60]
};

// Today, awake at 10:00, with a completed nap 09:00:00 → 09:44:36. That span is
// 44.6 minutes — a fractional duration, exactly like a nap logged live to ms
// precision. The projection carries `durationMin` unrounded, so the "Last nap"
// tile must round it for display.
function todayWithFractionalNap(): PageData {
	const now = Date.UTC(2026, 6, 9, 10, 0);
	const entries = [
		{ id: 'lastnight', type: 'night' as const, start: Date.UTC(2026, 6, 8, 19, 0), end: Date.UTC(2026, 6, 9, 7, 0) },
		{ id: 'nap1', type: 'nap' as const, start: Date.UTC(2026, 6, 9, 9, 0, 0), end: Date.UTC(2026, 6, 9, 9, 44, 36) }
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
		asleep: false,
		activeSleep: null,
		projection,
		daySummary: null
	} as unknown as PageData;
}

describe('home "Last nap" tile', () => {
	it('rounds a fractional nap duration for display', () => {
		render(Page, { data: todayWithFractionalNap(), form: null });

		const tile = screen.getByText('Last nap').parentElement;
		// 44.6 min must render as a rounded whole-minute figure, never "44.6m".
		expect(tile).toHaveTextContent('45m');
		expect(tile?.textContent ?? '').not.toMatch(/\d\.\d/);
	});
});
