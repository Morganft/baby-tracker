import { json } from '@sveltejs/kit';
import { listSleeps, createSleep } from '$lib/server/queries/sleeps';
import { parseSleepCreate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** GET /api/sleeps — every sleep, most recent first. */
export const GET: RequestHandler = () => json(listSleeps());

/** POST /api/sleeps — create a sleep (quick-log "fell asleep" starts one). */
export const POST: RequestHandler = async ({ request }) => {
	const input = parseSleepCreate(await readBody(request));
	return json(createSleep(input), { status: 201 });
};
