/**
 * The notices, rendered from the markdown they are written in.
 *
 * Same file the app shows and the same file somebody agreed to — a version
 * recorded in `consents` has to point at text that cannot quietly differ from
 * what was on screen. Rendering is deliberately about twenty lines rather than
 * a markdown dependency: these two documents use headings, paragraphs, bold
 * and bullets, and nothing else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'legal');

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (text: string): string =>
  escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

function toHtml(markdown: string): { title: string; body: string } {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let title = 'lockin';
  let list = false;
  /** Whether the last thing written is a paragraph still open to more text. */
  let flowing = false;

  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      flowing = false;
      const level = heading[1]!.length;
      if (level === 1) title = heading[2]!;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) out.push('<ul>');
      list = true;
      flowing = false;
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    if (line === '') {
      closeList();
      // A blank line ends the paragraph. Without this the version line under
      // the title was swallowed into the sentence after it.
      flowing = false;
      continue;
    }
    // A paragraph wrapped across source lines is one paragraph. Joining here
    // rather than in the source keeps the markdown readable in an editor.
    if (flowing) {
      const previous = out[out.length - 1]!;
      out[out.length - 1] = `${previous.slice(0, -4)} ${inline(line)}</p>`;
    } else {
      out.push(`<p>${inline(line)}</p>`);
      flowing = true;
    }
  }
  closeList();

  return { title, body: out.join('\n') };
}

/** Cached: these files do not change while the process is running. */
const rendered = new Map<string, string>();

export function legalPage(file: string): string {
  const cached = rendered.get(file);
  if (cached) return cached;

  const { title, body } = toHtml(readFileSync(join(DIR, file), 'utf8'));
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · lockin</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2.5rem 1.25rem 6rem; max-width: 38rem;
    font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  h1 { font-size: 1.9rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .5rem; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 2.25rem 0 .5rem; }
  p, li { margin: 0 0 .9rem; }
  ul { padding-left: 1.2rem; }
  code { font-size: .9em; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  rendered.set(file, html);
  return html;
}
