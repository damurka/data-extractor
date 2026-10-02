// esbuild bundles imported CSS into out/webview.css, and a picture as a file next to it (the import is its URL)
declare module '*.css';
declare module '*.png' {
	const url: string;
	export default url;
}
