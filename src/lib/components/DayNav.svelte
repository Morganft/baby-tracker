<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Shared day navigator for the day-scoped views (Home, Timeline). Carries the
	// viewed day in a `?date=YYYY-MM-DD` query param; navigating to today drops the
	// param so the default live path is used.
	let {
		basePath,
		dayKey = $bindable(),
		isToday,
		prevKey,
		nextKey,
		todayKey,
		minKey,
		label
	}: {
		// Narrowed to the day-scoped views so SvelteKit's typed `resolve` accepts it
		// (same idiom as the app's `FromPath`). Widen the union if more views adopt it.
		basePath: '/' | '/timeline';
		dayKey: string;
		isToday: boolean;
		prevKey: string | null;
		nextKey: string | null;
		todayKey: string;
		minKey: string | null;
		label: string;
	} = $props();

	let dateInput: HTMLInputElement;

	// Today gets a clean, param-free URL so the live default path handles it.
	function navTo(key: string) {
		goto(resolve(key === todayKey ? basePath : `${basePath}?date=${key}`));
	}

	function openPicker() {
		if (dateInput.showPicker) dateInput.showPicker();
		else dateInput.focus();
	}
</script>

<div class="flex items-center justify-center gap-2 py-2">
	<button
		type="button"
		onclick={() => prevKey && navTo(prevKey)}
		disabled={prevKey == null}
		aria-label="Previous day"
		class="flex h-9 w-9 items-center justify-center rounded-full border border-black/15 text-lg leading-none active:scale-95 disabled:opacity-30 dark:border-white/20"
	>
		‹
	</button>

	<button
		type="button"
		onclick={openPicker}
		class="relative rounded-lg px-3 py-1.5 text-sm font-medium active:scale-95"
	>
		{label}
		<!-- Native date picker overlaid so tapping the label opens it. -->
		<input
			bind:this={dateInput}
			type="date"
			bind:value={dayKey}
			max={todayKey}
			min={minKey ?? undefined}
			onchange={() => navTo(dayKey)}
			aria-label="Pick a day"
			class="absolute inset-0 cursor-pointer opacity-0"
		/>
	</button>

	<button
		type="button"
		onclick={() => nextKey && navTo(nextKey)}
		disabled={nextKey == null}
		aria-label="Next day"
		class="flex h-9 w-9 items-center justify-center rounded-full border border-black/15 text-lg leading-none active:scale-95 disabled:opacity-30 dark:border-white/20"
	>
		›
	</button>

	{#if !isToday}
		<button
			type="button"
			onclick={() => navTo(todayKey)}
			class="rounded-full border border-black/15 px-3 py-1 text-xs font-medium text-indigo-600 active:scale-95 dark:border-white/20 dark:text-indigo-400"
		>
			Today
		</button>
	{/if}
</div>
