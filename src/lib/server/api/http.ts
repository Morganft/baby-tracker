/** Shared helpers for the JSON API route handlers. */
import { error } from '@sveltejs/kit';

/** Parse a request's JSON body, turning malformed JSON into a 400. */
export async function readBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw error(400, 'Request body must be valid JSON');
	}
}
