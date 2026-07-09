import { json, error } from '@sveltejs/kit';
import { getSleep, updateSleep, deleteSleep } from '$lib/server/queries/sleeps';
import { parseSleepUpdate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const sleep = getSleep(params.id);
	if (!sleep) throw error(404, 'Sleep not found');
	return json(sleep);
};

/** PATCH /api/sleeps/:id — edit an entry (setting `endTime` stops it). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const patch = parseSleepUpdate(await readBody(request));
	const sleep = updateSleep(params.id, patch);
	if (!sleep) throw error(404, 'Sleep not found');
	return json(sleep);
};

export const DELETE: RequestHandler = ({ params }) => {
	if (!deleteSleep(params.id)) throw error(404, 'Sleep not found');
	return new Response(null, { status: 204 });
};
