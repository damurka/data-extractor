// Builds the extension (Node, CommonJS, for the extension host) and its webview (React, for the browser), each into one
// file. exceljs is bundled too: the .vsix ships no node_modules.
//
//   node esbuild.mjs            build once (minified)
//   node esbuild.mjs --watch    rebuild on change (unminified, with source maps)

import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

// @quire/components is linked from the UI kit (file:); its imports of React must find this package's React, not the
// kit's, or the webview would hold two Reacts
const require = createRequire(import.meta.url);
const own = (name) => path.dirname(require.resolve(`${name}/package.json`));

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions[]} */
const builds = [
	{
		entryPoints: ['src/extension.ts'],
		outfile: 'out/extension.js',
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		external: ['vscode'],
	},
	{
		entryPoints: ['src/webview/main.tsx'],
		outfile: 'out/webview.js',
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: 'chrome130',
		jsx: 'automatic',
		alias: { 'react': own('react'), 'react-dom': own('react-dom') },
		// fonts (the apps' Source Sans and Serif, Font Awesome, the calendar's codicons), emitted next to
		// webview.css and referenced from it; pictures inline (a path in the script would be relative to the webview's page)
		loader: { '.css': 'css', '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'file', '.png': 'dataurl' },
		assetNames: '[name]-[hash]',
	},
];

// what earlier builds emitted (renamed assets) is not left next to this build's
if (!watch) {
	fs.rmSync('out', { recursive: true, force: true });
}

for (const options of builds) {
	const config = { ...options, minify: !watch, sourcemap: watch ? 'inline' : false, logLevel: 'info', define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' } };
	if (watch) {
		await (await esbuild.context(config)).watch();
	} else {
		await esbuild.build(config);
	}
}
