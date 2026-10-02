/*---------------------------------------------------------------------------------------------
 *  Data Extractor: dates and numbers in DataSuite's display language (the panel's <html lang>, vscode.env.language),
 *  never the operating system's or Chromium's -- a webview's Intl default is the latter.
 *--------------------------------------------------------------------------------------------*/

/** DataSuite's display language, as a BCP 47 tag; English when it cannot be told. */
export const LOCALE = (() => {
	const lang = document.documentElement.lang;
	try {
		return lang && Intl.DateTimeFormat.supportedLocalesOf([lang]).length ? lang : 'en';
	} catch {
		return 'en';
	}
})();

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A date formatter in the display language, made once per set of options. */
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = JSON.stringify(options);
	let format = formatters.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(LOCALE, options);
		formatters.set(key, format);
	}
	return format;
}

/** A number with the display language's separators. */
export const formatNumber = (n: number) => n.toLocaleString(LOCALE);
