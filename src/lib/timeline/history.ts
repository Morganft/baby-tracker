/**
 * A tiny, pure undo/redo history over immutable snapshots of some editable
 * state `S`. Used by the Plan page to make direct-manipulation edits (drag a
 * nap, resize, tap-to-edit) reversible — so an accidental drag, especially on
 * touch, is one undo away rather than a lost plan.
 *
 * Deliberately pure (no DOM, no Svelte runes) so it can be unit-tested and so
 * the component owns reactivity: every operation returns a *new* `History`
 * object which the caller assigns to reactive state.
 *
 * Coalescing model. Live edits stream in continuously (a drag fires dozens of
 * mutations); we do not want one undo step per pixel. Instead the caller keeps
 * editing a live value and periodically `commit`s: a commit folds the *current*
 * live value into the past only if it diverges from `baseline` (the last
 * committed/seeded state), collapsing a whole burst of edits into a single
 * reversible step. `undo`/`redo` fold any pending live change in first, so an
 * in-flight (not-yet-committed) edit is still captured.
 */

export interface History<S> {
	/** Committed states older than the current one, oldest first. */
	readonly past: readonly S[];
	/** States undone from, newest-undone last (the redo stack). */
	readonly future: readonly S[];
	/** The last committed (or seeded) state — what the live value is measured against. */
	readonly baseline: S;
}

/** A fresh history anchored at `baseline`, with nothing to undo or redo. */
export function initHistory<S>(baseline: S): History<S> {
	return { past: [], future: [], baseline };
}

/**
 * Fold the live `current` value into history. If it equals `baseline` this is a
 * no-op (returns the same history). Otherwise the old baseline is pushed onto
 * the past, `current` becomes the new baseline, and the redo stack is cleared —
 * a new edit always invalidates redo. `limit` caps the past depth.
 */
export function commit<S>(
	h: History<S>,
	current: S,
	eq: (a: S, b: S) => boolean,
	limit = 100
): History<S> {
	if (eq(current, h.baseline)) return h;
	const past = [...h.past, h.baseline];
	if (past.length > limit) past.shift();
	return { past, future: [], baseline: current };
}

/** The value to apply to the live editor plus the resulting history. */
export interface Step<S> {
	history: History<S>;
	value: S;
}

/**
 * Undo one step. Any pending live change in `current` is committed first (so an
 * in-flight drag is captured, then reversed). Returns `null` when there is
 * nothing to undo.
 */
export function undo<S>(
	h: History<S>,
	current: S,
	eq: (a: S, b: S) => boolean,
	limit = 100
): Step<S> | null {
	const folded = commit(h, current, eq, limit);
	const past = folded.past.slice();
	const prev = past.pop();
	if (prev === undefined) return null;
	return {
		history: { past, future: [...folded.future, folded.baseline], baseline: prev },
		value: prev
	};
}

/**
 * Redo one previously-undone step. A pending live change is committed first,
 * which clears the redo stack — so redoing after a fresh edit is a no-op.
 * Returns `null` when there is nothing to redo.
 */
export function redo<S>(
	h: History<S>,
	current: S,
	eq: (a: S, b: S) => boolean,
	limit = 100
): Step<S> | null {
	const folded = commit(h, current, eq, limit);
	const future = folded.future.slice();
	const next = future.pop();
	if (next === undefined) return null;
	return {
		history: { past: [...folded.past, folded.baseline], future, baseline: next },
		value: next
	};
}
