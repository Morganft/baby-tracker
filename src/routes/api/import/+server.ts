/** Merge a JSON dump into the dataset (dedupe by UUID, last-write-wins). */
import { importData } from '$lib/server/backup';
import { readBody } from '$lib/server/api/http';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	// importData validates and throws error(400, ...) on a malformed dump.
	return json(importData(body));
};
