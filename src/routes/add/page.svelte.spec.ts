import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const data = (over: Partial<PageData> = {}): PageData =>
	({
		now: Date.UTC(2026, 6, 21, 9, 0),
		timeZone: 'UTC',
		clock24h: true,
		from: '/timeline',
		date: null,
		...over
	}) as unknown as PageData;

describe('Add sleep — preserving the viewed day', () => {
	it('sends the viewed day back to the origin view on Cancel', () => {
		render(Page, { props: { data: data({ from: '/timeline', date: '2026-07-09' }), form: null } });
		const cancel = screen.getByRole('link', { name: 'Cancel' });
		expect(cancel).toHaveAttribute('href', '/timeline?date=2026-07-09');
	});

	it('round-trips the viewed day through a hidden field for the save redirect', () => {
		const { container } = render(Page, {
			props: { data: data({ from: '/timeline', date: '2026-07-09' }), form: null }
		});
		const hidden = container.querySelector<HTMLInputElement>('input[name="date"]');
		expect(hidden).not.toBeNull();
		expect(hidden!.value).toBe('2026-07-09');
	});

	it('returns to the bare view when no day is being carried (opened from today)', () => {
		render(Page, { props: { data: data({ from: '/timeline', date: null }), form: null } });
		expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/timeline');
	});
});
