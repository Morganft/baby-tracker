import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';
import type { PageData } from './$types';
import type { ActiveTemplateDTO } from '$lib/server/queries/templates';

// Same faithful `use:enhance` stand-in as the settings spec: on submit it runs the
// SubmitFunction and, by default, resets the form (which blanks Svelte-bound
// `value={…}` inputs) unless the callback opts out with `update({ reset: false })`.
// The active-slot editor opts out, so this guards that it stays that way.
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

const active = (over: Partial<ActiveTemplateDTO> = {}): ActiveTemplateDTO => ({
	id: 'active',
	name: 'Test plan',
	referenceWakeTime: '07:00',
	napCount: 2,
	wakeWindows: [120, 150, 240],
	expectedNapDurations: [90, 60],
	dailyTotalSleepTarget: null,
	daytimeCap: null,
	bedtimeStart: null,
	bedtimeEnd: null,
	targetBedtime: null,
	wakeWindowMin: null,
	wakeWindowMax: null,
	napDurationMin: null,
	napDurationMax: null,
	sourceTemplateId: null,
	createdAt: 0,
	updatedAt: 0,
	...over
});

const data = (over: Partial<PageData> = {}): PageData =>
	({ active: active(), library: [], clock24h: true, ...over }) as unknown as PageData;

describe('Active-slot editor form — fields survive an auto-save', () => {
	it('keeps the Advanced field values after the editor form is submitted', async () => {
		render(Page, { props: { data: data(), form: null } });

		// The editActive form is the one carrying the hidden timeline fields.
		const form = document
			.querySelector<HTMLInputElement>('input[name="wakeWindows"]')!
			.closest('form')!;
		const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
		const minInput = form.querySelector<HTMLInputElement>('input[name="wakeWindowMin"]')!;

		await fireEvent.input(nameInput, { target: { value: '3-nap winter' } });
		await fireEvent.input(minInput, { target: { value: '90, 120, 180' } });
		await fireEvent.submit(form);

		expect(nameInput.value).toBe('3-nap winter');
		expect(minInput.value).toBe('90, 120, 180');
	});
});
