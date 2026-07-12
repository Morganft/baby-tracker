<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		browserTimeZone,
		fmtTime,
		fmtDuration,
		fmtZoneAbbrev,
		toDateTimeInput
	} from '$lib/format';
	import { resolveLocalDateTime } from '$lib/projection/time';
	import type { PageData, ActionData } from './$types';
	import type { SleepDTO } from '$lib/server/queries/sleeps';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const clock24h = $derived(data.clock24h);
	const time = (e: number, tz: string) => fmtTime(e, tz, clock24h);
	// Only label the zone on travel entries — those captured outside the display zone.
	const zoneLabel = (e: number, tz: string) =>
		tz === data.displayZone ? '' : fmtZoneAbbrev(e, tz);

	function durationMin(start: number, end: number | null): number | null {
		return end == null ? null : Math.max(0, Math.round((end - start) / 60_000));
	}

	const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'];
	const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'];

	// This device's live zone. Under SSR this resolves to the server zone, but no
	// edit form is open then; by the time a form opens (a client click) it is the
	// real browser zone.
	const deviceZone = $derived(browserTimeZone());

	type ZoneMode = 'original' | 'device';

	// Which entry's edit form is open (only one at a time keeps the page calm).
	let editing = $state<string | null>(null);
	// The open form's editable state. Each end interprets its typed time in its own
	// zone ('original' = the end's captured zone, 'device' = this phone's zone), so
	// a cross-zone travel entry can have just one end re-entered in the current zone
	// without recalculating the other. The datetime-local values are bound, so a
	// zone switch rewrites that field to the same instant re-expressed in the new zone.
	let startMode = $state<ZoneMode>('original');
	let endMode = $state<ZoneMode>('original');
	let startVal = $state('');
	let endVal = $state('');

	/** The start/end zone the open form currently interprets its inputs in. */
	function startZoneFor(e: SleepDTO): string {
		return startMode === 'device' ? deviceZone : e.startTimezone;
	}
	function endZoneFor(e: SleepDTO): string {
		return endMode === 'device' ? deviceZone : (e.endTimezone ?? e.startTimezone);
	}
	/** True when an end was captured somewhere other than the phone's zone (so it
	 *  has an "Original" and a "This device" zone that actually differ). */
	function startIsTravel(e: SleepDTO): boolean {
		return e.startTimezone !== deviceZone;
	}
	function endIsTravel(e: SleepDTO): boolean {
		return e.endTime != null && (e.endTimezone ?? e.startTimezone) !== deviceZone;
	}

	function toggle(e: SleepDTO) {
		if (editing === e.id) {
			editing = null;
			return;
		}
		editing = e.id;
		startMode = 'original';
		endMode = 'original';
		startVal = toDateTimeInput(e.startTime, e.startTimezone);
		endVal = e.endTime != null ? toDateTimeInput(e.endTime, e.endTimezone ?? e.startTimezone) : '';
	}

	/** Switch the start field's interpretation zone, re-expressing its typed instant. */
	function setStartMode(e: SleepDTO, next: ZoneMode) {
		if (next === startMode) return;
		const prev = startZoneFor(e);
		startMode = next;
		if (startVal) startVal = toDateTimeInput(resolveLocalDateTime(startVal, prev), startZoneFor(e));
	}
	/** Switch the end field's interpretation zone, re-expressing its typed instant. */
	function setEndMode(e: SleepDTO, next: ZoneMode) {
		if (next === endMode) return;
		const prev = endZoneFor(e);
		endMode = next;
		if (endVal) endVal = toDateTimeInput(resolveLocalDateTime(endVal, prev), endZoneFor(e));
	}
</script>

