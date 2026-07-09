import { json } from '@sveltejs/kit';
import { listTemplates, createTemplate } from '$lib/server/queries/templates';
import { parseTemplate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** GET /api/templates — the user's template library. */
export const GET: RequestHandler = () => json(listTemplates());

/**
 * POST /api/templates — create a library template (e.g. saving the active slot
 * as a new named entry). A client-generated `id` in the body is honored.
 */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await readBody(request);
	const input = parseTemplate(raw);
	const id = (raw as { id?: unknown }).id;
	return json(createTemplate(input, typeof id === 'string' ? id : undefined), { status: 201 });
};
