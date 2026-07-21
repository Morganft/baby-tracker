import { defineConfig } from '@playwright/test';

// End-to-end smoke suite. Playwright boots a real production build and drives a
// browser against it, so it catches the whole class of breakage the unit and
// component tests can't: blank screens, hydration crashes, dead server loads.
export default defineConfig({
	testDir: 'e2e',
	// Seed an isolated, writable DB copy so the suite never touches the dev DB.
	globalSetup: './e2e/global-setup.ts',
	// Build once, then serve the adapter-node output via `vite preview`.
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// Point both the build gate and the preview server at the seeded copy.
		env: { DATABASE_URL: 'e2e/.tmp/e2e.db' }
	},
	use: {
		baseURL: 'http://localhost:4173'
	}
});
