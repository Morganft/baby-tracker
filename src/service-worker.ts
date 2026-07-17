/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Minimal service worker: precache the immutable built assets so they load fast
// and survive flaky networks. It deliberately does NOT intercept navigations,
// data loads, or form posts — those go straight to the network, so a transient
// DNS/TLS/timeout failure can never be turned into an "offline and not cached"
// error page (which iOS Safari makes sticky). A real offline story — cached app
// shell + write-queue — is layered on later (see REQUIREMENTS §3 "Offline").
// Registered automatically by SvelteKit.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `cache-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	// Never intercept in dev: the precache is empty (build/files are only
	// populated in a production build), so Vite's HMR page reloads and dep
	// re-optimization make navigation fetches transiently fail, and the
	// network-first fallback below would throw → the browser shows ERR_FAILED.
	if (import.meta.env.DEV) return;

	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	// Only take over the immutable, precached build assets, cache-first. Their
	// hashed filenames make them safe to serve forever. Everything else —
	// navigations, data loads, POSTs — is left to pass through to the network
	// untouched (no respondWith), so we never intercept a request we can't
	// reliably satisfy and never throw an error page on a flaky network.
	if (!PRECACHE.includes(url.pathname)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(request);
			// Fall back to the network for a not-yet-cached asset (e.g. a new build
			// hash the currently-active worker hasn't precached yet).
			return cached ?? fetch(request);
		})()
	);
});
