import { json, error } from '@sveltejs/kit';
import { addWaking } from '$lib/server/queries/sleeps';
import { parseWaking } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** POST /api/sleeps/:id/wakings — record a waking within a night sleep. */
export const POST: RequestHandler = async ({ params, request }) => {
	const time = parseWaking(await readBody(request));
	const parent = addWaking(params.id, time);
	if (!parent) throw error(404, 'Sleep not found');
	return json(parent, { status: 201 });
};
