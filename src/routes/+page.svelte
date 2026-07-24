<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolveClockTime } from '$lib/projection/time';
	import { browserTimeZone, fmtDuration, fmtTime as fmtTimeIn, fmtZoneAbbrev } from '$lib/format';
	import DayNav from '$lib/components/DayNav.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Live clock so the "how long" figures tick without a round-trip. Projected
	// times are absolute epoch-ms, so only the elapsed counters need this. Until
	// mount, use the server's `now` so SSR and hydration render identically.
	let ticking = $state(Date.now());
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
		const t = setInterval(() => (ticking = Date.now()), 10_000);
		return () => clearInterval(t);
	});
	const nowMs = $derived(mounted ? ticking : data.now);

	const asleep = $derived(data.asleep);
	// `data.projection`/`activeSleep` are null on past days; the live card that reads
	// these is gated off then, so benign fallbacks keep the deriveds crash-free.
	const since = $derived(
		asleep && data.activeSleep
			? data.activeSleep.start
			: (data.projection?.currentState.since ?? data.now)
	);
	const elapsedMin = $derived(Math.max(0, Math.floor((nowMs - since) / 60_000)));
	const next = $derived(data.projection?.nextSleep ?? null);
	const overdue = $derived(next != null && nowMs > next.start);
	const budget = $derived(data.projection?.budget ?? null);
	// In-day nudges from the projection engine (behavioural, read-only). See dayAdvice.ts.
	const advice = $derived(data.projection?.advice ?? []);

	// The most recent completed sleep — its end is "last wake", editable when awake.
	const lastCompleted = $derived(
		[...(data.projection?.sleeps ?? [])].reverse().find((s) => s.status === 'completed') ?? null
	);
	// The most recent completed nap, for the at-a-glance "Last nap" tile.
	const lastNap = $derived(
		[...(data.projection?.sleeps ?? [])]
			.reverse()
			.find((s) => s.type === 'nap' && s.status === 'completed' && s.end != null) ?? null
	);
	// Which timestamp the "adjust" control edits: current sleep's start, or last wake.
	const editable = $derived(
		asleep && data.activeSleep
			? { id: data.activeSleep.id, field: 'startTime' as const, current: data.activeSleep.start }
			: lastCompleted?.entryId != null && lastCompleted.end != null
				? { id: lastCompleted.entryId, field: 'endTime' as const, current: lastCompleted.end }
				: null
	);

	// Zone the "Since" instant was captured in: the active sleep's start (asleep) or
	// the last wake's end zone (awake). When it differs from today's display zone
	// (travel), render "Since" in its own zone with a label instead of silently
	// converting it — matching how History shows off-zone entries.
	const sinceZone = $derived(
		asleep && data.activeSleep
			? data.activeSleep.timezone
			: lastCompleted?.entryId
				? (data.entryZones[lastCompleted.entryId]?.end ??
					data.entryZones[lastCompleted.entryId]?.start ??
					null)
				: null
	);
	const sinceDiffers = $derived(sinceZone != null && sinceZone !== data.timeZone);

	function fmtTime(epoch: number): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timeZone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: !data.clock24h
		}).format(epoch);
	}

	/** 'HH:MM' (24h) of an epoch in the display zone, for a <input type="time">. */
	function toHHMM(epoch: number): string {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timeZone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).formatToParts(epoch);
		const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
		const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
		return `${h === '24' ? '00' : h}:${m}`;
	}

	const typeLabel = (t: 'nap' | 'night') => (t === 'night' ? 'bedtime' : 'nap');

	// The "Adjust time" panel is a <details>; its open state is uncontrolled DOM
	// state that enhance's update() won't touch, so bind it and collapse on save.
	let adjustOpen = $state(false);
</script>

