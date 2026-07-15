/**
 * Pure, framework-free cascade + direct-manipulation math for a plan's shape —
 * an ordered list of wake windows and nap durations (minutes). Extracted so the
 * Plan editor (`routes/templates`) and the Today timeline's inline projected-tail
 * editor (`routes/timeline`) share the *exact* same resize / move / add / remove
 * behaviour instead of drifting.
 *
 * The shape is two parallel arrays: `wins` (length `naps.length + 1` — one window
 * before each nap, then a final window leading into bedtime) and `naps` (one per
 * nap). All gestures redistribute a change into a single neighbouring slot so the
 * rest of the day stays put, snapping to whole minutes and clamping ≥ 0.
 */

/** A position in the cascade: a wake window or a nap, by index. */
export type Slot = { kind: 'win' | 'nap'; idx: number };

/** Comma-separated minutes → finite, non-negative number[]. */
export function parseCsv(v: string): number[] {
	return v
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n >= 0);
}

export function toCsv(a: number[]): string {
	return a.join(', ');
}

/** Clamp a slot value to a non-negative whole number of minutes. */
const clampMin = (v: number) => Math.max(0, Math.round(v) || 0);

/**
 * The ordered slot chain: win, nap, win, nap, …, win. A drag redistributes into
 * the nearest neighbour by walking this list. `from` starts the chain at a tail
 * offset — the Today editor only reshapes the projected tail (naps `from`…), the
 * Plan editor uses `from = 0` for the whole day.
 */
export function buildChain(napCount: number, from = 0): Slot[] {
	const slots: Slot[] = [];
	for (let i = from; i < napCount; i++) {
		slots.push({ kind: 'win', idx: i });
		slots.push({ kind: 'nap', idx: i });
	}
	slots.push({ kind: 'win', idx: napCount }); // final window → bedtime
	return slots;
}

/** Duration of a slot given the current arrays. */
export function slotDur(wins: number[], naps: number[], s: Slot): number {
	return s.kind === 'win' ? (wins[s.idx] ?? 0) : (naps[s.idx] ?? 0);
}

/** Return copies of the arrays with slot `s` set to `value` (clamped). */
export function withSlot(
	wins: number[],
	naps: number[],
	s: Slot,
	value: number
): { wins: number[]; naps: number[] } {
	const w = wins.slice();
	const n = naps.slice();
	if (s.kind === 'win') w[s.idx] = clampMin(value);
	else n[s.idx] = clampMin(value);
	return { wins: w, naps: n };
}

/**
 * First unlocked slot walking from `pos` in `dir` (±1), or null. Today has no
 * locks (`isLocked` defaults to never), preserving parity with the Plan editor
 * where locked slots carry rigidly and the change chains past them.
 */
export function firstUnlocked(
	slots: Slot[],
	pos: number,
	dir: 1 | -1,
	isLocked: (s: Slot) => boolean = () => false
): Slot | null {
	for (let k = pos + dir; k >= 0 && k < slots.length; k += dir) {
		if (!isLocked(slots[k])) return slots[k];
	}
	return null;
}

/** Pixels dragged → snapped minutes (both timelines snap to 5). */
export function pxToMin(dyPx: number, pxPerMin: number, snap = 5): number {
	return Math.round(dyPx / pxPerMin / snap) * snap;
}

/**
 * Resize a nap by `deltaMin` (already signed so positive grows the nap), absorbing
 * the opposite change into `absorb`. Both the nap and the absorbing slot stay ≥ 0,
 * so bedtime and every other sleep are unaffected.
 */
export function applyResize(
	wins: number[],
	naps: number[],
	opts: { napIdx: number; absorb: Slot; napStart: number; absorbStart: number; deltaMin: number }
): { wins: number[]; naps: number[] } {
	const { napIdx, absorb, napStart, absorbStart, deltaMin } = opts;
	const d = Math.min(absorbStart, Math.max(-napStart, deltaMin));
	let next = withSlot(wins, naps, { kind: 'nap', idx: napIdx }, napStart + d);
	next = withSlot(next.wins, next.naps, absorb, absorbStart - d);
	return next;
}

/**
 * Translate a nap by `deltaMin`: the slot above grows and the slot below shrinks
 * by the same clamped amount (or vice versa), so the nap slides rigidly without
 * changing its own duration or the rest of the day.
 */
export function applyMove(
	wins: number[],
	naps: number[],
	opts: { above: Slot; below: Slot; aboveStart: number; belowStart: number; deltaMin: number }
): { wins: number[]; naps: number[] } {
	const { above, below, aboveStart, belowStart, deltaMin } = opts;
	const dd = Math.min(belowStart, Math.max(-aboveStart, deltaMin));
	let next = withSlot(wins, naps, above, aboveStart + dd);
	next = withSlot(next.wins, next.naps, below, belowStart - dd);
	return next;
}

/**
 * Move bedtime by `deltaMin` by growing/shrinking the tail window it leads from;
 * everything above that window stays put and bedtime floats.
 */
export function applyBedtime(
	wins: number[],
	naps: number[],
	opts: { tail: Slot; tailStart: number; deltaMin: number }
): { wins: number[]; naps: number[] } {
	const { tail, tailStart, deltaMin } = opts;
	return withSlot(wins, naps, tail, Math.max(0, tailStart + deltaMin));
}

/**
 * Add a nap: clone the last nap's duration and insert a window before the final
 * (pre-bed) window, keeping `wins.length === naps.length + 1`.
 */
export function addNap(wins: number[], naps: number[]): { wins: number[]; naps: number[] } {
	const w = wins.slice();
	const n = naps.slice();
	const count = n.length;
	n.push(n[count - 1] ?? 60);
	const winInsert = Math.max(0, w.length - 1);
	w.splice(winInsert, 0, w[count] ?? w[count - 1] ?? 90);
	return { wins: w, naps: n };
}

/**
 * Remove nap `i` and the window leading into it, keeping the arrays consistent.
 * No-op if `i` is out of range.
 */
export function removeNap(
	wins: number[],
	naps: number[],
	i: number
): { wins: number[]; naps: number[] } {
	if (i < 0 || i >= naps.length) return { wins: wins.slice(), naps: naps.slice() };
	const w = wins.slice();
	const n = naps.slice();
	n.splice(i, 1);
	w.splice(i, 1);
	return { wins: w, naps: n };
}
