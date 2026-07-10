/** Download the full dataset as one JSON dump (REQUIREMENTS §6). */
import { exportData } from '$lib/server/backup';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const dump = exportData();
	const date = new Date().toISOString().slice(0, 10);
	return new Response(JSON.stringify(dump, null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="baby-tracker-backup-${date}.json"`
		}
	});
};
