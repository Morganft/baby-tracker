/**
 * Where the Add-sleep screen returns to. It is opened *from* a day-scoped view
 * (Home / Timeline) that may be showing a past day; `returnPath` carries that
 * viewed day back so opening Add and returning never silently snaps you to today.
 * History has no day navigator, so the day is dropped there.
 */
export type FromPath = '/' | '/timeline' | '/history';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Constrain the `from` param to a known in-app view (guards open-redirect). */
export function safeFrom(from: string | null): FromPath {
	return from === '/timeline' || from === '/history' ? from : '/';
}

/** Honour only a well-formed 'YYYY-MM-DD' day key; anything else carries no day. */
export function safeDate(date: string | null | undefined): string | null {
	return date && DATE_RE.test(date) ? date : null;
}

/** Compose the return URL, appending the viewed day for the day-scoped views. */
export function returnPath(from: FromPath, date: string | null): string {
	return date && from !== '/history' ? `${from}?date=${date}` : from;
}
