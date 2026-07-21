import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DayNav from './DayNav.svelte';

// `$app/*` are provided by SvelteKit's runtime, which isn't booted in a unit
// test — stub the two the component touches. `resolve` is an identity pass so we
// can assert on the plain path handed to `goto`.
const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => goto(...args) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const base = {
	basePath: '/' as const,
	dayKey: '2026-07-20',
	isToday: false,
	prevKey: '2026-07-19',
	nextKey: '2026-07-21',
	todayKey: '2026-07-21',
	minKey: '2026-07-01',
	label: 'Mon 20 Jul'
};

describe('DayNav', () => {
	beforeEach(() => goto.mockClear());

	it('renders the day label', () => {
		render(DayNav, { props: base });
		expect(screen.getByText('Mon 20 Jul')).toBeInTheDocument();
	});

	it('shows the Today shortcut when not viewing today', () => {
		render(DayNav, { props: base });
		expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
	});

	it('hides the Today shortcut when already on today', () => {
		render(DayNav, { props: { ...base, isToday: true } });
		expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
	});

	it('navigates to the previous day with a date query param', async () => {
		render(DayNav, { props: base });
		await fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
		expect(goto).toHaveBeenCalledWith('/?date=2026-07-19');
	});

	it('drops the query param when jumping to today', async () => {
		render(DayNav, { props: base });
		await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
		expect(goto).toHaveBeenCalledWith('/');
	});

	it('disables Previous when there is no earlier day', () => {
		render(DayNav, { props: { ...base, prevKey: null } });
		expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
	});
});
