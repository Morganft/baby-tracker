<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { browserTimeZone } from '$lib/format';

	let { children } = $props();

	// Advertise this phone's zone to the server so today's views (Home, Timeline)
	// render in it, not the server's. Runs once on the client after mount; SSR and
	// the first hydration share the server-zone `data`, so there's no mismatch —
	// once the cookie lands (first visit) or changes (travel), re-run the loads.
	$effect(() => {
		const tz = browserTimeZone();
		const current = document.cookie.match(/(?:^|;\s*)tz=([^;]+)/)?.[1];
		if (current !== tz) {
			// IANA zone chars are all valid cookie octets, so no encoding needed.
			document.cookie = `tz=${tz}; path=/; max-age=31536000; samesite=lax`;
			invalidateAll();
		}
	});

	const tabs = [
		{ href: '/', label: 'Now', icon: '🏠' },
		{ href: '/timeline', label: 'Today', icon: '📊' },
		{ href: '/history', label: 'History', icon: '📜' },
		{ href: '/templates', label: 'Plan', icon: '🗓️' },
		{ href: '/settings', label: 'Settings', icon: '⚙️' }
	] as const;

	// Exact match for the home tab; prefix match for the section tabs.
	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

	// The Plan page is a two-column editor that needs room to breathe on desktop; the
	// rest of the app stays phone-width. Only the max-width lifts on large screens —
	// mobile is unchanged.
	const wide = $derived(page.url.pathname.startsWith('/templates'));
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div
	class="mx-auto flex min-h-dvh flex-col px-4 pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+4.5rem)] {wide
		? 'max-w-md lg:max-w-5xl'
		: 'max-w-md'}"
>
	<header class="flex items-center gap-2 py-4">
		<img src="/icon.svg" alt="" class="h-8 w-8 rounded-lg" />
		<h1 class="text-lg font-semibold tracking-tight">Baby Sleep Tracker</h1>
	</header>
	<main class="flex-1">
		{@render children()}
	</main>
</div>

<nav
	class="fixed inset-x-0 bottom-0 z-10 border-t border-black/10 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/90"
>
	<ul class="mx-auto flex max-w-md">
		{#each tabs as tab (tab.href)}
			<li class="flex-1">
				<a
					href={resolve(tab.href)}
					aria-current={isActive(tab.href) ? 'page' : undefined}
					class="flex flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-medium transition-opacity {isActive(
						tab.href
					)
						? 'text-indigo-600 dark:text-indigo-400'
						: 'opacity-55 hover:opacity-80'}"
				>
					<span class="text-lg leading-none" aria-hidden="true">{tab.icon}</span>
					{tab.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>
