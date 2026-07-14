<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { initHistory, commit, undo, redo, type History } from '$lib/timeline/history';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const active = $derived(data.active);
	const library = $derived(data.library);

	const inputClass =
		'mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20';

	// Live copies of the fields the reference diagram draws from, so it redraws as
	// you type. Seeded once from the active plan (the reads below are a deliberate
	// snapshot, not a live link) and re-seeded by the $effect whenever the server
	// sends a different plan — a Load / Save / Overwrite reloads `data.active`.
	// svelte-ignore state_referenced_locally
	let f = $state({
		referenceWakeTime: data.active.referenceWakeTime,
		napCount: data.active.napCount,
		wakeWindows: data.active.wakeWindows.join(', '),
		expectedNapDurations: data.active.expectedNapDurations.join(', '),
		targetBedtime: data.active.targetBedtime ?? ''
	});
	// --- Undo / redo. A snapshot of exactly the timeline-driven fields in `f`;
	// the reversible unit for a drag, resize, tap-edit, or add/remove-nap. ---
	type Snap = {
		referenceWakeTime: string;
		napCount: number;
		wakeWindows: string;
		expectedNapDurations: string;
		targetBedtime: string;
	};
	const snapshot = (): Snap => ({
		referenceWakeTime: f.referenceWakeTime,
		napCount: f.napCount,
		wakeWindows: f.wakeWindows,
		expectedNapDurations: f.expectedNapDurations,
		targetBedtime: f.targetBedtime
	});
	function applySnap(s: Snap) {
		f.referenceWakeTime = s.referenceWakeTime;
		f.napCount = s.napCount;
		f.wakeWindows = s.wakeWindows;
		f.expectedNapDurations = s.expectedNapDurations;
		f.targetBedtime = s.targetBedtime;
	}
	const snapEqual = (a: Snap, b: Snap) =>
		a.referenceWakeTime === b.referenceWakeTime &&
		a.napCount === b.napCount &&
		a.wakeWindows === b.wakeWindows &&
		a.expectedNapDurations === b.expectedNapDurations &&
		a.targetBedtime === b.targetBedtime;

	let hist = $state<History<Snap>>(initHistory(snapshot()));
	const canUndo = $derived(hist.past.length > 0);
	const canRedo = $derived(hist.future.length > 0);

	// A burst of edits (a drag fires many mutations) is folded into a single undo
	// step: we commit the settled value on a debounce rather than per mutation.
	let commitTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleCommit() {
		clearTimeout(commitTimer);
		commitTimer = setTimeout(() => (hist = commit(hist, snapshot(), snapEqual)), 500);
	}
	function doUndo() {
		clearTimeout(commitTimer);
		const step = undo(hist, snapshot(), snapEqual);
		if (!step) return;
		hist = step.history;
		applySnap(step.value); // re-arms the save effect, so the undo persists
	}
	function doRedo() {
		clearTimeout(commitTimer);
		const step = redo(hist, snapshot(), snapEqual);
		if (!step) return;
		hist = step.history;
		applySnap(step.value);
	}

	// svelte-ignore state_referenced_locally
	let seededFrom = data.active;
	$effect(() => {
		if (active === seededFrom) return;
		seededFrom = active;
		const next: Snap = {
			referenceWakeTime: active.referenceWakeTime,
			napCount: active.napCount,
			wakeWindows: active.wakeWindows.join(', '),
			expectedNapDurations: active.expectedNapDurations.join(', '),
			targetBedtime: active.targetBedtime ?? ''
		};
		// An auto-save reload echoes the on-screen values (next === current), so
		// history is left intact. A Load/Overwrite brings a different plan — treat
		// that as a fresh document and reset the undo history to it.
		const external = !snapEqual(next, untrack(snapshot));
		applySnap(next);
		if (external) hist = initHistory(next);
	});

	/** 'HH:MM' → minutes past midnight, or null if not a valid time. */
	function parseHM(v: string): number | null {
		const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
		if (!m) return null;
		const h = Number(m[1]);
		const min = Number(m[2]);
		if (h > 23 || min > 59) return null;
		return h * 60 + min;
	}

	/** Comma-separated minutes → finite non-negative number[]. */
	function parseCsv(v: string): number[] {
		return v
			.split(',')
			.map((t) => t.trim())
			.filter((t) => t.length > 0)
			.map(Number)
			.filter((n) => Number.isFinite(n) && n >= 0);
	}

	/** Minutes-past-midnight → clock label, honouring the 12/24h preference. */
	function fmtClock(minOfDay: number): string {
		const m = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
		const h = Math.floor(m / 60);
		const mm = String(m % 60).padStart(2, '0');
		if (data.clock24h) return `${String(h).padStart(2, '0')}:${mm}`;
		const period = h < 12 ? 'am' : 'pm';
		const h12 = h % 12 === 0 ? 12 : h % 12;
		return `${h12}:${mm}${period}`;
	}

	function fmtDur(min: number): string {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
	}

	type Block = {
		kind: 'awake' | 'nap';
		/** awake-window index (0..napCount) or nap index (0..napCount-1). */
		idx: number;
		startMin: number; // minutes past the reference wake
		endMin: number;
		min: number;
		startClock: string;
		endClock: string;
	};

	// The plan's day: cascade the wake windows and expected nap durations down from
	// the reference wake to bedtime. Purely the template's own shape — it does not
	// model the target-bedtime redistribution the projection engine applies.
	const plan = $derived.by(() => {
		const wake = parseHM(f.referenceWakeTime);
		const n = Math.max(0, Math.floor(Number(f.napCount)) || 0);
		const ww = parseCsv(f.wakeWindows);
		const nd = parseCsv(f.expectedNapDurations);

		const issues: string[] = [];
		if (wake === null) issues.push('Set a valid reference wake time.');
		if (ww.length !== n + 1)
			issues.push(`Wake windows need ${n + 1} value${n === 0 ? '' : 's'} (has ${ww.length}).`);
		if (nd.length !== n)
			issues.push(
				`Expected nap durations need ${n} value${n === 1 ? '' : 's'} (has ${nd.length}).`
			);
		if (issues.length > 0) return { ok: false as const, issues };

		const anchor = wake as number;
		const blocks: Block[] = [];
		let cursor = 0; // minutes past wake
		const push = (kind: 'awake' | 'nap', idx: number, min: number) => {
			blocks.push({
				kind,
				idx,
				startMin: cursor,
				endMin: cursor + min,
				min,
				startClock: fmtClock(anchor + cursor),
				endClock: fmtClock(anchor + cursor + min)
			});
			cursor += min;
		};
		for (let i = 0; i < n; i++) {
			push('awake', i, ww[i]);
			push('nap', i, nd[i]);
		}
		push('awake', n, ww[n]); // final window leading into bedtime

		const target = parseHM(f.targetBedtime);
		return {
			ok: true as const,
			anchor,
			blocks,
			bedMin: cursor, // wake → bedtime, minutes
			wakeClock: fmtClock(anchor),
			bedClock: fmtClock(anchor + cursor),
			napCount: n,
			daySleep: nd.reduce((a, b) => a + b, 0),
			awakeTotal: ww.reduce((a, b) => a + b, 0),
			targetClock: target === null ? null : fmtClock(target)
		};
	});

	// --- Timeline geometry (vertical, minutes → pixels, like the Today view) ---
	const TOP_PAD = 30; // overnight cap above the wake anchor
	const BOTTOM_PAD = 44; // room for the open-ended bedtime block
	const PX_PER_MIN = 1.2;
	/** y-pixel of a minutes-from-wake offset (top of container = wake − TOP_PAD). */
	const y = (minFromWake: number) => (TOP_PAD + minFromWake) * PX_PER_MIN;

	// On-the-hour gridlines across the drawn span.
	const grid = $derived.by(() => {
		if (!plan.ok) return [];
		const startAbs = plan.anchor - TOP_PAD;
		const endAbs = plan.anchor + plan.bedMin + BOTTOM_PAD;
		const out: { clock: string; m: number }[] = [];
		for (let t = Math.ceil(startAbs / 60) * 60; t <= endAbs; t += 60) {
			out.push({ clock: fmtClock(t), m: t - plan.anchor });
		}
		return out;
	});

	// --- Editing: tap a block to open its editor in the popup. ---
	type Editing =
		| { kind: 'wake' }
		| { kind: 'awake'; index: number }
		| { kind: 'nap'; index: number }
		| { kind: 'bed' };
	let editing = $state<Editing | null>(null);
	const close = () => (editing = null);

	function editorTitle(e: Editing): string {
		switch (e.kind) {
			case 'wake':
				return 'Wake time';
			case 'awake':
				return `Awake window ${e.index + 1}`;
			case 'nap':
				return `Nap ${e.index + 1}`;
			case 'bed':
				return 'Bedtime';
		}
	}

	// Read/write a single wake window or nap duration through the CSV strings in `f`,
	// so the timeline, popups, drag handles and hidden form fields stay in lockstep.
	const winAt = (i: number) => parseCsv(f.wakeWindows)[i] ?? 0;
	const napAt = (i: number) => parseCsv(f.expectedNapDurations)[i] ?? 0;
	function setWin(i: number, v: number) {
		const a = parseCsv(f.wakeWindows);
		a[i] = Math.max(0, Math.round(v) || 0);
		f.wakeWindows = a.join(', ');
	}
	function setNap(i: number, v: number) {
		const a = parseCsv(f.expectedNapDurations);
		a[i] = Math.max(0, Math.round(v) || 0);
		f.expectedNapDurations = a.join(', ');
	}
	const numVal = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

	const SNAP_MIN = 5;

	// Write two wake windows (or a nap duration + a window) at once — a single
	// reparse/join, so a redistribution stays atomic.
	function setWindows2(i: number, vi: number, j: number, vj: number) {
		const a = parseCsv(f.wakeWindows);
		a[i] = Math.max(0, Math.round(vi));
		a[j] = Math.max(0, Math.round(vj));
		f.wakeWindows = a.join(', ');
	}
	function setNapAndWindow(napIdx: number, dur: number, winIdx: number, win: number) {
		const nd = parseCsv(f.expectedNapDurations);
		nd[napIdx] = Math.max(0, Math.round(dur));
		f.expectedNapDurations = nd.join(', ');
		const ww = parseCsv(f.wakeWindows);
		ww[winIdx] = Math.max(0, Math.round(win));
		f.wakeWindows = ww.join(', ');
	}
	const finalWinIdx = () => Math.max(0, parseCsv(f.wakeWindows).length - 1);
	/** Set the reference wake to a minutes-of-day value (wrapped to 00:00–23:59). */
	function setWakeFromMin(minOfDay: number) {
		const v = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
		const hh = String(Math.floor(v / 60)).padStart(2, '0');
		const mm = String(v % 60).padStart(2, '0');
		f.referenceWakeTime = `${hh}:${mm}`;
	}

	// --- Resize a nap by dragging a grip on either edge. The duration changes and a
	// single neighbouring window absorbs it, so bedtime and every other sleep stay put.
	// The bottom grip grows the nap downward (the *following* window shrinks); the top
	// grip grows it upward (the *preceding* window shrinks — the nap starts earlier).
	// Snap to 5 min; clamp so neither the duration nor the borrowed-from window goes
	// negative. ---
	let resizing = $state<{ idx: number; edge: 'top' | 'bottom' } | null>(null);
	let rzStartY = 0;
	let rzDur = 0;
	let rzWin = 0; // the window that absorbs the change (following or preceding)
	function beginResize(e: PointerEvent, napIdx: number, edge: 'top' | 'bottom') {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		resizing = { idx: napIdx, edge };
		rzStartY = e.clientY;
		rzDur = napAt(napIdx);
		rzWin = winAt(edge === 'bottom' ? napIdx + 1 : napIdx);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function moveResize(e: PointerEvent) {
		if (!resizing) return;
		const raw = Math.round((e.clientY - rzStartY) / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
		// Dragging the bottom grip down (raw > 0) or the top grip up (raw < 0) both grow
		// the nap; the absorbing window shrinks by the same amount.
		const delta = resizing.edge === 'bottom' ? raw : -raw;
		const d = Math.min(rzWin, Math.max(-rzDur, delta)); // keep duration and window ≥ 0
		const winIdx = resizing.edge === 'bottom' ? resizing.idx + 1 : resizing.idx;
		setNapAndWindow(resizing.idx, rzDur + d, winIdx, rzWin - d);
	}
	function endResize(e: PointerEvent) {
		if (!resizing) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		resizing = null;
	}

	// --- Auto-save: every timeline / popup / Advanced edit persists on its own
	// (debounced) — there is no Save button. We reuse the `editActive` action by
	// submitting a hidden form programmatically. ---
	let formEl = $state<HTMLFormElement | null>(null);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => formEl?.requestSubmit(), 600);
	}
	// Persist when a timeline-driven field changes. Skip the first run (mount) and
	// the re-seed from a server reload, which writes identical values and so never
	// re-triggers this effect.
	let saveArmed = false;
	$effect(() => {
		void [f.referenceWakeTime, f.napCount, f.wakeWindows, f.expectedNapDurations, f.targetBedtime];
		if (!saveArmed) {
			saveArmed = true;
			return;
		}
		scheduleSave();
		scheduleCommit();
	});

	// --- Add / remove naps: keep the three parallel arrays consistent (windows have
	// one more entry than naps — the trailing one leads into bedtime). ---
	function addNap() {
		const ww = parseCsv(f.wakeWindows);
		const nd = parseCsv(f.expectedNapDurations);
		const n = nd.length;
		nd.push(nd[n - 1] ?? 60); // clone the last nap's duration
		ww.splice(Math.max(0, ww.length - 1), 0, ww[n] ?? ww[n - 1] ?? 90); // insert before the bedtime window
		f.expectedNapDurations = nd.join(', ');
		f.wakeWindows = ww.join(', ');
		f.napCount = n + 1;
	}
	function removeNap(i: number) {
		const ww = parseCsv(f.wakeWindows);
		const nd = parseCsv(f.expectedNapDurations);
		if (i < 0 || i >= nd.length) return;
		nd.splice(i, 1);
		ww.splice(i, 1); // drop the window leading into the removed nap
		f.expectedNapDurations = nd.join(', ');
		f.wakeWindows = ww.join(', ');
		f.napCount = nd.length;
		close();
	}

	// --- Drag a nap body or a cap. Adaptive: a mouse/pen drags directly; touch must
	// long-press first, so the timeline keeps scrolling until the gesture "lifts". A
	// pure click (no move) falls through to open the popup. Behaviours:
	//  • nap-move  — the nap slides between its two neighbouring windows: the one
	//    before shrinks while the one after grows by the same amount (and vice versa),
	//    so its duration, bedtime and every other sleep stay put.
	//  • day-start — shifts the reference wake time (the whole day re-times).
	//  • bedtime   — grows/shrinks the final window (bedtime moves; nothing above).
	// A future "lock" mode could instead carry a locked window rigidly with the nap.
	type DragSpec =
		| { type: 'none' }
		| { type: 'nap-move'; index: number }
		| { type: 'day-start' }
		| { type: 'bedtime' };
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
		// Values captured at gesture start, so each move is relative to a fixed base.
		const start = { before: 0, after: 0, final: 0, wake: 0 };
		const SLOP = 6;

		const capture = () => {
			if (spec.type === 'nap-move') {
				start.before = winAt(spec.index);
				start.after = winAt(spec.index + 1);
			} else if (spec.type === 'bedtime') {
				start.final = winAt(finalWinIdx());
			} else if (spec.type === 'day-start') {
				start.wake = parseHM(f.referenceWakeTime) ?? 0;
			}
		};
		const applyDelta = (d: number) => {
			if (spec.type === 'nap-move') {
				const dd = Math.min(start.after, Math.max(-start.before, d)); // both windows ≥ 0
				setWindows2(spec.index, start.before + dd, spec.index + 1, start.after - dd);
			} else if (spec.type === 'bedtime') {
				setWin(finalWinIdx(), Math.max(0, start.final + d));
			} else if (spec.type === 'day-start') {
				setWakeFromMin(start.wake + d);
			}
		};
		const arm = () => {
			armed = true;
			moved = false;
			capture();
			movingSpec = spec;
			if ('vibrate' in navigator) navigator.vibrate(8);
		};
		const onDown = (e: PointerEvent) => {
			if (spec.type === 'none') return;
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			pointerId = e.pointerId;
			startY = e.clientY;
			lastY = e.clientY;
			moved = false;
			if (e.pointerType === 'touch') {
				armed = false;
				lpTimer = setTimeout(() => {
					startY = lastY; // re-anchor if the finger drifted within slop
					try {
						node.setPointerCapture(pointerId);
					} catch {
						/* pointer may be gone */
					}
					arm();
				}, 400);
			} else {
				// Mouse/pen: arm immediately for a direct drag. Don't preventDefault here
				// — it can swallow the click we rely on for tap-to-open; `select-none`
				// already suppresses text selection during the drag.
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
				if (Math.abs(e.clientY - startY) > SLOP) clearTimeout(lpTimer); // moved first → it's a scroll
				return;
			}
			const d = Math.round((e.clientY - startY) / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
			if (d !== 0) moved = true;
			applyDelta(d);
			e.preventDefault();
		};
		const onTouchMove = (e: TouchEvent) => {
			if (armed) e.preventDefault(); // block page scroll while a move is in progress
		};
		const onUp = (e: PointerEvent) => {
			clearTimeout(lpTimer);
			if (moved) {
				suppressClick = true; // the following click is the drag's tail — swallow it
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

	<div class="flex flex-col gap-6 lg:flex-row lg:items-start">
		<!-- Main column: the editable timeline + the raw field form -->
		<div class="order-1 space-y-6 lg:order-2 lg:min-w-0 lg:flex-1">
			<!-- Reference day: a Today-style vertical timeline. Tap any block to edit it. -->
			<div class="space-y-3 rounded-2xl border border-black/10 p-4 dark:border-white/10">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-semibold">Reference day</h3>
					<div class="flex items-center gap-2">
						{#if plan.ok}
							<span class="text-xs opacity-60">{plan.wakeClock} → {plan.bedClock}</span>
						{/if}
						<div class="flex items-center gap-0.5">
							<button
								type="button"
								onclick={doUndo}
								disabled={!canUndo}
								title="Undo (Ctrl+Z)"
								aria-label="Undo"
								class="rounded-lg border border-black/10 px-2 py-1 text-sm leading-none active:scale-95 disabled:opacity-30 dark:border-white/15"
								>↶</button
							>
							<button
								type="button"
								onclick={doRedo}
								disabled={!canRedo}
								title="Redo (Ctrl+Shift+Z)"
								aria-label="Redo"
								class="rounded-lg border border-black/10 px-2 py-1 text-sm leading-none active:scale-95 disabled:opacity-30 dark:border-white/15"
								>↷</button
							>
						</div>
					</div>
				</div>

				<p class="text-[0.6875rem] opacity-50">
					Tap to edit · drag a nap or a cap to move · drag a nap's <span class="opacity-80">⇕</span>
					grip to resize.
				</p>

				{#if !plan.ok}
					<ul class="space-y-1 text-xs opacity-60">
						{#each plan.issues as issue (issue)}
							<li>· {issue}</li>
						{/each}
					</ul>
				{:else}
					<div class="relative" style="height: {y(plan.bedMin) + BOTTOM_PAD}px">
						<!-- Hour gridlines -->
						{#each grid as g (g.m)}
							<div class="absolute inset-x-0 flex items-center" style="top: {y(g.m)}px">
								<span class="w-12 shrink-0 text-right text-[0.6875rem] tabular-nums opacity-40"
									>{g.clock}</span
								>
								<span class="ml-2 h-px flex-1 bg-black/5 dark:bg-white/5"></span>
							</div>
						{/each}

						<!-- Day-start cap → drag to shift the wake time, tap to set it exactly -->
						<button
							type="button"
							use:movable={{ spec: { type: 'day-start' } }}
							onclick={() => {
								if (suppressClick) return;
								editing = { kind: 'wake' };
							}}
							class="absolute right-0 left-14 flex touch-pan-y cursor-grab flex-col justify-end overflow-hidden rounded-b-lg border border-t-0 border-indigo-500/40 bg-gradient-to-b from-indigo-500/[0.04] to-indigo-500/20 px-3 pb-1.5 text-left select-none hover:ring-2 hover:ring-indigo-400/40 {movingSpec?.type ===
							'day-start'
								? 'ring-2 ring-indigo-500'
								: ''}"
							style="top: 0; height: {y(0)}px"
						>
							<p class="truncate text-sm font-medium text-indigo-700 dark:text-indigo-300">
								🌅 Day starts {plan.wakeClock}
							</p>
							<p class="truncate text-xs opacity-70">drag or tap to set the wake time</p>
						</button>

						<!-- Awake windows + naps -->
						{#each plan.blocks as b (b.kind + b.idx)}
							{@const top = y(b.startMin)}
							{@const h = Math.max(y(b.endMin) - top, 20)}
							{@const isNap = b.kind === 'nap'}
							{@const moving = movingSpec?.type === 'nap-move' && movingSpec.index === b.idx}
							<button
								type="button"
								use:movable={{
									spec: isNap ? { type: 'nap-move', index: b.idx } : { type: 'none' }
								}}
								onclick={() => {
									if (suppressClick) return;
									editing = isNap ? { kind: 'nap', index: b.idx } : { kind: 'awake', index: b.idx };
								}}
								class="absolute right-0 left-14 flex touch-pan-y flex-col justify-center overflow-hidden rounded-lg border px-3 text-left select-none hover:ring-2 hover:ring-indigo-400/40 {isNap
									? `cursor-grab border-indigo-500/40 bg-indigo-500/25 ${moving ? 'z-10 cursor-grabbing ring-2 ring-indigo-500' : ''}`
									: 'border-black/10 bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.05]'}"
								style="top: {top}px; height: {h}px"
							>
								<p class="truncate text-sm font-medium {isNap ? '' : 'opacity-70'}">
									{isNap ? `Nap ${b.idx + 1}` : 'Awake'}
								</p>
								<p class="truncate text-xs opacity-60">
									{b.startClock}–{b.endClock} · {fmtDur(b.min)}
								</p>
							</button>
							{#if isNap}
								<!-- Top grip → grow this nap upward; the preceding window absorbs it -->
								<button
									type="button"
									tabindex="-1"
									aria-label="Resize nap {b.idx + 1} start"
									onpointerdown={(e) => beginResize(e, b.idx, 'top')}
									onpointermove={moveResize}
									onpointerup={endResize}
									class="absolute right-0 left-14 z-20 flex touch-none cursor-ns-resize items-center justify-center"
									style="top: {y(b.startMin) - 7}px; height: 14px"
								>
									<span
										class="h-1 w-8 rounded-full {resizing?.idx === b.idx && resizing.edge === 'top'
											? 'bg-indigo-500'
											: 'bg-black/25 dark:bg-white/30'}"
									></span>
								</button>
								<!-- Bottom grip → change this nap's duration; the next window absorbs it -->
								<button
									type="button"
									tabindex="-1"
									aria-label="Resize nap {b.idx + 1} duration"
									onpointerdown={(e) => beginResize(e, b.idx, 'bottom')}
									onpointermove={moveResize}
									onpointerup={endResize}
									class="absolute right-0 left-14 z-20 flex touch-none cursor-ns-resize items-center justify-center"
									style="top: {y(b.endMin) - 7}px; height: 14px"
								>
									<span
										class="h-1 w-8 rounded-full {resizing?.idx === b.idx &&
										resizing.edge === 'bottom'
											? 'bg-indigo-500'
											: 'bg-black/25 dark:bg-white/30'}"
									></span>
								</button>
							{/if}
						{/each}

						<!-- Bedtime cap → drag to move bedtime (final window), tap for exact + target -->
						<button
							type="button"
							use:movable={{ spec: { type: 'bedtime' } }}
							onclick={() => {
								if (suppressClick) return;
								editing = { kind: 'bed' };
							}}
							class="absolute right-0 left-14 flex touch-pan-y cursor-grab flex-col justify-start overflow-hidden rounded-t-lg border border-b-0 border-indigo-500/40 bg-gradient-to-b from-indigo-500/25 to-indigo-500/[0.04] px-3 pt-1.5 text-left select-none hover:ring-2 hover:ring-indigo-400/40 {movingSpec?.type ===
							'bedtime'
								? 'ring-2 ring-indigo-500'
								: ''}"
							style="top: {y(plan.bedMin)}px; height: {BOTTOM_PAD}px"
						>
							<p class="truncate text-sm font-medium text-indigo-700 dark:text-indigo-300">
								🌙 Bedtime {plan.bedClock}{#if plan.targetClock}<span
										class="font-normal opacity-60"
									>
										· target {plan.targetClock}</span
									>{/if}
							</p>
						</button>
					</div>

					<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs opacity-70">
						<span
							>{plan.napCount} nap{plan.napCount === 1 ? '' : 's'} · {fmtDur(plan.daySleep)} day sleep</span
						>
						<span>{fmtDur(plan.awakeTotal)} awake</span>
						<button
							type="button"
							onclick={addNap}
							class="rounded-full border border-indigo-500/40 px-2.5 py-0.5 font-medium text-indigo-600 opacity-100 active:scale-95 dark:text-indigo-400"
						>
							+ Add nap
						</button>
						{#if plan.targetClock}
							<span class="text-indigo-600 dark:text-indigo-400"
								>target bedtime {plan.targetClock} — sleeps redistribute to land here</span
							>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Auto-saving editor: hidden timeline fields + an Advanced drawer. The
			     cascade is edited on the timeline / in the popups, so there's no Save
			     button — every change persists on its own (debounced). -->
			<form
				bind:this={formEl}
				method="POST"
				action="?/editActive"
				class="space-y-3"
				use:enhance={() => {
					saveState = 'saving';
					return async ({ update, result }) => {
						// reset:false keeps the Advanced inputs' typed values (they come from
						// `value={active.x}`, which enhance's default reset would blank).
						await update({ reset: false });
						saveState = result.type === 'success' ? 'saved' : 'error';
					};
				}}
			>
				<!-- Driven by the timeline + popups (not shown as fields). -->
				<input type="hidden" name="referenceWakeTime" value={f.referenceWakeTime} />
				<input type="hidden" name="napCount" value={f.napCount} />
				<input type="hidden" name="wakeWindows" value={f.wakeWindows} />
				<input type="hidden" name="expectedNapDurations" value={f.expectedNapDurations} />
				<input type="hidden" name="targetBedtime" value={f.targetBedtime} />

				<p class="px-1 text-xs opacity-60">
					{#if saveState === 'saving'}
						Saving…
					{:else if saveState === 'saved'}
						All changes saved ✓
					{:else if saveState === 'error'}
						<span class="text-amber-600 dark:text-amber-400"
							>Couldn’t save — check the Advanced fields.</span
						>
					{:else}
						Edits save automatically.
					{/if}
				</p>

				<details class="rounded-2xl border border-black/10 p-4 dark:border-white/10">
					<summary class="cursor-pointer text-sm font-medium">Advanced</summary>
					<div class="mt-3 space-y-4 text-xs">
						<label class="block font-medium opacity-70">
							Plan name
							<input
								name="name"
								value={active.name}
								oninput={scheduleSave}
								required
								class={inputClass}
							/>
						</label>

						<div class="space-y-2">
							<p class="font-medium opacity-70">Redistribution bounds (optional)</p>
							<p class="text-[0.6875rem] font-normal opacity-50">
								Min/max minutes per position, comma-separated. Windows need {Number(f.napCount) + 1} values,
								naps need {Number(f.napCount)}. Only used when a target bedtime is set.
							</p>
							<div class="grid grid-cols-2 gap-3">
								<label class="block font-medium opacity-70">
									Wake window min
									<input
										name="wakeWindowMin"
										value={active.wakeWindowMin?.join(', ') ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
								<label class="block font-medium opacity-70">
									Wake window max
									<input
										name="wakeWindowMax"
										value={active.wakeWindowMax?.join(', ') ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
								<label class="block font-medium opacity-70">
									Nap duration min
									<input
										name="napDurationMin"
										value={active.napDurationMin?.join(', ') ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
								<label class="block font-medium opacity-70">
									Nap duration max
									<input
										name="napDurationMax"
										value={active.napDurationMax?.join(', ') ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
							</div>
						</div>

						<div class="space-y-2">
							<p class="font-medium opacity-70">Reference budget (optional)</p>
							<div class="grid grid-cols-2 gap-3">
								<label class="block font-medium opacity-70">
									Daily total (min)
									<input
										type="number"
										name="dailyTotalSleepTarget"
										value={active.dailyTotalSleepTarget ?? ''}
										oninput={scheduleSave}
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
										oninput={scheduleSave}
										min="0"
										inputmode="numeric"
										class={inputClass}
									/>
								</label>
								<label class="block font-medium opacity-70">
									Bedtime from
									<input
										type="time"
										name="bedtimeStart"
										value={active.bedtimeStart ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
								<label class="block font-medium opacity-70">
									Bedtime to
									<input
										type="time"
										name="bedtimeEnd"
										value={active.bedtimeEnd ?? ''}
										oninput={scheduleSave}
										class={inputClass}
									/>
								</label>
							</div>
						</div>
					</div>
				</details>
			</form>
		</div>

		<!-- Library (left column, file-tree style) -->
		<aside class="order-2 lg:sticky lg:top-4 lg:order-1 lg:w-64 lg:shrink-0">
			<div class="rounded-2xl border border-black/10 p-3 dark:border-white/10">
				<h3 class="px-1 pb-2 text-sm font-semibold">Library</h3>

				{#if library.length === 0}
					<p class="px-1 py-3 text-xs opacity-50">
						No saved plans yet — save the active plan below.
					</p>
				{:else}
					<ul class="space-y-0.5">
						{#each library as t (t.id)}
							{@const isActive = active.sourceTemplateId === t.id}
							<li
								class="flex items-center gap-1 rounded-lg {isActive
									? 'bg-indigo-500/10'
									: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}"
							>
								<form method="POST" action="?/load" use:enhance class="min-w-0 flex-1">
									<button type="submit" class="flex w-full items-start gap-2 px-2 py-1.5 text-left">
										<span class="mt-px shrink-0 text-xs">{isActive ? '📌' : '🗓️'}</span>
										<span class="min-w-0 flex-1">
											<span
												class="block truncate text-sm font-medium {isActive
													? 'text-indigo-700 dark:text-indigo-300'
													: ''}">{t.name}</span
											>
											<span class="block truncate text-[0.6875rem] opacity-50"
												>wake {t.referenceWakeTime} · {t.napCount} nap{t.napCount === 1
													? ''
													: 's'}</span
											>
										</span>
									</button>
								</form>
								<div class="flex shrink-0 gap-0.5 pr-1">
									<form method="POST" action="?/overwrite" use:enhance>
										<input type="hidden" name="templateId" value={t.id} />
										<button
											type="submit"
											title="Overwrite with active plan"
											aria-label="Overwrite {t.name} with the active plan"
											class="rounded px-1.5 py-0.5 text-xs opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
											onclick={(ev) => {
												if (!confirm(`Overwrite “${t.name}” with the active plan?`))
													ev.preventDefault();
											}}>⤓</button
										>
									</form>
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="templateId" value={t.id} />
										<button
											type="submit"
											title="Delete"
											aria-label="Delete {t.name}"
											class="rounded px-1.5 py-0.5 text-xs text-rose-600 opacity-60 hover:bg-rose-500/10 hover:opacity-100 dark:text-rose-400"
											onclick={(ev) => {
												if (!confirm(`Delete “${t.name}”?`)) ev.preventDefault();
											}}>✕</button
										>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Save the active plan to the library as a new entry -->
				<form
					method="POST"
					action="?/saveNew"
					use:enhance
					class="mt-3 flex items-end gap-2 border-t border-black/10 pt-3 dark:border-white/10"
				>
					<label class="flex-1 text-[0.6875rem] font-medium opacity-70">
						Save active as…
						<input name="name" placeholder="e.g. 3-nap winter" required class={inputClass} />
					</label>
					<button
						type="submit"
						class="rounded-lg border border-indigo-500/40 px-2.5 py-2 text-xs font-medium text-indigo-600 active:scale-95 dark:text-indigo-400"
					>
						Save
					</button>
				</form>
			</div>
		</aside>
	</div>
</section>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			close();
			return;
		}
		if (!(e.metaKey || e.ctrlKey)) return;
		// Leave native undo alone while the caret is in a text field.
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
		const k = e.key.toLowerCase();
		if (k === 'z' && !e.shiftKey) {
			e.preventDefault();
			doUndo();
		} else if ((k === 'z' && e.shiftKey) || k === 'y') {
			e.preventDefault();
			doRedo();
		}
	}}
/>

<!-- Shared editor body, rendered inside whichever window style is selected. -->
{#snippet editorBody(e: Editing)}
	<div class="mb-3 flex items-center justify-between gap-2">
		<h4 class="text-sm font-semibold">{editorTitle(e)}</h4>
		<button
			type="button"
			onclick={close}
			aria-label="Close editor"
			class="-mr-1 rounded-lg px-2 text-xl leading-none opacity-60 hover:opacity-100">×</button
		>
	</div>

	{#if e.kind === 'wake'}
		<label class="block text-xs font-medium opacity-70">
			Reference wake
			<input type="time" bind:value={f.referenceWakeTime} class={inputClass} />
		</label>
	{:else if e.kind === 'awake'}
		<label class="block text-xs font-medium opacity-70">
			Awake window (minutes)
			<input
				type="number"
				min="0"
				step="5"
				inputmode="numeric"
				value={winAt(e.index)}
				oninput={(ev) => setWin(e.index, numVal(ev))}
				class={inputClass}
			/>
		</label>
	{:else if e.kind === 'nap'}
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-xs font-medium opacity-70">
				Awake before (min)
				<input
					type="number"
					min="0"
					step="5"
					inputmode="numeric"
					value={winAt(e.index)}
					oninput={(ev) => setWin(e.index, numVal(ev))}
					class={inputClass}
				/>
			</label>
			<label class="block text-xs font-medium opacity-70">
				Nap duration (min)
				<input
					type="number"
					min="0"
					step="5"
					inputmode="numeric"
					value={napAt(e.index)}
					oninput={(ev) => setNap(e.index, numVal(ev))}
					class={inputClass}
				/>
			</label>
		</div>
		<button
			type="button"
			onclick={() => removeNap(e.index)}
			class="mt-3 text-xs font-medium text-rose-600 active:scale-95 dark:text-rose-400"
		>
			Remove this nap
		</button>
	{:else if e.kind === 'bed'}
		<div class="space-y-3">
			<label class="block text-xs font-medium opacity-70">
				Final awake window (min)
				<input
					type="number"
					min="0"
					step="5"
					inputmode="numeric"
					value={winAt(plan.ok ? plan.napCount : 0)}
					oninput={(ev) => setWin(plan.ok ? plan.napCount : 0, numVal(ev))}
					class={inputClass}
				/>
			</label>
			<label class="block text-xs font-medium opacity-70">
				Target bedtime
				<input type="time" bind:value={f.targetBedtime} class={inputClass} />
				<span class="mt-0.5 block text-[0.6875rem] font-normal opacity-50"
					>Set it to redistribute remaining sleeps onto a fixed bedtime.</span
				>
			</label>
		</div>
	{/if}

	<p class="mt-3 text-[0.6875rem] opacity-50">Changes save automatically.</p>
	<button
		type="button"
		onclick={close}
		class="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-[0.99]"
	>
		Done
	</button>
{/snippet}

<!-- Editor popup: centered modal over a dimmed backdrop. -->
{#if editing}
	<button
		type="button"
		aria-label="Close editor"
		onclick={close}
		class="fixed inset-0 z-40 bg-black/40"
	></button>
	<div
		role="dialog"
		aria-modal="true"
		class="fixed top-1/2 left-1/2 z-50 w-[min(22rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/15 dark:bg-neutral-900"
	>
		{@render editorBody(editing)}
	</div>
{/if}
