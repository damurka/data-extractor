/*---------------------------------------------------------------------------------------------
 *  Data Extractor tests: `require('vscode')` loads the test stand-in (vscode.ts). Loaded with `node --require`.
 *--------------------------------------------------------------------------------------------*/

import Module from 'node:module';
import * as path from 'node:path';

const stub = path.join(__dirname, 'vscode.js');
const internal = Module as unknown as { _resolveFilename(request: string, ...rest: unknown[]): string };
const resolve = internal._resolveFilename;
internal._resolveFilename = function (request: string, ...rest: unknown[]) {
	return request === 'vscode' ? stub : resolve.call(this, request, ...rest);
};
