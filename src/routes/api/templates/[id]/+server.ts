import { json, error } from '@sveltejs/kit';
import { getTemplate, updateTemplate, deleteTemplate } from '$lib/server/queries/templates';
import { parseTemplate } from '$lib/server/api/validate';
import { readBody } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const tpl = getTemplate(params.id);
	if (!tpl) throw error(404, 'Template not found');
	return json(tpl);
};

/** PATCH /api/templates/:id — overwrite a library template in place. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const input = parseTemplate(await readBody(request));
	const tpl = updateTemplate(params.id, input);
	if (!tpl) throw error(404, 'Template not found');
	return json(tpl);
};

export const DELETE: RequestHandler = ({ params }) => {
	if (!deleteTemplate(params.id)) throw error(404, 'Template not found');
	return new Response(null, { status: 204 });
};
