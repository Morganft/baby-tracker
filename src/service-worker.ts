/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Minimal app-shell service worker: precache the built assets so the PWA opens
// offline. Data sync / offline write-queue is layered on later (see REQUIREMENTS
// §3 "Offline"). Registered automatically by SvelteKit.

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
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	// Cache-first for precached build assets; network-first (cache fallback) for
	// everything else so navigations work offline.
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (PRECACHE.includes(url.pathname)) {
				const cached = await cache.match(request);
				if (cached) return cached;
			}
			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') cache.put(request, response.clone());
				return response;
			} catch {
				const cached = await cache.match(request);
				if (cached) return cached;
				throw new Error('offline and not cached');
			}
		})()
	);
});
