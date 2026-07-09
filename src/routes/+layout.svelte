<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();

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
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div
	class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+4.5rem)]"
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
