/*---------------------------------------------------------------------------------------------
 *  Data Extractor: checking a resource path under /api/ before reading it (DataSuite checks again where it signs the
 *  request; this gives the AI a clear message first)
 *  Ported from DataSuite (platform/dhis2/common/dhis2Paths.ts).
 *--------------------------------------------------------------------------------------------*/

/** `"/dataElements"`, `"api/dataElements"` and `"dataElements/"` all mean `dataElements`. */
export function normalizeDhis2ApiPath(path: string): string {
	return path.trim().replace(/^\/+/, '').replace(/^api\/+/i, '').replace(/\/+$/, '');
}

export type Dhis2PathValidation = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/**
 * A path for the raw query tool must stay a resource under `/api/`: no `..` segments, no scheme or host, no query
 * string (parameters go in `query`), no backslashes or control characters.
 */
export function validateDhis2RawPath(path: string | undefined): Dhis2PathValidation {
	if (typeof path !== 'string' || !path.trim()) {
		return { ok: false, reason: 'path is empty -- give a resource under /api/, e.g. "organisationUnitGroups".' };
	}
	if (path.includes('\\') || Array.from(path).some(ch => ch.charCodeAt(0) < 32)) {
		return { ok: false, reason: 'path contains a backslash or control character.' };
	}
	if (path.includes('://') || /^[a-z][a-z0-9+.-]*:/i.test(path.trim())) {
		return { ok: false, reason: 'path must be relative to /api/, not a full URL.' };
	}
	if (path.includes('?') || path.includes('#')) {
		return { ok: false, reason: 'put query parameters in "query", not in path.' };
	}
	// The URL parser reads %2e%2e as "..": an encoded dot, slash or backslash could climb out of /api/
	if (/%(2e|2f|5c)/i.test(path)) {
		return { ok: false, reason: 'path may not contain an encoded ".", "/" or "\\".' };
	}
	const normalized = normalizeDhis2ApiPath(path);
	const segments = normalized.split('/');
	if (segments.some(seg => seg === '..' || seg === '.')) {
		return { ok: false, reason: 'path may not contain "." or ".." segments.' };
	}
	if (segments.some(seg => seg === '')) {
		return { ok: false, reason: 'path has an empty segment ("//").' };
	}
	return { ok: true, path: normalized };
}
