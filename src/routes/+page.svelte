<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { resolveClockTime } from '$lib/projection/time';
	import { browserTimeZone } from '$lib/format';
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
	const since = $derived(
		asleep && data.activeSleep ? data.activeSleep.start : data.projection.currentState.since
	);
	const elapsedMin = $derived(Math.max(0, Math.floor((nowMs - since) / 60_000)));
	const next = $derived(data.projection.nextSleep);
	const overdue = $derived(next != null && nowMs > next.start);
	const budget = $derived(data.projection.budget);

	// The most recent completed sleep — its end is "last wake", editable when awake.
	const lastCompleted = $derived(
		[...data.projection.sleeps].reverse().find((s) => s.status === 'completed') ?? null
	);
	// Which timestamp the "adjust" control edits: current sleep's start, or last wake.
	const editable = $derived(
		asleep && data.activeSleep
			? { id: data.activeSleep.id, field: 'startTime' as const, current: data.activeSleep.start }
			: lastCompleted?.entryId != null && lastCompleted.end != null
				? { id: lastCompleted.entryId, field: 'endTime' as const, current: lastCompleted.end }
				: null
	);

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

	function fmtDuration(min: number): string {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	const typeLabel = (t: 'nap' | 'night') => (t === 'night' ? 'bedtime' : 'nap');
</script>

<section class="space-y-4">
	<div class="flex justify-end">
		<a
			href={resolve('/add?from=/')}
			class="rounded-full border border-black/15 px-3 py-1 text-xs font-medium text-indigo-600 active:scale-95 dark:border-white/20 dark:text-indigo-400"
		>
			+ Add sleep
		</a>
	</div>

	<!-- Current state -->
	<div
		class="rounded-2xl border p-5 {asleep
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
			{fmtTime(since)}{#if asleep && data.activeSleep}
				· {typeLabel(data.activeSleep.type)}{/if}
		</p>

		{#if editable}
			<details class="group mt-3 text-sm">
				<summary class="cursor-pointer list-none opacity-60 group-open:opacity-100">
					Adjust time
				</summary>
				<form
					method="POST"
					action="?/adjust"
					class="mt-2 flex items-center gap-2"
					use:enhance={({ formData }) => {
						const hhmm = String(formData.get('hhmm') ?? '');
						formData.set('time', String(resolveClockTime(hhmm, editable!.current, data.timeZone)));
						return ({ update }) => update();
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
		class="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
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
	<div class="grid grid-cols-2 gap-3">
		<div
			class="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
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
			class="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
		>
			<p class="text-xs opacity-60">Awake today</p>
			<p class="mt-1 text-xl font-semibold">
				{fmtDuration(budget.wakeUsedMin)}<span class="text-sm font-normal opacity-50">
					/ {fmtDuration(budget.wakeBudgetMin)}</span
				>
			</p>
		</div>
		<div
			class="col-span-2 rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
		>
			<p class="text-xs opacity-60">Naps done</p>
			<p class="mt-1 text-xl font-semibold">{budget.napsCompleted}</p>
		</div>
	</div>

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
			class="w-full rounded-2xl px-4 py-7 text-lg font-semibold text-white active:scale-[0.99] {asleep
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
</section>
