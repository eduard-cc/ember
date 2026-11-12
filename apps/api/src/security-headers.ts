import {createHash} from 'node:crypto';

// An enforced (not report-only) content security policy. The only inline script
// is index.html's pre-paint theme snippet, allowed by hash; React sets inline style
// attributes (exercise drawing masks), and small drawings are inlined as data: images.
const inlineScript = /<script(?![^>]*\ssrc\s*=)(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;

/** CSP source expressions for every inline script in `html`. */
export function inlineScriptHashes(html: string): string[] {
	// Browsers hash the parsed text, and parsing turns CRLF and lone CR into LF.
	return [...html.matchAll(inlineScript)].map(
		(match) => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`,
	);
}

export function securityHeaders(indexHtml = ''): Record<string, string> {
	const csp = [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		["script-src 'self'", ...inlineScriptHashes(indexHtml)].join(' '),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"worker-src 'self'",
		"manifest-src 'self'",
	].join('; ');
	return {
		'Content-Security-Policy': csp,
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
	};
}
