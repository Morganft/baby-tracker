import { json, error } from '@sveltejs/kit';
import {
	getActiveTemplate,
	updateActiveTemplate,
	loadActiveTemplate
} from '$lib/server/queries/templates';
import { parseTemplate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** GET /api/active-template — the persistent slot driving today's projection. */
export const GET: RequestHandler = () => json(getActiveTemplate());

/** PATCH /api/active-template — edit the active slot in place (never the library). */
export const PATCH: RequestHandler = async ({ request }) => {
	const input = parseTemplate(await readBody(request));
	return json(updateActiveTemplate(input));
};

/** POST /api/active-template — load a library template into the slot by `templateId`. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	const templateId = (body as { templateId?: unknown }).templateId;
	if (typeof templateId !== 'string' || templateId.length === 0) {
		throw error(400, 'templateId is required');
	}
	const active = loadActiveTemplate(templateId);
	if (!active) throw error(404, 'Template not found');
	return json(active);
};
