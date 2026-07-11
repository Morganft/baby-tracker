<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { toDateTimeInput, browserTimeZone } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'];
	const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'];

	// Zone the user types against: the phone's own. Prefill and the submitted
	// `timezone` must agree so the epoch round-trips (SSR resolves to the server
	// zone; hydration switches to the phone's, updating both in lockstep).
	const entryZone = $derived(browserTimeZone());
	// Prefill the start with "now" in that zone; end left blank (in progress).
	const startDefault = $derived(toDateTimeInput(data.now, entryZone));
</script>

<section class="space-y-5">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Add sleep</h2>
		<a href={resolve(data.from)} class="text-sm font-medium text-indigo-600 dark:text-indigo-400"
			>Cancel</a
		>
	</div>

	{#if form && 'message' in form && form.message}
		<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/create" class="space-y-4" use:enhance>
		<input type="hidden" name="from" value={data.from} />
		<input type="hidden" name="timezone" value={entryZone} />

		<label class="block text-xs font-medium opacity-70">
			Start
			<input
				type="datetime-local"
				name="startLocal"
				value={startDefault}
				required
				class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
			/>
		</label>

		<label class="block text-xs font-medium opacity-70">
			End <span class="opacity-50">(blank = in progress)</span>
			<input
				type="datetime-local"
				name="endLocal"
				class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
			/>
		</label>

		<div class="grid grid-cols-2 gap-3">
			<label class="block text-xs font-medium opacity-70">
				Type
				<select
					name="type"
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				>
					<option value="nap" selected>Nap</option>
					<option value="night">Night</option>
				</select>
			</label>
			<label class="block text-xs font-medium opacity-70">
				Location
				<select
					name="location"
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				>
					<option value="" selected>—</option>
					{#each LOCATIONS as loc (loc)}
						<option value={loc}>{loc}</option>
					{/each}
				</select>
			</label>
		</div>

		<label class="block text-xs font-medium opacity-70">
			Put down
			<select
				name="putDown"
				class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
			>
				<option value="" selected>—</option>
				{#each PUT_DOWNS as pd (pd)}
					<option value={pd}>{pd}</option>
				{/each}
			</select>
		</label>

		<label class="block text-xs font-medium opacity-70">
			Notes
			<input
				type="text"
				name="notes"
				placeholder="optional"
				class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
			/>
		</label>

		<button
			type="submit"
			class="w-full rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white active:scale-[0.99]"
		>
			Save entry
		</button>
	</form>
</section>
