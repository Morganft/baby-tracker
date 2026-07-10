import { describe, it, expect } from 'vitest';
import { resolveEntryTimezone, serverTimeZone } from './validate';

describe('resolveEntryTimezone', () => {
	const server = serverTimeZone();

	it("keeps the phone's own zone when tracking is on", () => {
		expect(resolveEntryTimezone('Asia/Tokyo', true)).toBe('Asia/Tokyo');
	});

	it('falls back to the server zone when tracking is off', () => {
		expect(resolveEntryTimezone('Asia/Tokyo', false)).toBe(server);
	});

	it('falls back to the server zone for a missing or invalid client zone', () => {
		expect(resolveEntryTimezone(undefined, true)).toBe(server);
		expect(resolveEntryTimezone('', true)).toBe(server);
		expect(resolveEntryTimezone('Not/AZone', true)).toBe(server);
	});
});
