import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';
import type { PageData } from './$types';
import type { SleepDTO } from '$lib/server/queries/sleeps';

// Same faithful `use:enhance` stand-in as the settings/templates specs: on submit
// it runs the SubmitFunction and, by default, resets the form unless the callback
// opts out with `update({ reset: false })`. The edit form binds its inputs to
// `$state`, which a stray `form.reset()` would desync — so this guards the opt-out.
vi.mock('$app/forms', () => ({
	enhance: (formEl: HTMLFormElement, submit?: unknown) => {
		const onSubmit = async (e: Event) => {
			e.preventDefault();
			const formData = new FormData(formEl);
			const args = {
				action: new URL(formEl.action || 'http://localhost/'),
				formData,
				formElement: formEl,
				controller: new AbortController(),
				submitter: null,
				cancel: () => {}
			};
			const callback = typeof submit === 'function' ? submit(args) : undefined;
			const update = async (opts?: { reset?: boolean }) => {
				if (opts?.reset !== false) formEl.reset();
			};
			const result = { type: 'success', status: 200, data: {} };
			if (typeof callback === 'function') {
				await callback({ result, update, formElement: formEl, formData, action: args.action });
			} else {
				await update();
			}
		};
		formEl.addEventListener('submit', onSubmit);
		return { destroy: () => formEl.removeEventListener('submit', onSubmit) };
	}
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const entry = (over: Partial<SleepDTO> = {}): SleepDTO => ({
	id: 'e1',
	startTime: Date.UTC(2026, 6, 9, 9, 0),
	endTime: Date.UTC(2026, 6, 9, 10, 30),
	startTimezone: 'UTC',
	endTimezone: 'UTC',
	type: 'nap',
	location: null,
	putDown: null,
	notes: null,
	nightWakings: [],
	createdAt: 0,
	updatedAt: 0,
	...over
});

const data = (over: Partial<PageData> = {}): PageData =>
	({
		clock24h: true,
		displayZone: 'UTC',
		groups: [{ key: '2026-07-09', heading: 'Thu 9 Jul 2026', entries: [entry()] }],
		...over
	}) as unknown as PageData;

describe('History edit form — fields survive a save', () => {
	it('keeps the edited Start/End values after the edit form is submitted', async () => {
		render(Page, { props: { data: data(), form: null } });

		// Open the entry's edit form.
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		const form = document
			.querySelector<HTMLInputElement>('input[name="startLocal"]')!
			.closest('form')!;
		const start = form.querySelector<HTMLInputElement>('input[name="startLocal"]')!;
		const end = form.querySelector<HTMLInputElement>('input[name="endLocal"]')!;

		await fireEvent.input(start, { target: { value: '2026-07-09T08:15' } });
		await fireEvent.input(end, { target: { value: '2026-07-09T09:45' } });
		await fireEvent.submit(form);

		expect(start.value).toBe('2026-07-09T08:15');
		expect(end.value).toBe('2026-07-09T09:45');
	});
});
