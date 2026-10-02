/*---------------------------------------------------------------------------------------------
 *  Data Extractor: localize() for the code ported from DataSuite
 *  Ported from DataSuite (nls.ts); keep the two in step until DataSuite's built-in extractor is removed.
 *--------------------------------------------------------------------------------------------*/

/** `{0}`, `{1}`, ... in `message` replaced by `args` (the key is DataSuite's; the extension is English for now). */
export function localize(_key: string | { key: string }, message: string, ...args: unknown[]): string {
	return message.replace(/\{(\d+)\}/g, (match, index: string) => {
		const arg = args[Number(index)];
		return arg === undefined ? match : String(arg);
	});
}
