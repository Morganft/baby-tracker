<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.settings);
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

	<form method="POST" action="?/save" class="space-y-5" use:enhance>
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
			<div>
				<label class="block text-sm font-medium" for="dayStartTime">Day start time</label>
				<p class="mb-2 text-xs opacity-60">
					When the day begins. Used as the projection’s anchor until an actual morning wake is
					logged.
				</p>
				<input
					id="dayStartTime"
					type="time"
					name="dayStartTime"
					value={s.dayStartTime}
					required
					class="w-32 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				/>
			</div>

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
					<span class="block text-sm font-medium">Track timezone</span>
					<span class="block text-xs opacity-60">Capture each entry’s timezone for travel.</span>
				</span>
				<input
					type="checkbox"
					name="trackTimezone"
					checked={s.trackTimezone}
					class="h-5 w-5 rounded text-indigo-600"
				/>
			</label>
		</div>

		<button
			type="submit"
			class="w-full rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white active:scale-[0.99]"
		>
			Save settings
		</button>
	</form>
</section>
