import { error } from '@sveltejs/kit';
import { deleteWaking } from '$lib/server/queries/sleeps';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ params }) => {
	if (!deleteWaking(params.id)) throw error(404, 'Waking not found');
	return new Response(null, { status: 204 });
};
