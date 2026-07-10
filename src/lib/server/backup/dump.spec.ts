import { describe, it, expect } from 'vitest';
import { parseBackup, lww, BACKUP_VERSION, type BackupDump } from './dump';

/** A minimal well-formed template row for a 1-nap day. */
const templateRow = {
	id: 't1',
	name: 'A',
	referenceWakeTime: '07:00',
	napCount: 1,
	wakeWindows: [120, 240],
	expectedNapDurations: [90],
	dailyTotalSleepTarget: null,
	daytimeCap: null,
	bedtimeStart: null,
	bedtimeEnd: null,
	targetBedtime: null,
	wakeWindowMin: null,
	wakeWindowMax: null,
	napDurationMin: null,
	napDurationMax: null,
	createdAt: 1000,
	updatedAt: 2000
};

function fullDump(): BackupDump {
	return {
		version: BACKUP_VERSION,
		exportedAt: 5000,
		baby: [{ id: 'b1', name: 'Baby', birthDate: '2026-01-01', createdAt: 1, updatedAt: 2 }],
		templates: [templateRow],
		activeTemplate: { ...templateRow, id: 'active', sourceTemplateId: 't1' },
		sleepEntries: [
			{
				id: 's1',
				startTime: 100,
				endTime: 200,
				timezone: 'Europe/Prague',
				type: 'night',
				location: 'crib',
				putDown: 'drowsy',
				notes: null,
				createdAt: 100,
				updatedAt: 200
			}
		],
		nightWakings: [{ id: 'w1', sleepEntryId: 's1', time: 150 }],
		settings: {
			id: 'settings',
			shortNapThresholdMin: 15,
			shortNapReductionPercent: 30,
			clock24h: true,
			trackTimezone: true,
			dayStartTime: '07:00',
			createdAt: 1,
			updatedAt: 2
		}
	};
}

describe('lww', () => {
	it('inserts when no existing row', () => {
		expect(lww(undefined, 100)).toBe('insert');
	});
	it('updates when incoming is strictly newer', () => {
		expect(lww(100, 200)).toBe('update');
	});
	it('skips when incoming is older or equal', () => {
		expect(lww(200, 100)).toBe('skip');
		expect(lww(200, 200)).toBe('skip');
	});
});

describe('parseBackup', () => {
	it('accepts a full round-trippable dump', () => {
		const parsed = parseBackup(fullDump());
		expect(parsed.baby).toHaveLength(1);
		expect(parsed.templates[0].id).toBe('t1');
		expect(parsed.activeTemplate?.sourceTemplateId).toBe('t1');
		expect(parsed.sleepEntries[0].type).toBe('night');
		expect(parsed.nightWakings[0].sleepEntryId).toBe('s1');
		expect(parsed.settings?.clock24h).toBe(true);
	});

	it('defaults missing collections to empty / null', () => {
		const parsed = parseBackup({ version: BACKUP_VERSION });
		expect(parsed.baby).toEqual([]);
		expect(parsed.templates).toEqual([]);
		expect(parsed.sleepEntries).toEqual([]);
		expect(parsed.nightWakings).toEqual([]);
		expect(parsed.activeTemplate).toBeNull();
		expect(parsed.settings).toBeNull();
	});

	it('rejects an unsupported version', () => {
		expect(() => parseBackup({ version: 999 })).toThrow();
	});

	it('rejects a non-object body', () => {
		expect(() => parseBackup([])).toThrow();
		expect(() => parseBackup(null)).toThrow();
	});

	it('rejects a sleep entry with end before start', () => {
		const d = fullDump();
		d.sleepEntries[0].endTime = 50; // < startTime 100
		expect(() => parseBackup(d)).toThrow();
	});

	it('rejects a bad enum value', () => {
		const d = fullDump();
		(d.sleepEntries[0] as { type: string }).type = 'bogus';
		expect(() => parseBackup(d)).toThrow();
	});

	it('rejects a non-numeric timestamp', () => {
		const d = fullDump();
		(d.baby[0] as { updatedAt: unknown }).updatedAt = 'nope';
		expect(() => parseBackup(d)).toThrow();
	});

	it('rejects a template that fails template validation', () => {
		const d = fullDump();
		d.templates[0].wakeWindows = [120]; // wrong length for napCount 1
		expect(() => parseBackup(d)).toThrow();
	});
});
