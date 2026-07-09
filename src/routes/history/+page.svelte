<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtTime, fmtDuration, toDateTimeInput } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const clock24h = $derived(data.clock24h);
	const time = (e: number, tz: string) => fmtTime(e, tz, clock24h);

	function durationMin(start: number, end: number | null): number | null {
		return end == null ? null : Math.max(0, Math.round((end - start) / 60_000));
	}

	const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'];
	const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'];

	// Which entry's edit form is open (only one at a time keeps the page calm).
	let editing = $state<string | null>(null);
	const toggle = (id: string) => (editing = editing === id ? null : id);
</script>

<section class="space-y-5">
	<h2 class="text-xl font-semibold">History</h2>

	{#if form && 'message' in form && form.message}
		<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
			{form.message}
		</p>
	{/if}

	{#if data.groups.length === 0}
		<p class="py-8 text-center text-sm opacity-50">No sleeps logged yet.</p>
	{/if}

	{#each data.groups as group (group.key)}
		<div class="space-y-2">
			<h3 class="text-sm font-medium opacity-60">{group.heading}</h3>
			<ul class="space-y-2">
				{#each group.entries as e (e.id)}
					{@const dur = durationMin(e.startTime, e.endTime)}
					<li
						class="rounded-xl border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
					>
						<div class="flex items-center gap-3 p-3">
							<span class="text-lg" aria-hidden="true">{e.type === 'night' ? '🌙' : '☀️'}</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">
									{time(e.startTime, e.timezone)}{#if e.endTime != null}–{time(
											e.endTime,
											e.timezone
										)}{:else}<span class="opacity-60"> · in progress</span>{/if}
								</p>
								<p class="text-xs opacity-60">
									{e.type === 'night' ? 'Night' : 'Nap'}
									{#if dur != null}· {fmtDuration(dur)}{/if}
									{#if e.location}· {e.location}{/if}
									{#if e.nightWakings.length > 0}· {e.nightWakings.length} waking{e.nightWakings
											.length > 1
											? 's'
											: ''}{/if}
								</p>
							</div>
							<button
								type="button"
								onclick={() => toggle(e.id)}
								class="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 active:scale-95 dark:text-indigo-400"
							>
								{editing === e.id ? 'Close' : 'Edit'}
							</button>
						</div>

						{#if editing === e.id}
							<form
								method="POST"
								action="?/edit"
								class="space-y-3 border-t border-black/10 p-3 dark:border-white/10"
								use:enhance={() =>
									({ update }) =>
										update({ reset: false })}
							>
								<input type="hidden" name="id" value={e.id} />
								<input type="hidden" name="timezone" value={e.timezone} />

								<label class="block text-xs font-medium opacity-70">
									Start
									<input
										type="datetime-local"
										name="startLocal"
										value={toDateTimeInput(e.startTime, e.timezone)}
										required
										class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
									/>
								</label>

								<label class="block text-xs font-medium opacity-70">
									End <span class="opacity-50">(blank = in progress)</span>
									<input
										type="datetime-local"
										name="endLocal"
										value={e.endTime != null ? toDateTimeInput(e.endTime, e.timezone) : ''}
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
											<option value="nap" selected={e.type === 'nap'}>Nap</option>
											<option value="night" selected={e.type === 'night'}>Night</option>
										</select>
									</label>
									<label class="block text-xs font-medium opacity-70">
										Location
										<select
											name="location"
											class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
										>
											<option value="" selected={!e.location}>—</option>
											{#each LOCATIONS as loc (loc)}
												<option value={loc} selected={e.location === loc}>{loc}</option>
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
										<option value="" selected={!e.putDown}>—</option>
										{#each PUT_DOWNS as pd (pd)}
											<option value={pd} selected={e.putDown === pd}>{pd}</option>
										{/each}
									</select>
								</label>

								<label class="block text-xs font-medium opacity-70">
									Notes
									<input
										type="text"
										name="notes"
										value={e.notes ?? ''}
										placeholder="optional"
										class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
									/>
								</label>

								<div class="flex gap-2 pt-1">
									<button
										type="submit"
										class="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white active:scale-[0.98]"
									>
										Save
									</button>
									<button
										type="submit"
										formaction="?/delete"
										formnovalidate
										class="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 active:scale-[0.98] dark:text-rose-400"
										onclick={(ev) => {
											if (!confirm('Delete this entry?')) ev.preventDefault();
										}}
									>
										Delete
									</button>
								</div>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</section>
