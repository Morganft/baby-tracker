<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div
	class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
>
	<header class="flex items-center gap-2 py-4">
		<img src="/icon.svg" alt="" class="h-8 w-8 rounded-lg" />
		<h1 class="text-lg font-semibold tracking-tight">Baby Sleep Tracker</h1>
	</header>
	<main class="flex-1">
		{@render children()}
	</main>
</div>