<section class="space-y-5">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">History</h2>
		<a
			href={resolve('/add?from=/history')}
			class="rounded-full border border-black/15 px-3 py-1 text-xs font-medium text-indigo-600 active:scale-95 dark:border-white/20 dark:text-indigo-400"
		>
			+ Add sleep
		</a>
	</div>

	{#if form && 'message' in form && form.message}
		<p class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
			{form.message}
		</p>
	{/if}

	{#if data.groups.length === 0}
		<p class="py-8 text-center text-sm opacity-50">No sleeps logged yet.</p>
	{/if}

	{#snippet zonePicker(
		label: string,
		mode: ZoneMode,
		origAbbrev: string,
		deviceAbbrev: string,
		pick: (m: ZoneMode) => void
	)}
		<div class="text-xs">
			<span class="mb-1 block opacity-60">Enter {label.toLowerCase()} in</span>
			<div class="inline-flex rounded-lg border border-black/15 p-0.5 dark:border-white/20">
				<button
					type="button"
					onclick={() => pick('original')}
					class="rounded-md px-2 py-1 font-medium {mode === 'original'
						? 'bg-indigo-600 text-white'
						: 'opacity-70'}"
				>
					Original · {origAbbrev}
				</button>
				<button
					type="button"
					onclick={() => pick('device')}
					class="rounded-md px-2 py-1 font-medium {mode === 'device'
						? 'bg-indigo-600 text-white'
						: 'opacity-70'}"
				>
					This device · {deviceAbbrev}
				</button>
			</div>
			<p class="mt-1 opacity-50">
				Same moment either way — “This device” re-labels this end to your current zone.
			</p>
		</div>
	{/snippet}

	{#each data.groups as group (group.key)}
		<div class="space-y-2">
			<h3 class="text-sm font-medium opacity-60">{group.heading}</h3>
			<ul class="space-y-2">
				{#each group.entries as e (e.id)}
					{@const dur = durationMin(e.startTime, e.endTime)}
					{@const endTz = e.endTimezone ?? e.startTimezone}
					<li
						class="rounded-xl border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
					>
						<div class="flex items-center gap-3 p-3">
							<span class="text-lg" aria-hidden="true">{e.type === 'night' ? '🌙' : '☀️'}</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">
									{time(
										e.startTime,
										e.startTimezone
									)}{#if zoneLabel(e.startTime, e.startTimezone)}<span
											class="ml-1 rounded bg-black/[0.06] px-1 py-0.5 text-[0.65rem] font-medium opacity-70 dark:bg-white/10"
											>{zoneLabel(e.startTime, e.startTimezone)}</span
										>{/if}{#if e.endTime != null}<span class="opacity-60">–</span>{time(
											e.endTime,
											endTz
										)}{#if zoneLabel(e.endTime, endTz)}<span
												class="ml-1 rounded bg-black/[0.06] px-1 py-0.5 text-[0.65rem] font-medium opacity-70 dark:bg-white/10"
												>{zoneLabel(e.endTime, endTz)}</span
											>{/if}{:else}<span class="opacity-60"> · in progress</span>{/if}
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
								onclick={() => toggle(e)}
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
								<input type="hidden" name="startTimezone" value={startZoneFor(e)} />
								<input type="hidden" name="endTimezone" value={endZoneFor(e)} />

								<label class="block text-xs font-medium opacity-70">
									Start
									<input
										type="datetime-local"
										name="startLocal"
										bind:value={startVal}
										required
										class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
									/>
								</label>
								{#if startIsTravel(e)}
									{@render zonePicker(
										'Start',
										startMode,
										fmtZoneAbbrev(e.startTime, e.startTimezone),
										fmtZoneAbbrev(e.startTime, deviceZone),
										(m) => setStartMode(e, m)
									)}
								{/if}

								<label class="block text-xs font-medium opacity-70">
									End <span class="opacity-50">(blank = in progress)</span>
									<input
										type="datetime-local"
										name="endLocal"
										bind:value={endVal}
										class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
									/>
								</label>
								{#if endIsTravel(e)}
									{@render zonePicker(
										'End',
										endMode,
										fmtZoneAbbrev(e.endTime!, e.endTimezone ?? e.startTimezone),
										fmtZoneAbbrev(e.endTime!, deviceZone),
										(m) => setEndMode(e, m)
									)}
								{/if}

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
