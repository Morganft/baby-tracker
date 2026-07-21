import { test, expect } from '@playwright/test';

// Every top-level view. If any of these throws on load, stops rendering, or its
// server `load` blows up, this suite goes red.
const routes = ['/', '/timeline', '/history', '/settings', '/templates', '/add'];

test.beforeEach(({ page }) => {
	// An uncaught client-side error (bad hydration, runtime crash) fails the test
	// even if the HTTP response was 200.
	page.on('pageerror', (error) => {
		throw error;
	});
});

for (const path of routes) {
	test(`${path} loads and renders`, async ({ page }) => {
		const response = await page.goto(path);
		expect(response?.ok(), `expected a 2xx response for ${path}`).toBeTruthy();
		// The app renders into <body>; non-empty content rules out a blank screen.
		await expect(page.locator('body')).not.toBeEmpty();
	});
}

test('home shows the day navigator', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible();
	await expect(page.getByLabel('Pick a day')).toBeAttached();
});
