import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {inlineScriptHashes, securityHeaders} from '../../api/src/security-headers';

const sha = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

describe('enforced content security policy', () => {
  it("allows the real shell's pre-paint theme script by hash and nothing else inline", () => {
    // A shell change the hashing misreads would only fail in the browser, silently
    // blocking the theme script, so pin it against the actual index.html.
    const html = readFileSync('index.html', 'utf8');
    const inline = html.split('<script>')[1].split('</script>')[0];
    expect(inline).toContain('ember:appearance:v1');
    expect(inlineScriptHashes(html)).toEqual([sha(inline)]);
    const csp = securityHeaders(html)['Content-Security-Policy'];
    expect(csp).toContain(`script-src 'self' ${sha(inline)};`);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  });
  it('hashes parsed script text: CRLF as LF, any attributes, never external scripts', () => {
    const html = [
      '<SCRIPT type="text/javascript">a()\r\nb()\r</SCRIPT >',
      '<script data-src="x">c()</script>',
      '<script type="module" src="/assets/index.js"></script>',
      '<script src = "/x.js"></script>',
    ].join('');
    expect(inlineScriptHashes(html)).toEqual([sha('a()\nb()\n'), sha('c()')]);
  });
});
