import { json } from '@sveltejs/kit';
import { getSettings, updateSettings } from '$lib/server/queries/settings';
import { parseSettingsUpdate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(getSettings());

export const PATCH: RequestHandler = async ({ request }) => {
	const patch = parseSettingsUpdate(await readBody(request));
	return json(updateSettings(patch));
};
