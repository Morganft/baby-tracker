import { describe, it, expect } from 'vitest';
import { initHistory, commit, undo, redo, type History } from './history';

/** A trivial editable state: a single number, compared by value. */
const eq = (a: number, b: number) => a === b;

/** Drive a sequence of "edit then commit" steps from a starting baseline. */
function edits(start: number, values: number[]): History<number> {
	let h = initHistory(start);
	for (const v of values) h = commit(h, v, eq);
	return h;
}

describe('history', () => {
	it('starts empty with the given baseline', () => {
		const h = initHistory(5);
		expect(h.baseline).toBe(5);
		expect(h.past).toEqual([]);
		expect(h.future).toEqual([]);
	});

	it('commit is a no-op when the value equals the baseline', () => {
		const h = initHistory(5);
		expect(commit(h, 5, eq)).toBe(h);
	});

	it('commit pushes the old baseline onto the past and clears redo', () => {
		const h = commit(initHistory(1), 2, eq);
		expect(h.baseline).toBe(2);
		expect(h.past).toEqual([1]);
		expect(h.future).toEqual([]);
	});

	it('undo returns the previous state and moves the current onto the redo stack', () => {
		const h = edits(1, [2, 3]); // baseline 3, past [1,2]
		const step = undo(h, 3, eq);
		expect(step).not.toBeNull();
		expect(step!.value).toBe(2);
		expect(step!.history.baseline).toBe(2);
		expect(step!.history.past).toEqual([1]);
		expect(step!.history.future).toEqual([3]);
	});

	it('undo then redo round-trips back to the same state', () => {
		const h = edits(1, [2, 3]);
		const u = undo(h, 3, eq)!;
		const r = redo(u.history, u.value, eq)!;
		expect(r.value).toBe(3);
		expect(r.history.baseline).toBe(3);
		expect(r.history.past).toEqual([1, 2]);
		expect(r.history.future).toEqual([]);
	});

	it('undo returns null when there is nothing to undo', () => {
		expect(undo(initHistory(1), 1, eq)).toBeNull();
	});

	it('redo returns null when there is nothing to redo', () => {
		expect(redo(initHistory(1), 1, eq)).toBeNull();
	});

	it('undo folds a pending (uncommitted) live edit in before reversing it', () => {
		// baseline 2, past [1]; the live value has drifted to 3 without a commit.
		const h = edits(1, [2]);
		const step = undo(h, 3, eq)!;
		// The uncommitted 3 is captured (redoable) and we land on the committed 2.
		expect(step.value).toBe(2);
		expect(step.history.future).toEqual([3]);
		expect(step.history.past).toEqual([1]);
	});

	it('a fresh edit after undo invalidates the redo stack', () => {
		const h = edits(1, [2, 3]);
		const u = undo(h, 3, eq)!; // baseline 2, future [3]
		// User edits to 9 instead of redoing; committing clears the redo stack.
		const committed = commit(u.history, 9, eq);
		expect(committed.future).toEqual([]);
		expect(redo(committed, 9, eq)).toBeNull();
	});

	it('redoing after a pending fresh edit is a no-op (edit wins)', () => {
		const h = edits(1, [2, 3]);
		const u = undo(h, 3, eq)!; // baseline 2, future [3]
		// A pending live edit to 9 (not yet committed) then a redo attempt.
		expect(redo(u.history, 9, eq)).toBeNull();
	});

	it('caps the past at the given limit, dropping the oldest', () => {
		let h = initHistory(0);
		for (let v = 1; v <= 5; v++) h = commit(h, v, eq, 3);
		expect(h.baseline).toBe(5);
		// Only the last 3 prior baselines are retained.
		expect(h.past).toEqual([2, 3, 4]);
	});

	it('supports multi-level undo back to the original', () => {
		let h = edits(0, [1, 2, 3]); // baseline 3, past [0,1,2]
		let cur = 3;
		for (const expected of [2, 1, 0]) {
			const step = undo(h, cur, eq)!;
			expect(step.value).toBe(expected);
			h = step.history;
			cur = step.value;
		}
		expect(undo(h, cur, eq)).toBeNull();
	});
});
