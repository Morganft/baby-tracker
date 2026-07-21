<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import DayNav from '$lib/components/DayNav.svelte';
	import { fmtTime, fmtDuration, fmtZoneAbbrev, toTimeInput } from '$lib/format';
	import { editInit, createInit, createFrom, type SleepFormInit } from '$lib/timeline/sleepForm';
	import {
		buildChain,
		firstUnlocked,
		slotDur,
		pxToMin,
		applyResize,
		applyMove,
		applyBedtime,
		addNap as addNapArr,
		removeNap as removeNapArr,
		type Slot
	} from '$lib/timeline/planEdit';
	import type { PageData, ActionData } from './$types';
	import type { ProjectedSleep } from '$lib/projection/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'];
	const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'];

	// The open sleep popup's editable model, or null when closed. Tapping a logged
	// sleep opens it in 'edit' mode; tapping a planned (projected) one opens 'create'
	// mode prefilled with the plan. Naps and the bedtime/overnight night blocks are
	// all interactive; wake-window gaps stay display-only.
	let popup = $state<SleepFormInit | null>(null);

	/** A nap or bedtime block in the timeline: edit if logged, else create from plan. */
	function openSleep(sp: ProjectedSleep) {
		if (sp.status === 'projected') {
			popup = createInit(sp, tz);
		} else if (sp.entryId && data.entries[sp.entryId]) {
			popup = editInit(data.entries[sp.entryId]);
		}
	}

	/** The overnight block: edit last night's sleep if there is one, else log it. */
	function openOvernight() {
		const e = data.overnightEntryId ? data.entries[data.overnightEntryId] : undefined;
		if (e) popup = editInit(e);
		else if (data.overnightDraft) popup = createFrom({ ...data.overnightDraft, type: 'night' }, tz);
	}
	const close = () => (popup = null);

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

	// The timeline axis is one wall-clock (the display zone), so a logged block that
	// was captured elsewhere (travel) keeps display-zone times but gets a small chip
	// naming its own zone — the "extra info about original timezone" for a travel day.
	const zoneChip = (s: ProjectedSleep) => {
		if (!s.entryId) return '';
		const z = data.entryZones[s.entryId]?.start;
		return z && z !== tz ? fmtZoneAbbrev(s.start, z) : '';
	};

	const sleeps = $derived(data.projection.sleeps);

	// The anchor is an actual logged morning wake only once one exists; before the
	// first log it's the template's reference time, so the overnight block above it
	// is a projection, not a recorded sleep.
	const anchorIsActual = $derived(data.projection.anchorIsActual);

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

	// Breathing room (in ms) above the first wake and below bedtime. The bottom
	// pad also gives the open-ended night sleep a visible block to render into.
	const PAD_MS = 30 * 60_000;

	// Day span: from the anchor (morning wake / reference) to the last sleep's end
	// or start, widened to always include `now` and padded slightly at both ends.
	const bounds = $derived.by(() => {
		const ends = sleeps.map((s) => s.projectedEnd ?? s.start);
		const starts = sleeps.map((s) => s.start);
		// Live-only extents: past days span just their own logged sleeps (no `now`
		// line and no editable tail bedtime to grow toward).
		const liveMin = data.isToday ? [nowMs] : [];
		// Include the client-side edited tail's bedtime so the container grows as you
		// drag bedtime later (the server projection only catches up after a save).
		const liveMax = data.isToday ? [nowMs, tail.bedStart] : [];
		const start = Math.min(data.projection.anchor, ...liveMin, ...starts) - PAD_MS;
		const end = Math.max(data.projection.anchor, ...liveMax, ...ends) + PAD_MS;
		// Guard against a zero span (no sleeps yet) so the scale stays finite.
		return { start, end: end > start ? end : start + 3_600_000 };
	});

	const PX_PER_MIN = 1.4;
	// Extra pixels below the last marker; the open-ended bedtime block extends into
	// this so its faded edge meets the container bottom (no floating gap).
	const BOTTOM_PAD_PX = 24;
	const pos = (epoch: number) => ((epoch - bounds.start) / 60_000) * PX_PER_MIN;
	const height = $derived(pos(bounds.end) + BOTTOM_PAD_PX);

	// On-the-hour gridlines across the span (local wall-clock hours).
	const ticks = $derived.by(() => {
		const minuteOfHour = Number(toTimeInput(bounds.start, tz).slice(3));
		const first = bounds.start + ((60 - minuteOfHour) % 60) * 60_000;
		const out: number[] = [];
		for (let t = first; t <= bounds.end; t += 3_600_000) out.push(t);
		return out;
	});

	const nowInRange = $derived(nowMs >= bounds.start && nowMs <= bounds.end);

	// Overnight block (top pad): the tail of last night's sleep, ending at the
	// anchor (morning wake) and filling the pad above it.
	const overnight = $derived.by(() => {
		const top = pos(data.projection.anchor - PAD_MS);
		const end = pos(data.projection.anchor);
		return { top, height: Math.max(end - top, 22), wake: data.projection.anchor };
	});

	const statusStyle: Record<string, string> = {
		completed: 'border-indigo-500/40 bg-indigo-500/25',
		'in-progress': 'border-indigo-500/60 bg-indigo-500/30 animate-pulse',
		projected: 'border-dashed border-indigo-400/50 bg-indigo-400/[0.08]'
	};

	const typeLabel = (t: 'nap' | 'night', i: number) => (t === 'night' ? 'Bedtime' : `Nap ${i + 1}`);

	// ---------------------------------------------------------------------------
	// Inline editing of the *projected tail* (today only). Reshape the future naps /
	// windows / bedtime with the same gestures as the Plan editor, persisted to a
	// per-day overlay that never touches the saved plan and expires tomorrow. The
	// completed / in-progress prefix stays fixed; only the projected tail is editable.
	// ---------------------------------------------------------------------------
	const MS = 60_000;
	// Naps already logged today (completed or in progress) — the tail starts after them.
	const loggedNaps = $derived(
		sleeps.filter((s) => s.type === 'nap' && s.status !== 'projected').length
	);
	// Editable only while tonight's bedtime is still projected (nothing to reshape once
	// it's logged / the day is over).
	const editable = $derived(sleeps.some((s) => s.type === 'night' && s.status === 'projected'));
	// Where the projected tail begins: the end of the last fixed sleep, else the anchor.
	const lastWake = $derived.by(() => {
		const done = sleeps.filter((s) => s.status !== 'projected');
		if (done.length === 0) return data.projection.anchor;
		const last = done[done.length - 1];
		return last.projectedEnd ?? last.end ?? last.start;
	});

	// The editable template's tail as plain arrays (minutes). Seeded once, re-seeded
	// whenever the server sends a new plan (a save echo or a reset).
	function seedTail() {
		// Past days carry no plan (no inline editor); return an empty tail so the
		// derives below stay null-safe. The editable UI is gated off anyway.
		if (!data.plan) return { napCount: 0, wins: [] as number[], naps: [] as number[] };
		const wins = data.plan.wakeWindows.slice();
		const naps = data.plan.expectedNapDurations.slice();
		const napCount = data.plan.napCount;
		// No overlay yet: freeze the *current forecast* into the cascade so entering edit
		// is seamless — copy each projected sleep's shown window / duration into its slot.
		if (!data.overrideActive) {
			for (const sp of data.projection.sleeps) {
				if (sp.status !== 'projected') continue;
				wins[sp.index] = sp.wakeWindowBeforeMin;
				if (sp.type === 'nap' && sp.projectedEnd != null) {
					naps[sp.index] = Math.round((sp.projectedEnd - sp.start) / MS);
				}
			}
		}
		return { napCount, wins, naps };
	}
	let f = $state(seedTail());
	const serial = (x: { napCount: number; wins: number[]; naps: number[] } = f) =>
		`${x.napCount}|${x.wins.join(',')}|${x.naps.join(',')}`;
	let lastSaved = serial();
	// svelte-ignore state_referenced_locally
	let seededFrom = data.plan;
	$effect(() => {
		if (data.plan === seededFrom) return; // a fresh server load (save echo / reset)
		seededFrom = data.plan;
		f = seedTail();
		lastSaved = serial();
	});

	// The tail laid out on the wall-clock axis, cascaded from `lastWake` through `f`.
	const tail = $derived.by(() => {
		const blocks: {
			kind: 'awake' | 'nap';
			idx: number;
			start: number;
			end: number;
			min: number;
		}[] = [];
		if (!editable) return { blocks, bedStart: lastWake };
		let cursor = lastWake;
		for (let i = loggedNaps; i < f.napCount; i++) {
			const w = f.wins[i] ?? 0;
			blocks.push({ kind: 'awake', idx: i, start: cursor, end: cursor + w * MS, min: w });
			cursor += w * MS;
			const d = f.naps[i] ?? 0;
			blocks.push({ kind: 'nap', idx: i, start: cursor, end: cursor + d * MS, min: d });
			cursor += d * MS;
		}
		const wl = f.wins[f.napCount] ?? 0;
		blocks.push({ kind: 'awake', idx: f.napCount, start: cursor, end: cursor + wl * MS, min: wl });
		cursor += wl * MS;
		return { blocks, bedStart: cursor };
	});

	// Tapping a projected tail block still logs a sleep, prefilled from its shown time.
	const openTailNap = (b: { start: number; end: number }) =>
		(popup = createFrom({ start: b.start, end: b.end, type: 'nap' }, tz));
	const openTailBed = () =>
		(popup = createFrom({ start: tail.bedStart, end: null, type: 'night' }, tz));

	// --- Persist: debounced hidden-form submit to the overlay on any tail change. ---
	let saveFormEl = $state<HTMLFormElement | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (serial() === lastSaved) return; // seed / echo → nothing to persist
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveFormEl?.requestSubmit(), 600);
	});

	// --- Add / remove a projected nap (clamped so it can't drop below logged naps). ---
	function addNap() {
		const r = addNapArr(f.wins, f.naps);
		f.wins = r.wins;
		f.naps = r.naps;
		f.napCount = r.naps.length;
	}
	function removeNap(i: number) {
		if (f.napCount <= loggedNaps) return;
		const r = removeNapArr(f.wins, f.naps, i);
		f.wins = r.wins;
		f.naps = r.naps;
		f.napCount = r.naps.length;
	}

	// --- Resize a projected nap by dragging a grip; a neighbouring window absorbs it. ---
	let resizing = $state<{ idx: number; edge: 'top' | 'bottom' } | null>(null);
	let rzStartY = 0;
	let rzDur = 0;
	let rzAbs: Slot | null = null;
	let rzAbsDur = 0;
	function beginResize(e: PointerEvent, napIdx: number, edge: 'top' | 'bottom') {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const slots = buildChain(f.napCount, loggedNaps);
		const p = slots.findIndex((s) => s.kind === 'nap' && s.idx === napIdx);
		const abs = firstUnlocked(slots, p, edge === 'bottom' ? 1 : -1);
		if (!abs) return;
		resizing = { idx: napIdx, edge };
		rzStartY = e.clientY;
		rzDur = f.naps[napIdx] ?? 0;
		rzAbs = abs;
		rzAbsDur = slotDur(f.wins, f.naps, abs);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function moveResize(e: PointerEvent) {
		if (!resizing || !rzAbs) return;
		const raw = pxToMin(e.clientY - rzStartY, PX_PER_MIN);
		const delta = resizing.edge === 'bottom' ? raw : -raw;
		const r = applyResize(f.wins, f.naps, {
			napIdx: resizing.idx,
			absorb: rzAbs,
			napStart: rzDur,
			absorbStart: rzAbsDur,
			deltaMin: delta
		});
		f.wins = r.wins;
		f.naps = r.naps;
	}
	function endResize(e: PointerEvent) {
		if (!resizing) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		resizing = null;
		rzAbs = null;
	}

	// --- Drag a nap body (move) or the bedtime cap (float bedtime). Mirrors the Plan
	// editor's `movable`: mouse/pen drag directly, touch long-presses first so the page
	// keeps scrolling; a pure tap falls through to the log popup. ---
	type DragSpec = { type: 'nap-move'; index: number } | { type: 'bedtime' };
	let movingSpec = $state<DragSpec | null>(null);
	let suppressClick = false;
	function movable(node: HTMLElement, initial: { spec: DragSpec }) {
		let spec = initial.spec;
		let pointerId = -1;
		let startY = 0;
		let lastY = 0;
		let armed = false;
		let moved = false;
		let lpTimer: ReturnType<typeof setTimeout> | undefined;
		const start = { above: 0, below: 0, tail: 0 };
		let aboveSlot: Slot | null = null;
		let belowSlot: Slot | null = null;
		let tailSlot: Slot | null = null;
		const SLOP = 6;

		const capture = () => {
			const sp = spec;
			const slots = buildChain(f.napCount, loggedNaps);
			if (sp.type === 'nap-move') {
				const p = slots.findIndex((s) => s.kind === 'nap' && s.idx === sp.index);
				aboveSlot = firstUnlocked(slots, p, -1);
				belowSlot = firstUnlocked(slots, p, 1);
				start.above = aboveSlot ? slotDur(f.wins, f.naps, aboveSlot) : 0;
				start.below = belowSlot ? slotDur(f.wins, f.naps, belowSlot) : 0;
			} else {
				tailSlot = firstUnlocked(slots, slots.length, -1);
				start.tail = tailSlot ? slotDur(f.wins, f.naps, tailSlot) : 0;
			}
		};
		const applyDelta = (d: number) => {
			const sp = spec;
			if (sp.type === 'nap-move') {
				if (!aboveSlot || !belowSlot) return;
				const r = applyMove(f.wins, f.naps, {
					above: aboveSlot,
					below: belowSlot,
					aboveStart: start.above,
					belowStart: start.below,
					deltaMin: d
				});
				f.wins = r.wins;
				f.naps = r.naps;
			} else {
				if (!tailSlot) return;
				const r = applyBedtime(f.wins, f.naps, {
					tail: tailSlot,
					tailStart: start.tail,
					deltaMin: d
				});
				f.wins = r.wins;
				f.naps = r.naps;
			}
		};
		const arm = () => {
			armed = true;
			moved = false;
			capture();
			movingSpec = spec;
		};
		const onDown = (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			pointerId = e.pointerId;
			startY = e.clientY;
			lastY = e.clientY;
			moved = false;
			if (e.pointerType === 'touch') {
				armed = false;
				lpTimer = setTimeout(() => {
					startY = lastY;
					try {
						node.setPointerCapture(pointerId);
					} catch {
						/* pointer may be gone */
					}
					arm();
				}, 400);
			} else {
				try {
					node.setPointerCapture(pointerId);
				} catch {
					/* ignore */
				}
				arm();
			}
		};
		const onMove = (e: PointerEvent) => {
			lastY = e.clientY;
			if (!armed) {
				if (Math.abs(e.clientY - startY) > SLOP) clearTimeout(lpTimer);
				return;
			}
			const d = pxToMin(e.clientY - startY, PX_PER_MIN);
			if (d !== 0) moved = true;
			applyDelta(d);
			e.preventDefault();
		};
		const onTouchMove = (e: TouchEvent) => {
			if (armed) e.preventDefault();
		};
		const onUp = (e: PointerEvent) => {
			clearTimeout(lpTimer);
			if (moved) {
				suppressClick = true;
				setTimeout(() => (suppressClick = false), 0);
			}
			armed = false;
			movingSpec = null;
			try {
				node.releasePointerCapture(e.pointerId);
			} catch {
				/* capture may already be released */
			}
		};

		node.addEventListener('pointerdown', onDown);
		node.addEventListener('pointermove', onMove);
		node.addEventListener('pointerup', onUp);
		node.addEventListener('pointercancel', onUp);
		node.addEventListener('touchmove', onTouchMove, { passive: false });
		return {
			update(p: { spec: DragSpec }) {
				spec = p.spec;
			},
			destroy() {
				clearTimeout(lpTimer);
				node.removeEventListener('pointerdown', onDown);
				node.removeEventListener('pointermove', onMove);
				node.removeEventListener('pointerup', onUp);
				node.removeEventListener('pointercancel', onUp);
				node.removeEventListener('touchmove', onTouchMove);
			}
		};
	}
</script>

<section class="space-y-4">
	<DayNav
		basePath="/timeline"
		dayKey={data.viewedDayKey}
		isToday={data.isToday}
		prevKey={data.prevKey}
		nextKey={data.nextKey}
		todayKey={data.todayKey}
		minKey={data.minKey}
		label={data.label}
	/>

	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<h2 class="text-xl font-semibold">{data.isToday ? 'Today' : data.label}</h2>
			{#if data.overrideActive}
				<span
					class="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
				>
					Adjusted for today
				</span>
				<form
					method="POST"
					action="?/resetOverlay"
					use:enhance
					onsubmit={(e) => {
						if (!confirm('Discard today’s plan changes and use your saved plan?'))
							e.preventDefault();
					}}
				>
					<button
						type="submit"
						class="text-[11px] font-medium text-indigo-600 underline active:scale-95 dark:text-indigo-400"
					>
						Reset
					</button>
				</form>
			{/if}
		</div>
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
			><span class="inline-block h-3 w-3 rounded-sm border border-amber-500/40 bg-amber-500/15"
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

		<!-- Overnight sleep: the tail of last night's sleep the day woke from,
		     rendered into the top pad, ending at the anchor (morning wake). Actual
		     once a morning wake is logged; planned (dashed) before the first log,
		     when the wake time is only the template's reference. On a past day it's
		     shown only when an actual overnight entry exists (never planned). -->
		{#if data.isToday || data.overnightEntryId}
			<button
				type="button"
				onclick={openOvernight}
				class="absolute right-0 left-14 flex flex-col justify-end overflow-hidden rounded-b-lg border border-t-0 px-3 pb-1.5 text-left transition active:scale-[0.99] {anchorIsActual
					? 'border-indigo-500/40 bg-gradient-to-b from-indigo-500/[0.04] to-indigo-500/25'
					: 'border-dashed border-indigo-400/60 bg-gradient-to-b from-indigo-400/[0.02] to-indigo-400/[0.08]'}"
				style="top: {overnight.top}px; height: {overnight.height}px"
			>
				<span class="block truncate text-sm font-medium text-indigo-700 dark:text-indigo-300">
					🌙 Overnight{#if !anchorIsActual}<span class="font-normal opacity-60">
							· planned</span
						>{/if}
				</span>
				<span class="block truncate text-xs opacity-70">
					{#if anchorIsActual}woke {time(overnight.wake)}{:else}waking ~{time(overnight.wake)}{/if}
				</span>
			</button>
		{/if}

		<!-- Wake-window blocks: the awake gaps between sleeps, spanning cursor→start.
		     When the tail is editable, its projected windows are drawn by the tail
		     editor below instead, so skip the planned ones here. -->
		{#each windows as w (w.start)}
			{#if !(editable && w.planned)}
				{@const top = pos(w.start)}
				{@const h = Math.max(pos(w.end) - top, 22)}
				<div
					class="absolute right-0 left-14 flex flex-col justify-center overflow-hidden rounded-lg border px-3 {w.planned
						? 'border-dashed border-amber-500/40 bg-amber-500/[0.08]'
						: 'border-amber-500/40 bg-amber-500/15'}"
					style="top: {top}px; height: {h}px"
				>
					<p class="truncate text-xs font-medium text-amber-700/80 dark:text-amber-400/80">
						Awake{#if w.reduced}<span class="text-amber-600 dark:text-amber-400">
								· short</span
							>{/if}
					</p>
					<p class="truncate text-sm text-amber-800 dark:text-amber-300">
						{time(w.start)}–{time(w.end)} ·
						<span class="text-base font-semibold">{fmtDuration(w.min)}</span>
					</p>
				</div>
			{/if}
		{/each}

		<!-- Sleep blocks. Projected ones are drawn by the editable tail below when
		     editing is available, so skip them here. -->
		{#each sleeps as s, i (s.index)}
			{#if !(editable && s.status === 'projected')}
				{@const top = pos(s.start)}
				{#if s.type === 'night'}
					<!-- Bedtime: open-ended (the day's close), rendered as a block that
				     fills the bottom pad below its start. -->
					{@const end = s.projectedEnd ?? s.start + PAD_MS}
					{@const h = Math.max(pos(end) - top, 22) + BOTTOM_PAD_PX}
					<button
						type="button"
						onclick={() => openSleep(s)}
						class="absolute right-0 left-14 flex flex-col justify-start overflow-hidden rounded-t-lg text-left transition active:scale-[0.99] border border-b-0 bg-gradient-to-b from-indigo-500/25 to-indigo-500/[0.04] px-3 pt-1.5 {s.status ===
						'projected'
							? 'border-dashed border-indigo-400/60'
							: 'border-indigo-500/40'}"
						style="top: {top}px; height: {h}px"
					>
						<span class="block truncate text-sm font-medium text-indigo-700 dark:text-indigo-300">
							🌙 {typeLabel(s.type, i)}
							{#if s.status === 'projected'}<span class="font-normal opacity-60">
									· planned</span
								>{/if}{#if zoneChip(s)}<span
									class="ml-1 rounded bg-black/10 px-1 py-0.5 text-[0.6rem] font-medium opacity-70 dark:bg-white/10"
									>{zoneChip(s)}</span
								>{/if}
						</span>
						<span class="block truncate text-xs opacity-70">{time(s.start)}</span>
					</button>
				{:else}
					{@const end = s.projectedEnd ?? s.start}
					{@const h = Math.max(pos(end) - top, 22)}
					<button
						type="button"
						onclick={() => openSleep(s)}
						class="absolute right-0 left-14 flex flex-col justify-center overflow-hidden rounded-lg border px-3 text-left transition active:scale-[0.99] {statusStyle[
							s.status
						]}"
						style="top: {top}px; height: {h}px"
					>
						<span class="block truncate text-sm font-medium">
							{typeLabel(s.type, i)}
							{#if s.tooShort}<span class="text-amber-600 dark:text-amber-400">
									· short</span
								>{/if}{#if zoneChip(s)}<span
									class="ml-1 rounded bg-black/10 px-1 py-0.5 text-[0.6rem] font-medium opacity-70 dark:bg-white/10"
									>{zoneChip(s)}</span
								>{/if}
						</span>
						<span class="block truncate text-xs opacity-70">
							{time(s.start)}–{time(end)}
							{#if s.durationMin != null}· <span class="text-sm font-semibold"
									>{fmtDuration(s.durationMin)}</span
								>{:else if s.status === 'projected'}· <span class="text-sm font-semibold"
									>~{fmtDuration(Math.round((end - s.start) / 60_000))}</span
								>{/if}
						</span>
					</button>
				{/if}
			{/if}
		{/each}

		<!-- Editable projected tail (today only): reshape the future naps / windows /
		     bedtime with Plan-editor gestures. Drag a nap to move it, its grips to
		     resize, the bedtime cap to move it; a quick tap still logs the sleep. -->
		{#if editable}
			{#each tail.blocks as b (b.kind + b.idx)}
				{@const top = pos(b.start)}
				{@const h = Math.max(pos(b.end) - top, 22)}
				{#if b.kind === 'nap'}
					{@const moving = movingSpec?.type === 'nap-move' && movingSpec.index === b.idx}
					<button
						type="button"
						use:movable={{ spec: { type: 'nap-move', index: b.idx } }}
						onclick={() => {
							if (!suppressClick) openTailNap(b);
						}}
						class="absolute right-0 left-14 flex touch-pan-y cursor-grab flex-col justify-center overflow-hidden rounded-lg border border-dashed border-indigo-400/60 bg-indigo-400/[0.12] px-3 pr-9 text-left select-none hover:ring-2 hover:ring-indigo-400/40 {moving
							? 'z-10 cursor-grabbing ring-2 ring-indigo-500'
							: ''}"
						style="top: {top}px; height: {h}px"
					>
						<span class="truncate text-sm font-medium">
							Nap {b.idx + 1}<span class="font-normal opacity-60"> · planned</span>
						</span>
						<span class="truncate text-xs opacity-60">
							{time(b.start)}–{time(b.end)} ·
							<span class="text-sm font-semibold">{fmtDuration(b.min)}</span>
						</span>
					</button>
					{#if f.napCount > loggedNaps}
						<button
							type="button"
							aria-label="Remove nap {b.idx + 1}"
							onclick={() => removeNap(b.idx)}
							class="absolute right-1 z-30 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold text-rose-600 opacity-60 hover:opacity-100 dark:text-rose-400"
							style="top: {top + 2}px">✕</button
						>
					{/if}
					<button
						type="button"
						tabindex="-1"
						aria-label="Resize nap {b.idx + 1} start"
						onpointerdown={(e) => beginResize(e, b.idx, 'top')}
						onpointermove={moveResize}
						onpointerup={endResize}
						class="absolute right-0 left-14 z-20 flex touch-none cursor-ns-resize items-center justify-center"
						style="top: {top - 7}px; height: 14px"
					>
						<span
							class="h-1 w-8 rounded-full {resizing?.idx === b.idx && resizing.edge === 'top'
								? 'bg-indigo-500'
								: 'bg-black/25 dark:bg-white/30'}"
						></span>
					</button>
					<button
						type="button"
						tabindex="-1"
						aria-label="Resize nap {b.idx + 1} duration"
						onpointerdown={(e) => beginResize(e, b.idx, 'bottom')}
						onpointermove={moveResize}
						onpointerup={endResize}
						class="absolute right-0 left-14 z-20 flex touch-none cursor-ns-resize items-center justify-center"
						style="top: {pos(b.end) - 7}px; height: 14px"
					>
						<span
							class="h-1 w-8 rounded-full {resizing?.idx === b.idx && resizing.edge === 'bottom'
								? 'bg-indigo-500'
								: 'bg-black/25 dark:bg-white/30'}"
						></span>
					</button>
				{:else}
					<div
						class="absolute right-0 left-14 flex flex-col justify-center overflow-hidden rounded-lg border border-dashed border-amber-500/40 bg-amber-500/[0.08] px-3"
						style="top: {top}px; height: {h}px"
					>
						<p class="truncate text-xs font-medium text-amber-700/80 dark:text-amber-400/80">
							Awake
						</p>
						<p class="truncate text-sm text-amber-800 dark:text-amber-300">
							{time(b.start)}–{time(b.end)} ·
							<span class="text-base font-semibold">{fmtDuration(b.min)}</span>
						</p>
					</div>
				{/if}
			{/each}

			{@const bedTop = pos(tail.bedStart)}
			<button
				type="button"
				use:movable={{ spec: { type: 'bedtime' } }}
				onclick={() => {
					if (!suppressClick) openTailBed();
				}}
				class="absolute right-0 left-14 flex touch-pan-y cursor-grab flex-col justify-start overflow-hidden rounded-t-lg border border-b-0 border-dashed border-indigo-400/60 bg-gradient-to-b from-indigo-500/25 to-indigo-500/[0.04] px-3 pt-1.5 text-left select-none hover:ring-2 hover:ring-indigo-400/40 {movingSpec?.type ===
				'bedtime'
					? 'ring-2 ring-indigo-500'
					: ''}"
				style="top: {bedTop}px; height: {Math.max(pos(bounds.end) - bedTop, 22)}px"
			>
				<span class="block truncate text-sm font-medium text-indigo-700 dark:text-indigo-300">
					🌙 Bedtime {time(tail.bedStart)}<span class="font-normal opacity-60"> · planned</span>
				</span>
			</button>
		{/if}

		<!-- Now line (today only) -->
		{#if data.isToday && nowInRange}
			<div class="absolute inset-x-0 z-10 flex items-center" style="top: {pos(nowMs)}px">
				<span class="w-12 shrink-0 text-right text-[0.6875rem] font-semibold text-rose-500"
					>{time(nowMs)}</span
				>
				<span class="ml-2 h-0.5 flex-1 bg-rose-500/70"></span>
			</div>
		{/if}
	</div>

	{#if editable}
		<div class="flex items-center justify-between gap-2 text-xs">
			<button
				type="button"
				onclick={addNap}
				class="rounded-full border border-indigo-400/50 px-3 py-1 font-medium text-indigo-600 active:scale-95 dark:text-indigo-400"
			>
				+ Add nap
			</button>
			<span class="opacity-50">Drag naps &amp; bedtime to reshape today</span>
		</div>

		<!-- Auto-save: persist the reshaped tail to today's overlay (debounced). -->
		<form
			bind:this={saveFormEl}
			method="POST"
			action="?/saveOverlay"
			class="hidden"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
				}}
		>
			<input type="hidden" name="name" value={data.plan?.name ?? ''} />
			<input type="hidden" name="referenceWakeTime" value={data.plan?.referenceWakeTime ?? ''} />
			<input type="hidden" name="napCount" value={f.napCount} />
			<input type="hidden" name="wakeWindows" value={f.wins.join(',')} />
			<input type="hidden" name="expectedNapDurations" value={f.naps.join(',')} />
		</form>
	{/if}

	<p class="pt-1 text-center text-xs opacity-40">{data.templateName}</p>
</section>

<!-- Nap popup: edit a logged nap, or log a new one from a tapped planned nap.
     Centered modal over a dimmed backdrop (matches the templates editor). -->
{#if popup}
	<button type="button" aria-label="Close" onclick={close} class="fixed inset-0 z-40 bg-black/40"
	></button>
	<div
		role="dialog"
		aria-modal="true"
		class="fixed top-1/2 left-1/2 z-50 w-[min(24rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/15 dark:bg-neutral-900"
	>
		<div class="mb-3 flex items-center justify-between">
			<h3 class="text-base font-semibold">
				{popup.mode === 'edit' ? 'Edit' : 'Log'}
				{popup.type === 'night' ? 'night' : 'nap'}
			</h3>
			<button
				type="button"
				onclick={close}
				class="text-sm font-medium text-indigo-600 dark:text-indigo-400">Cancel</button
			>
		</div>

		{#if form && 'message' in form && form.message}
			<p
				class="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
			>
				{form.message}
			</p>
		{/if}

		<form
			method="POST"
			action={popup.mode === 'edit' ? '?/edit' : '?/create'}
			class="space-y-3"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') close();
				}}
		>
			{#if popup.mode === 'edit'}
				<input type="hidden" name="id" value={popup.id} />
			{/if}
			<input type="hidden" name="startTimezone" value={popup.startTimezone} />
			<input type="hidden" name="endTimezone" value={popup.endTimezone} />

			<label class="block text-xs font-medium opacity-70">
				Start
				<input
					type="datetime-local"
					name="startLocal"
					bind:value={popup.startLocal}
					required
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				/>
			</label>

			<label class="block text-xs font-medium opacity-70">
				End <span class="opacity-50">(blank = in progress)</span>
				<input
					type="datetime-local"
					name="endLocal"
					bind:value={popup.endLocal}
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				/>
			</label>

			<div class="grid grid-cols-2 gap-3">
				<label class="block text-xs font-medium opacity-70">
					Type
					<select
						name="type"
						bind:value={popup.type}
						class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
					>
						<option value="nap">Nap</option>
						<option value="night">Night</option>
					</select>
				</label>
				<label class="block text-xs font-medium opacity-70">
					Location
					<select
						name="location"
						bind:value={popup.location}
						class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
					>
						<option value="">—</option>
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
					bind:value={popup.putDown}
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				>
					<option value="">—</option>
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
					bind:value={popup.notes}
					placeholder="optional"
					class="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
				/>
			</label>

			<div class="flex gap-2 pt-1">
				<button
					type="submit"
					class="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white active:scale-[0.98]"
				>
					{popup.mode === 'edit' ? 'Save' : popup.type === 'night' ? 'Log night' : 'Log nap'}
				</button>
				{#if popup.mode === 'edit'}
					<button
						type="submit"
						formaction="?/delete"
						formnovalidate
						class="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 active:scale-[0.98] dark:text-rose-400"
						onclick={(ev) => {
							if (!confirm(`Delete this ${popup?.type === 'night' ? 'night' : 'nap'}?`))
								ev.preventDefault();
						}}
					>
						Delete
					</button>
				{/if}
			</div>
		</form>
	</div>
{/if}
