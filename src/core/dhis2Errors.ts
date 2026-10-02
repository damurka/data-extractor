/*---------------------------------------------------------------------------------------------
 *  Data Extractor: what a DHIS2 failure likely means, and what to do next -- for the chat tools' results
 *  Ported from DataSuite (platform/dhis2/common/dhis2Errors.ts classifyDhis2Error).
 *--------------------------------------------------------------------------------------------*/

export type Dhis2ErrorClass = 'auth' | 'forbidden' | 'notFound' | 'badRequest' | 'server' | 'timeout' | 'network' | 'noProfile' | 'cancelled' | 'other';

export interface IDhis2ErrorAdvice {
	readonly errorClass: Dhis2ErrorClass;
	readonly cause: string;
	readonly nextStep: string;
}

/**
 * Maps a DHIS2 failure message (DataSuite's DHIS2 client words them: "DHIS2 rejected the request (HTTP 409 ...)",
 * "DHIS2 request timed out.", ...) to its likely cause and the next step, so a tool returns something the AI can act on
 * instead of a bare "request failed".
 */
export function classifyDhis2Error(message: string): IDhis2ErrorAdvice {
	const m = message.toLowerCase();
	if (/no dhis2 profile|no dhis2 profiles|no dhis2 connection|profile .* not found|missing profile|matches no dhis2/.test(m)) {
		return { errorClass: 'noProfile', cause: 'No usable DHIS2 connection.', nextStep: 'Call dhis2_getProfiles and pass a valid profileId, or ask the user to sign in to a DHIS2 server in the Data Extractor (DHIS2: Open Data Extractor).' };
	}
	if (/did not give|no longer given|not given this|was not given/.test(m)) {
		return { errorClass: 'forbidden', cause: 'The user has not let the Data Extractor read through this DHIS2 connection.', nextStep: 'Ask the user to allow it (DataSuite asks when a tool needs it, or DHIS2: Manage Extension Access), then try again.' };
	}
	if (/cancel/.test(m)) {
		return { errorClass: 'cancelled', cause: 'The request was cancelled.', nextStep: 'Nothing to fix; re-run it if it is still wanted.' };
	}
	if (/invalid username or password/.test(m)) {
		return { errorClass: 'auth', cause: 'The DHIS2 server rejected the stored sign-in.', nextStep: 'Ask the user to sign in to this DHIS2 server again in DataSuite (Data Extractor > connections).' };
	}
	if (/not authorised|http 403/.test(m)) {
		return { errorClass: 'forbidden', cause: 'This DHIS2 user may not read that resource (sharing or authority settings).', nextStep: 'Tell the user; a DHIS2 administrator must grant access. Try a different data item or org unit the user can see.' };
	}
	if (/timed out|timeout/.test(m)) {
		return { errorClass: 'timeout', cause: 'The server took too long -- the query is probably too big.', nextStep: 'Ask for fewer periods, fewer data items, or a higher org unit level (e.g. LEVEL-2 instead of facilities), or split the request.' };
	}
	if (/unable to reach|no network|failed to contact|certificate|tls/.test(m)) {
		return { errorClass: 'network', cause: 'The DHIS2 server could not be reached.', nextStep: 'Check the internet connection / server URL; searches of the local metadata copy still work offline.' };
	}
	if (/http 404|not found/.test(m)) {
		return { errorClass: 'notFound', cause: 'An id or path does not exist on this server.', nextStep: 'Check uids with dhis2_searchMetadata (uids are case-sensitive, 11 characters) and the API path.' };
	}
	if (/period|\bpe\b|e71\d\d.*pe/.test(m) && /invalid|not valid|without any valid|could not be parsed|illegal/.test(m)) {
		return { errorClass: 'badRequest', cause: 'A period is not valid for this server.', nextStep: 'Use DHIS2 period ids: 2024, 202401, 2024Q1, 2024W1, 2024S1, 2024BiW1, or relative periods like LAST_12_MONTHS/THIS_YEAR. Ethiopian-calendar servers use Ethiopian years (e.g. 2016).' };
	}
	if (/http 409|http 400|rejected the request|e7\d\d\d|e1\d\d\d/.test(m)) {
		const unknownItem = /(dimension item|data element|indicator|organisation unit|org unit|uid|identifier).*(not found|invalid|does not exist|not valid)|(not found|invalid|does not exist).*(dimension item|data element|indicator|organisation unit|uid)/.test(m);
		return unknownItem
			? { errorClass: 'badRequest', cause: 'A data item or org unit id is not valid on this server.', nextStep: 'Look the item up with dhis2_searchMetadata and use the uid it returns.' }
			: { errorClass: 'badRequest', cause: 'DHIS2 rejected the request parameters (see its message above).', nextStep: 'Fix the parameter DHIS2 names; for analytics check dx/pe/ou values and that a data set is used with a .REPORTING_RATE/.ACTUAL_REPORTS/.EXPECTED_REPORTS suffix.' };
	}
	if (/server error|http 5\d\d/.test(m)) {
		return { errorClass: 'server', cause: 'The DHIS2 server failed while answering (often analytics tables not generated, or an overloaded server).', nextStep: 'Retry once; if it persists, try a smaller query, and tell the user the server may need its analytics tables regenerated.' };
	}
	return { errorClass: 'other', cause: 'Unexpected error.', nextStep: 'Report the message to the user; the "Data Extractor" output channel has the request trail.' };
}
