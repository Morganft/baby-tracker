<script lang="ts">
	import { resolve } from '$app/paths';
	import { fmtTime, fmtDuration, toTimeInput } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Live "now" line: until mount, use the server's `now` so SSR and hydration
	// render identically, then tick client-side (projected times are absolute, so
	// only the now-marker needs updating).
	let ticking = $state(Date.now());
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
		const t = setInterval(() => (ticking = Date.now()), 30_000);
		return () => clearInterval(t);
	});
	const nowMs = $derived(mounted ? ticking : data.now);

	const tz = $derived(data.timeZone);
	const time = (e: number) => fmtTime(e, tz, data.clock24h);

	const sleeps = $derived(data.projection.sleeps);

	// Wake-window segments: the awake gap leading into each sleep, rendered as a
	// block spanning cursor→sleep-start with its duration (actual for logged
	// sleeps, template/redistributed otherwise). `planned` = leads into a
	// not-yet-logged sleep, so the window itself is a projection.
	const windows = $derived.by(() => {
		const out: {
			start: number;
			end: number;
			min: number;
			reduced: boolean;
			planned: boolean;
		}[] = [];
		let cursor = data.projection.anchor;
		for (const s of sleeps) {
			if (s.start > cursor) {
				out.push({
					start: cursor,
					end: s.start,
					min: s.wakeWindowBeforeMin,
					reduced: s.wakeWindowReduced,
					planned: s.status === 'projected'
				});
			}
			cursor = s.projectedEnd ?? s.end ?? s.start;
		}
		return out;
	});

	// Day span: from the anchor (morning wake / reference) to the last sleep's end
	// or start, widened to always include `now`.
	const bounds = $derived.by(() => {
		const ends = sleeps.map((s) => s.projectedEnd ?? s.start);
		const starts = sleeps.map((s) => s.start);
		const start = Math.min(data.projection.anchor, nowMs, ...starts);
		const end = Math.max(data.projection.anchor, nowMs, ...ends);
		// Guard against a zero span (no sleeps yet) so the scale stays finite.
		return { start, end: end > start ? end : start + 3_600_000 };
	});

	const PX_PER_MIN = 1.4;
	const pos = (epoch: number) => ((epoch - bounds.start) / 60_000) * PX_PER_MIN;
	const height = $derived(pos(bounds.end) + 24);

	// On-the-hour gridlines across the span (local wall-clock hours).
	const ticks = $derived.by(() => {
		const minuteOfHour = Number(toTimeInput(bounds.start, tz).slice(3));
		const first = bounds.start + ((60 - minuteOfHour) % 60) * 60_000;
		const out: number[] = [];
		for (let t = first; t <= bounds.end; t += 3_600_000) out.push(t);
		return out;
	});

	const nowInRange = $derived(nowMs >= bounds.start && nowMs <= bounds.end);

	const statusStyle: Record<string, string> = {
		completed: 'border-indigo-500/40 bg-indigo-500/25',
		'in-progress': 'border-indigo-500/60 bg-indigo-500/30 animate-pulse',
		projected: 'border-dashed border-indigo-400/50 bg-indigo-400/[0.08]'
	};

	const typeLabel = (t: 'nap' | 'night', i: number) => (t === 'night' ? 'Bedtime' : `Nap ${i + 1}`);
</script>

<section class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Today</h2>
		<a
			href={resolve('/add?from=/timeline')}
			class="rounded-full border border-black/15 px-3 py-1 text-xs font-medium text-indigo-600 active:scale-95 dark:border-white/20 dark:text-indigo-400"
		>
			+ Add sleep
		</a>
	</div>

	<div class="flex gap-3 text-xs opacity-70">
		<span class="flex items-center gap-1"
			><span class="inline-block h-3 w-3 rounded-sm border border-indigo-500/40 bg-indigo-500/25"
			></span> actual</span
		>
		<span class="flex items-center gap-1"
			><span
				class="inline-block h-3 w-3 rounded-sm border border-dashed border-indigo-400/50 bg-indigo-400/[0.08]"
			></span> planned</span
		>
		<span class="flex items-center gap-1"
			><span
				class="inline-block h-3 w-3 rounded-sm border border-black/10 bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.05]"
			></span> awake</span
		>
	</div>

	<div class="relative" style="height: {height}px">
		<!-- Hour gridlines + labels -->
		{#each ticks as t (t)}
			<div class="absolute inset-x-0 flex items-center" style="top: {pos(t)}px">
				<span class="w-12 shrink-0 text-right text-[0.6875rem] tabular-nums opacity-40"
					>{time(t)}</span
				>
				<span class="ml-2 h-px flex-1 bg-black/5 dark:bg-white/5"></span>
			</div>
		{/each}

		<!-- Wake-window blocks: the awake gaps between sleeps, spanning cursor→start -->
		{#each windows as w (w.start)}
			{@const top = pos(w.start)}
			{@const h = Math.max(pos(w.end) - top, 22)}
			<div
				class="absolute right-0 left-14 flex flex-col justify-center overflow-hidden rounded-lg border px-3 {w.planned
					? 'border-dashed border-black/15 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.02]'
					: 'border-black/10 bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.05]'}"
				style="top: {top}px; height: {h}px"
			>
				<p class="truncate text-sm font-medium opacity-70">
					Awake{#if w.reduced}<span class="text-amber-600 dark:text-amber-400"> · short</span>{/if}
				</p>
				<p class="truncate text-xs opacity-60">
					{time(w.start)}–{time(w.end)} · {fmtDuration(w.min)}
				</p>
			</div>
		{/each}

		<!-- Sleep blocks -->
		{#each sleeps as s, i (s.index)}
			{@const top = pos(s.start)}
			{#if s.type === 'night'}
				<!-- Bedtime: a marker line (no fixed end while it's the day's close). -->
				<div class="absolute right-0 left-14 flex items-center gap-2" style="top: {top}px">
					<span class="h-px flex-1 bg-indigo-500/40"></span>
					<span
						class="rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
					>
						🌙 {typeLabel(s.type, i)} · {time(s.start)}
						{#if s.status === 'projected'}<span class="font-normal opacity-60">
								(planned)</span
							>{/if}
					</span>
				</div>
			{:else}
				{@const end = s.projectedEnd ?? s.start}
				{@const h = Math.max(pos(end) - top, 22)}
				<div
					class="absolute right-0 left-14 flex flex-col justify-center overflow-hidden rounded-lg border px-3 {statusStyle[
						s.status
					]}"
					style="top: {top}px; height: {h}px"
				>
					<p class="truncate text-sm font-medium">
						{typeLabel(s.type, i)}
						{#if s.tooShort}<span class="text-amber-600 dark:text-amber-400"> · short</span>{/if}
					</p>
					<p class="truncate text-xs opacity-70">
						{time(s.start)}–{time(end)}
						{#if s.durationMin != null}· {fmtDuration(
								s.durationMin
							)}{:else if s.status === 'projected'}· ~{fmtDuration(
								Math.round((end - s.start) / 60_000)
							)}{/if}
					</p>
				</div>
			{/if}
		{/each}

		<!-- Now line -->
		{#if nowInRange}
			<div class="absolute inset-x-0 z-10 flex items-center" style="top: {pos(nowMs)}px">
				<span class="w-12 shrink-0 text-right text-[0.6875rem] font-semibold text-rose-500"
					>{time(nowMs)}</span
				>
				<span class="ml-2 h-0.5 flex-1 bg-rose-500/70"></span>
			</div>
		{/if}
	</div>

	<p class="pt-1 text-center text-xs opacity-40">{data.templateName}</p>
</section>
