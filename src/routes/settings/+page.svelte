<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.settings);
	const baby = $derived(data.baby);
</script>

<section class="space-y-5">
	<h2 class="text-xl font-semibold">Settings</h2>

	{#if form?.ok}
		<p
			class="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
		>
			Saved.
		</p>
	{:else if form && 'message' in form && form.message}
		<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
			{form.message}
		</p>
	{/if}

	<form
		method="POST"
		action="?/save"
		class="space-y-5"
		use:enhance={() =>
			// reset:false keeps the fields showing their values after saving; they come
			// from `value={s.x}`, which enhance's default form reset would blank.
			async ({ update }) =>
				update({ reset: false })}
	>
		<div
			class="space-y-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]"
		>
			<div>
				<label class="block text-sm font-medium" for="threshold">Short-nap threshold</label>
				<p class="mb-2 text-xs opacity-60">
					A nap this length or shorter counts as “short” and shortens the next wake window.
				</p>
				<div class="flex items-center gap-2">
					<input
						id="threshold"
						type="number"
						name="shortNapThresholdMin"
						value={s.shortNapThresholdMin}
						min="0"
						inputmode="numeric"
						class="w-24 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
					/>
					<span class="text-sm opacity-60">minutes</span>
				</div>
			</div>

			<div>
				<label class="block text-sm font-medium" for="reduction">Short-nap reduction</label>
				<p class="mb-2 text-xs opacity-60">
					How much to shorten the next wake window after a short nap.
				</p>
				<div class="flex items-center gap-2">
					<input
						id="reduction"
						type="number"
						name="shortNapReductionPercent"
						value={s.shortNapReductionPercent}
						min="0"
						max="100"
						inputmode="numeric"
						class="w-24 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
					/>
					<span class="text-sm opacity-60">percent</span>
				</div>
			</div>
		</div>

		<div
			class="space-y-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]"
		>
			<label class="flex items-center justify-between gap-3">
				<span>
					<span class="block text-sm font-medium">24-hour clock</span>
					<span class="block text-xs opacity-60">Off shows AM/PM times.</span>
				</span>
				<input
					type="checkbox"
					name="clock24h"
					checked={s.clock24h}
					class="h-5 w-5 rounded text-indigo-600"
				/>
			</label>

			<label class="flex items-center justify-between gap-3">
				<span>
					<span class="block text-sm font-medium">Sleep advice</span>
					<span class="block text-xs opacity-60">
						In-day nudges on Home and planning suggestions on the plan page. Off hides both.
					</span>
				</span>
				<input
					type="checkbox"
					name="adviceEnabled"
					checked={s.adviceEnabled}
					class="h-5 w-5 rounded text-indigo-600"
				/>
			</label>
		</div>

		<div
			class="space-y-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]"
		>
			<div>
				<label class="block text-sm font-medium" for="birthDate">Baby’s birth date</label>
				<p class="mb-2 text-xs opacity-60">
					Optional. When set, advice can compare against age-based sleep guidance. Leave blank for
					data-only advice.
				</p>
				<input
					id="birthDate"
					type="date"
					name="birthDate"
					value={baby.birthDate ?? ''}
					class="w-44 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				/>
			</div>
		</div>

		<button
			type="submit"
			class="w-full rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white active:scale-[0.99]"
		>
			Save settings
		</button>
	</form>

	<div
		class="space-y-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]"
	>
		<div>
			<h3 class="text-sm font-medium">Backup &amp; restore</h3>
			<p class="mt-1 text-xs opacity-60">
				Export everything to one JSON file, or merge a backup back in (matched by id, newest wins).
			</p>
		</div>

		{#if form?.imported}
			<p
				class="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
			>
				{form.imported}
			</p>
		{:else if form && 'importMessage' in form && form.importMessage}
			<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
				{form.importMessage}
			</p>
		{/if}

		<a
			href={resolve('/api/export')}
			download
			class="block w-full rounded-2xl border border-indigo-600 px-4 py-3 text-center font-semibold text-indigo-600 active:scale-[0.99] dark:text-indigo-400"
		>
			Export data
		</a>

		<form
			method="POST"
			action="?/import"
			enctype="multipart/form-data"
			class="space-y-3"
			use:enhance
		>
			<input
				type="file"
				name="file"
				accept="application/json,.json"
				required
				class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
			/>
			<button
				type="submit"
				class="w-full rounded-2xl border border-black/15 px-4 py-3 font-semibold active:scale-[0.99] dark:border-white/20"
			>
				Import backup
			</button>
		</form>
	</div>
</section>
