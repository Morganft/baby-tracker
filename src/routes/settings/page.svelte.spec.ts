import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';
import type { PageData } from './$types';
import type { SettingsDTO } from '$lib/server/queries/settings';

// A faithful-enough stand-in for SvelteKit's `use:enhance`: on submit it runs the
// page's SubmitFunction, then applies the DEFAULT post-success behaviour — reset
// the form — unless the returned callback opts out with `update({ reset: false })`.
// This is exactly the reset that blanks Svelte-bound `value={…}` inputs (whose
// `defaultValue` attribute is empty), so it reproduces the "fields cleared on save"
// bug when a form uses a bare `use:enhance`.
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
				// SvelteKit resets the form on a successful action unless reset:false.
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

const settings = (over: Partial<SettingsDTO> = {}): SettingsDTO => ({
	shortNapThresholdMin: 15,
	shortNapReductionPercent: 30,
	clock24h: true,
	dayStartTime: '07:00',
	adviceEnabled: true,
	createdAt: 0,
	updatedAt: 0,
	...over
});

const baby = (over: Record<string, unknown> = {}) => ({
	name: null,
	birthDate: '2026-01-22',
	createdAt: 0,
	updatedAt: 0,
	...over
});

const data = (over: Partial<PageData> = {}): PageData =>
	({ settings: settings(), baby: baby(), ...over }) as unknown as PageData;

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

describe('Settings form — fields survive a save', () => {
	it('keeps every field value after the settings form is submitted', async () => {
		render(Page, { props: { data: data(), form: null } });

		const saveForm = screen.getByRole('button', { name: 'Save settings' }).closest('form')!;
		// Values shown before saving.
		expect(input('shortNapThresholdMin').value).toBe('15');
		expect(input('shortNapReductionPercent').value).toBe('30');
		expect(input('dayStartTime').value).toBe('07:00');

		await fireEvent.submit(saveForm);

		// …and still shown after — the save must not blank the form.
		expect(input('shortNapThresholdMin').value).toBe('15');
		expect(input('shortNapReductionPercent').value).toBe('30');
		expect(input('dayStartTime').value).toBe('07:00');
	});

	it('keeps values the caregiver just edited across the save', async () => {
		render(Page, { props: { data: data(), form: null } });
		const saveForm = screen.getByRole('button', { name: 'Save settings' }).closest('form')!;

		await fireEvent.input(input('shortNapThresholdMin'), { target: { value: '20' } });
		await fireEvent.input(input('dayStartTime'), { target: { value: '06:30' } });
		await fireEvent.submit(saveForm);

		expect(input('shortNapThresholdMin').value).toBe('20');
		expect(input('dayStartTime').value).toBe('06:30');
	});

	it('shows the baby birth date and keeps it across a save', async () => {
		render(Page, { props: { data: data(), form: null } });
		const saveForm = screen.getByRole('button', { name: 'Save settings' }).closest('form')!;

		expect(input('birthDate').value).toBe('2026-01-22');
		await fireEvent.submit(saveForm);
		expect(input('birthDate').value).toBe('2026-01-22');
	});

	it('renders an empty birth-date field when none is set', () => {
		render(Page, {
			props: { data: data({ baby: baby({ birthDate: null }) } as Partial<PageData>), form: null }
		});
		expect(input('birthDate').value).toBe('');
	});

	it('reflects the advice-enabled toggle from settings', () => {
		render(Page, {
			props: { data: data({ settings: settings({ adviceEnabled: false }) }), form: null }
		});
		expect(input('adviceEnabled').checked).toBe(false);
	});
});