<section class="space-y-3">
	<DayNav
		basePath="/"
		dayKey={data.viewedDayKey}
		isToday={data.isToday}
		prevKey={data.prevKey}
		nextKey={data.nextKey}
		todayKey={data.todayKey}
		minKey={data.minKey}
		label={data.label}
	/>

	{#if data.isToday}
		<!-- Current state -->
		<div
			class="rounded-2xl border p-4 {asleep
				? 'border-indigo-500/30 bg-indigo-500/[0.08]'
				: 'border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]'}"
		>
			<p class="text-sm font-medium text-indigo-600 dark:text-indigo-400">Right now</p>
			<p class="mt-1 text-3xl font-semibold">
				{asleep ? 'Asleep' : 'Awake'}
				<span class="text-xl font-normal opacity-60">· {fmtDuration(elapsedMin)}</span>
			</p>
			<p class="mt-1 text-sm opacity-60">
				{asleep ? 'Since' : 'Awake since'}
				{#if sinceDiffers && sinceZone}{fmtTimeIn(since, sinceZone, data.clock24h)}<span
						class="ml-1 rounded bg-black/[0.06] px-1 py-0.5 text-[0.65rem] font-medium dark:bg-white/10"
						>{fmtZoneAbbrev(since, sinceZone)}</span
					>{:else}{fmtTime(since)}{/if}{#if asleep && data.activeSleep}
					· {typeLabel(data.activeSleep.type)}{/if}
			</p>

			{#if editable}
				<details class="group mt-3 text-sm" bind:open={adjustOpen}>
					<summary class="cursor-pointer list-none opacity-60 group-open:opacity-100">
						Adjust time
					</summary>
					<form
						method="POST"
						action="?/adjust"
						class="mt-2 flex items-center gap-2"
						use:enhance={({ formData }) => {
							const hhmm = String(formData.get('hhmm') ?? '');
							formData.set(
								'time',
								String(resolveClockTime(hhmm, editable!.current, data.timeZone))
							);
							return async ({ update }) => {
								await update();
								adjustOpen = false;
							};
						}}
					>
						<input type="hidden" name="id" value={editable.id} />
						<input type="hidden" name="field" value={editable.field} />
						<input
							type="time"
							name="hhmm"
							value={toHHMM(editable.current)}
							required
							class="rounded-lg border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
						/>
						<button
							type="submit"
							class="rounded-lg bg-indigo-600 px-3 py-1 font-medium text-white active:scale-[0.98]"
						>
							Save
						</button>
					</form>
				</details>
			{/if}
		</div>

		<!-- Next sleep -->
		<div
			class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
		>
			{#if next}
				<div class="flex items-baseline justify-between">
					<p class="text-sm opacity-60">Next {typeLabel(next.type)}</p>
					{#if overdue}
						<span class="text-xs font-medium text-amber-600 dark:text-amber-400">due now</span>
					{/if}
				</div>
				<p class="mt-1 text-2xl font-semibold">{fmtTime(next.start)}</p>
				<p class="mt-1 text-sm opacity-60">
					after a {fmtDuration(next.wakeWindowBeforeMin)} wake window{#if next.wakeWindowReduced}
						· shortened after a brief nap{/if}
				</p>
			{:else}
				<p class="text-sm opacity-60">Next sleep</p>
				<p class="mt-1 text-lg font-medium opacity-70">Day complete — no sleeps left to plan.</p>
			{/if}
		</div>

		<!-- Budget (reference only) -->
		{#if budget}
			<div class="grid grid-cols-2 gap-2">
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Daytime sleep</p>
					<p class="mt-1 text-xl font-semibold">
						{fmtDuration(budget.daytimeUsedMin)}{#if budget.daytimeCapMin}<span
								class="text-sm font-normal opacity-50"
							>
								/ {fmtDuration(budget.daytimeCapMin)}</span
							>{/if}
					</p>
				</div>
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Awake today</p>
					<p class="mt-1 text-xl font-semibold">
						{fmtDuration(budget.wakeUsedMin)}<span class="text-sm font-normal opacity-50">
							/ {fmtDuration(budget.wakeBudgetMin)}</span
						>
					</p>
				</div>
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Naps done</p>
					<p class="mt-1 text-xl font-semibold">{budget.napsCompleted}</p>
				</div>
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Last nap</p>
					{#if lastNap && lastNap.end != null}
						<p class="mt-1 text-xl font-semibold">
							{fmtDuration(lastNap.durationMin ?? 0)}
						</p>
						<p class="text-xs opacity-50">{fmtTime(lastNap.start)}–{fmtTime(lastNap.end)}</p>
					{:else}
						<p class="mt-1 text-xl font-semibold opacity-40">—</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- In-day advice: read-only nudges from the projection engine. -->
		{#if advice.length > 0}
			<div class="space-y-2" data-testid="advice">
				{#each advice as a (a.id)}
					<div
						class="rounded-2xl border px-3 py-2.5 {a.severity === 'warn'
							? 'border-amber-500/30 bg-amber-500/10'
							: 'border-indigo-500/20 bg-indigo-500/[0.06]'}"
					>
						<p class="text-sm font-medium">{a.title}</p>
						<p class="mt-0.5 text-xs opacity-70">
							{a.detail}{#if a.suggestedTime != null}
								· <span class="font-medium">{fmtTime(a.suggestedTime)}</span>{/if}
						</p>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Quick-log -->
		<form
			method="POST"
			action={asleep ? '?/awake' : '?/asleep'}
			use:enhance={({ formData }) => {
				formData.set('timezone', browserTimeZone());
			}}
		>
			<button
				type="submit"
				class="w-full rounded-2xl px-4 py-4 text-lg font-semibold text-white active:scale-[0.99] {asleep
					? 'bg-slate-700 dark:bg-slate-600'
					: 'bg-indigo-600'}"
			>
				{asleep ? 'Woke up' : 'Fell asleep'}
			</button>
		</form>

		{#if form && 'message' in form && form.message}
			<p class="text-center text-sm text-amber-600 dark:text-amber-400">{form.message}</p>
		{/if}

		<p class="pt-1 text-center text-xs opacity-40">
			{data.templateName} · logs use the current time, editable above
		</p>
	{:else if data.daySummary}
		{@const summary = data.daySummary}
		{#if summary.napCount === 0 && summary.morningWake == null && summary.bedtime == null}
			<!-- Past day with nothing logged -->
			<div
				class="rounded-2xl border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
			>
				<p class="text-sm font-medium text-indigo-600 dark:text-indigo-400">{data.label}</p>
				<p class="mt-1 text-lg font-medium opacity-70">No sleeps logged</p>
			</div>
		{:else}
			<!-- Past day: read-only actuals -->
			<div
				class="rounded-2xl border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
			>
				<p class="text-sm font-medium text-indigo-600 dark:text-indigo-400">{data.label}</p>
				<p class="mt-1 text-sm opacity-60">
					Wake {summary.morningWake != null ? fmtTime(summary.morningWake) : '—'} · Bed
					{summary.bedtime != null ? fmtTime(summary.bedtime) : '—'}
				</p>
			</div>

			<!-- Day totals -->
			<div class="grid grid-cols-2 gap-3">
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Daytime sleep</p>
					<p class="mt-1 text-xl font-semibold">{fmtDuration(summary.daytimeSleepMin)}</p>
				</div>
				<div
					class="rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Awake</p>
					<p class="mt-1 text-xl font-semibold">
						{summary.awakeMin != null ? fmtDuration(summary.awakeMin) : '—'}
					</p>
				</div>
				<div
					class="col-span-2 rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
				>
					<p class="text-xs opacity-60">Naps done</p>
					<p class="mt-1 text-xl font-semibold">{summary.napCount}</p>
				</div>
			</div>
		{/if}
	{/if}
</section>
