<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const active = $derived(data.active);
	const library = $derived(data.library);

	const inputClass =
		'mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20';
</script>

<section class="space-y-6">
	<div>
		<h2 class="text-xl font-semibold">Plan</h2>
		<p class="text-xs opacity-60">
			The active plan drives today’s projection. Editing it here never changes your library.
		</p>
	</div>

	{#if form?.ok}
		<p
			class="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
		>
			{form.message}
		</p>
	{:else if form && 'message' in form && form.message}
		<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
			{form.message}
		</p>
	{/if}

	<!-- Active slot editor -->
	<form
		method="POST"
		action="?/editActive"
		class="space-y-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.06] p-4"
		use:enhance
	>
		<h3 class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Active plan</h3>

		<label class="block text-xs font-medium opacity-70">
			Name
			<input name="name" value={active.name} required class={inputClass} />
		</label>

		<div class="grid grid-cols-2 gap-3">
			<label class="block text-xs font-medium opacity-70">
				Reference wake
				<input
					type="time"
					name="referenceWakeTime"
					value={active.referenceWakeTime}
					required
					class={inputClass}
				/>
			</label>
			<label class="block text-xs font-medium opacity-70">
				Nap count
				<input
					type="number"
					name="napCount"
					value={active.napCount}
					min="0"
					inputmode="numeric"
					class={inputClass}
				/>
			</label>
		</div>

		<label class="block text-xs font-medium opacity-70">
			Wake windows (minutes, comma-separated)
			<input name="wakeWindows" value={active.wakeWindows.join(', ')} class={inputClass} />
			<span class="mt-0.5 block text-[0.6875rem] font-normal opacity-50"
				>One per sleep incl. bedtime — needs {active.napCount + 1} values.</span
			>
		</label>

		<label class="block text-xs font-medium opacity-70">
			Expected nap durations (minutes, comma-separated)
			<input
				name="expectedNapDurations"
				value={active.expectedNapDurations.join(', ')}
				class={inputClass}
			/>
			<span class="mt-0.5 block text-[0.6875rem] font-normal opacity-50"
				>One per nap — needs {active.napCount} values.</span
			>
		</label>

		<label class="block text-xs font-medium opacity-70">
			Target bedtime
			<input
				type="time"
				name="targetBedtime"
				value={active.targetBedtime ?? ''}
				class={inputClass}
			/>
			<span class="mt-0.5 block text-[0.6875rem] font-normal opacity-50"
				>Set it to redistribute remaining sleeps onto a fixed bedtime. Leave empty for the sliding
				cascade.</span
			>
		</label>

		<details class="text-xs">
			<summary class="cursor-pointer font-medium opacity-70"
				>Redistribution bounds (optional)</summary
			>
			<div class="mt-2 space-y-3">
				<p class="text-[0.6875rem] font-normal opacity-50">
					Min/max minutes per position, comma-separated. Windows need {active.napCount + 1} values, naps
					need {active.napCount}. Leave empty for unbounded. Only used when a target bedtime is set.
				</p>
				<div class="grid grid-cols-2 gap-3">
					<label class="block font-medium opacity-70">
						Wake window min
						<input
							name="wakeWindowMin"
							value={active.wakeWindowMin?.join(', ') ?? ''}
							class={inputClass}
						/>
					</label>
					<label class="block font-medium opacity-70">
						Wake window max
						<input
							name="wakeWindowMax"
							value={active.wakeWindowMax?.join(', ') ?? ''}
							class={inputClass}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="block font-medium opacity-70">
						Nap duration min
						<input
							name="napDurationMin"
							value={active.napDurationMin?.join(', ') ?? ''}
							class={inputClass}
						/>
					</label>
					<label class="block font-medium opacity-70">
						Nap duration max
						<input
							name="napDurationMax"
							value={active.napDurationMax?.join(', ') ?? ''}
							class={inputClass}
						/>
					</label>
				</div>
			</div>
		</details>

		<details class="text-xs">
			<summary class="cursor-pointer font-medium opacity-70">Reference budget (optional)</summary>
			<div class="mt-2 space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<label class="block font-medium opacity-70">
						Daily total (min)
						<input
							type="number"
							name="dailyTotalSleepTarget"
							value={active.dailyTotalSleepTarget ?? ''}
							min="0"
							inputmode="numeric"
							class={inputClass}
						/>
					</label>
					<label class="block font-medium opacity-70">
						Daytime cap (min)
						<input
							type="number"
							name="daytimeCap"
							value={active.daytimeCap ?? ''}
							min="0"
							inputmode="numeric"
							class={inputClass}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="block font-medium opacity-70">
						Bedtime from
						<input
							type="time"
							name="bedtimeStart"
							value={active.bedtimeStart ?? ''}
							class={inputClass}
						/>
					</label>
					<label class="block font-medium opacity-70">
						Bedtime to
						<input
							type="time"
							name="bedtimeEnd"
							value={active.bedtimeEnd ?? ''}
							class={inputClass}
						/>
					</label>
				</div>
			</div>
		</details>

		<button
			type="submit"
			class="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.99]"
		>
			Save active plan
		</button>
	</form>

	<!-- Save active to library as a new entry -->
	<form
		method="POST"
		action="?/saveNew"
		class="flex items-end gap-2 rounded-2xl border border-black/10 p-4 dark:border-white/10"
		use:enhance
	>
		<label class="flex-1 text-xs font-medium opacity-70">
			Save active plan to library as…
			<input name="name" placeholder="e.g. 3-nap winter" required class={inputClass} />
		</label>
		<button
			type="submit"
			class="rounded-lg border border-indigo-500/40 px-3 py-2 text-sm font-medium text-indigo-600 active:scale-[0.98] dark:text-indigo-400"
		>
			Save
		</button>
	</form>

	<!-- Library -->
	<div class="space-y-2">
		<h3 class="text-sm font-medium opacity-60">Library</h3>
		{#if library.length === 0}
			<p class="py-4 text-center text-sm opacity-50">
				No saved templates yet — save your active plan above.
			</p>
		{/if}
		<ul class="space-y-2">
			{#each library as t (t.id)}
				<li
					class="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]"
				>
					<div class="flex items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{t.name}</p>
							<p class="text-xs opacity-60">
								wake {t.referenceWakeTime} · {t.napCount} nap{t.napCount === 1 ? '' : 's'}
								{#if active.sourceTemplateId === t.id}· <span
										class="text-indigo-600 dark:text-indigo-400">active source</span
									>{/if}
							</p>
						</div>
						<form method="POST" action="?/load" use:enhance>
							<input type="hidden" name="templateId" value={t.id} />
							<button
								type="submit"
								class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white active:scale-95"
							>
								Load
							</button>
						</form>
					</div>
					<div class="mt-2 flex gap-3 text-xs">
						<form method="POST" action="?/overwrite" use:enhance>
							<input type="hidden" name="templateId" value={t.id} />
							<button
								type="submit"
								class="font-medium opacity-70 active:scale-95"
								onclick={(ev) => {
									if (!confirm(`Overwrite “${t.name}” with the active plan?`)) ev.preventDefault();
								}}
							>
								Overwrite with active
							</button>
						</form>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="templateId" value={t.id} />
							<button
								type="submit"
								class="font-medium text-rose-600 active:scale-95 dark:text-rose-400"
								onclick={(ev) => {
									if (!confirm(`Delete “${t.name}”?`)) ev.preventDefault();
								}}
							>
								Delete
							</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	</div>
</section>
