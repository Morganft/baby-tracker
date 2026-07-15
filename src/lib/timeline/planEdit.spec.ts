import { describe, it, expect } from 'vitest';
import {
	parseCsv,
	buildChain,
	slotDur,
	withSlot,
	firstUnlocked,
	pxToMin,
	applyResize,
	applyMove,
	applyBedtime,
	addNap,
	removeNap
} from './planEdit';

describe('planEdit — chain', () => {
	it('interleaves windows and naps, ending on the pre-bed window', () => {
		expect(buildChain(2)).toEqual([
			{ kind: 'win', idx: 0 },
			{ kind: 'nap', idx: 0 },
			{ kind: 'win', idx: 1 },
			{ kind: 'nap', idx: 1 },
			{ kind: 'win', idx: 2 }
		]);
	});

	it('starts at a tail offset, skipping the completed prefix', () => {
		expect(buildChain(3, 1)).toEqual([
			{ kind: 'win', idx: 1 },
			{ kind: 'nap', idx: 1 },
			{ kind: 'win', idx: 2 },
			{ kind: 'nap', idx: 2 },
			{ kind: 'win', idx: 3 }
		]);
	});

	it('finds the first unlocked neighbour in a direction', () => {
		const slots = buildChain(2);
		const p = slots.findIndex((s) => s.kind === 'nap' && s.idx === 0);
		expect(firstUnlocked(slots, p, 1)).toEqual({ kind: 'win', idx: 1 });
		expect(firstUnlocked(slots, p, -1)).toEqual({ kind: 'win', idx: 0 });
		expect(firstUnlocked(slots, slots.length - 1, 1)).toBeNull();
	});

	it('reads and writes slot durations', () => {
		const wins = [120, 150, 240];
		const naps = [90, 60];
		expect(slotDur(wins, naps, { kind: 'win', idx: 2 })).toBe(240);
		expect(slotDur(wins, naps, { kind: 'nap', idx: 1 })).toBe(60);
		const next = withSlot(wins, naps, { kind: 'nap', idx: 0 }, 75.4);
		expect(next.naps).toEqual([75, 60]); // rounded, clamped ≥ 0
		expect(next.wins).toEqual([120, 150, 240]); // originals untouched
	});
});

describe('planEdit — pxToMin', () => {
	it('converts pixels to snapped minutes', () => {
		expect(pxToMin(42, 1.4)).toBe(30); // 42 / 1.4 = 30 → snap 5
		expect(pxToMin(10, 1.4)).toBe(5); // 7.1 → nearest 5
		expect(pxToMin(-42, 1.4)).toBe(-30);
	});
});

describe('planEdit — resize', () => {
	const wins = [120, 150, 240];
	const naps = [90, 60];

	it('grows the nap and shrinks the absorbing slot equally', () => {
		const r = applyResize(wins, naps, {
			napIdx: 1,
			absorb: { kind: 'win', idx: 2 },
			napStart: 60,
			absorbStart: 240,
			deltaMin: 30
		});
		expect(r.naps).toEqual([90, 90]);
		expect(r.wins).toEqual([120, 150, 210]);
	});

	it('clamps so neither the nap nor the absorber goes negative', () => {
		const shrink = applyResize(wins, naps, {
			napIdx: 1,
			absorb: { kind: 'win', idx: 2 },
			napStart: 60,
			absorbStart: 240,
			deltaMin: -100 // would take the nap below 0
		});
		expect(shrink.naps).toEqual([90, 0]);
		expect(shrink.wins).toEqual([120, 150, 300]);

		const grow = applyResize(wins, naps, {
			napIdx: 1,
			absorb: { kind: 'win', idx: 2 },
			napStart: 60,
			absorbStart: 240,
			deltaMin: 300 // would take the absorber below 0
		});
		expect(grow.naps).toEqual([90, 300]);
		expect(grow.wins).toEqual([120, 150, 0]);
	});
});

describe('planEdit — move', () => {
	it('slides a nap: above grows, below shrinks, bedtime unchanged', () => {
		const wins = [120, 150, 240];
		const naps = [90, 60];
		const r = applyMove(wins, naps, {
			above: { kind: 'win', idx: 1 },
			below: { kind: 'win', idx: 2 },
			aboveStart: 150,
			belowStart: 240,
			deltaMin: 30
		});
		expect(r.wins).toEqual([120, 180, 210]);
		// total (wins + naps) is preserved, so bedtime lands at the same time.
		const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
		expect(sum(r.wins) + sum(r.naps)).toBe(sum(wins) + sum(naps));
	});
});

describe('planEdit — bedtime', () => {
	it('moves bedtime by resizing the tail window only', () => {
		const wins = [120, 150, 240];
		const naps = [90, 60];
		expect(
			applyBedtime(wins, naps, { tail: { kind: 'win', idx: 2 }, tailStart: 240, deltaMin: -60 })
				.wins
		).toEqual([120, 150, 180]);
		expect(
			applyBedtime(wins, naps, { tail: { kind: 'win', idx: 2 }, tailStart: 240, deltaMin: -500 })
				.wins
		).toEqual([120, 150, 0]);
	});
});

describe('planEdit — add / remove nap', () => {
	it('adds a nap before bedtime, cloning the last nap and keeping lengths consistent', () => {
		const { wins, naps } = addNap([120, 150, 240], [90, 60]);
		expect(naps).toEqual([90, 60, 60]);
		expect(wins).toEqual([120, 150, 240, 240]);
		expect(wins.length).toBe(naps.length + 1);
	});

	it('removes a nap and its leading window', () => {
		const { wins, naps } = removeNap([120, 150, 240, 240], [90, 60, 60], 2);
		expect(naps).toEqual([90, 60]);
		expect(wins).toEqual([120, 150, 240]);
		expect(wins.length).toBe(naps.length + 1);
	});

	it('is a no-op for an out-of-range index', () => {
		const { wins, naps } = removeNap([120, 150], [90], 5);
		expect(naps).toEqual([90]);
		expect(wins).toEqual([120, 150]);
	});
});

describe('planEdit — csv', () => {
	it('parses and drops blanks / negatives', () => {
		expect(parseCsv('120, 150 , , 240')).toEqual([120, 150, 240]);
		expect(parseCsv('90, -5, x')).toEqual([90]);
	});
});
