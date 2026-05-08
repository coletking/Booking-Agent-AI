// Build a single self-contained LEARN.html from LEARN.md.
// Open the resulting file in any browser, then print to PDF (Ctrl+P).
// Diagrams render via Mermaid + the markdown via marked, both from a CDN.

import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync(new URL("../LEARN.md", import.meta.url), "utf8");

// Escape any </script> sequences so the embedded markdown can't break out
// of its <script type="text/markdown"> wrapper.
const safeMd = md.replace(/<\/script>/gi, "<\\/script>");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learning Guide — ghece-booking-agent</title>
  <style>
    :root {
      --fg: #1a1a1a;
      --muted: #555;
      --bg: #ffffff;
      --code-bg: #f4f4f6;
      --border: #e2e2e6;
      --accent: #0b5fff;
    }
    html, body { background: var(--bg); color: var(--fg); }
    body {
      font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI",
            Roboto, Helvetica, Arial, sans-serif;
      max-width: 820px;
      margin: 40px auto;
      padding: 0 24px 80px;
    }
    h1, h2, h3, h4 { line-height: 1.25; margin-top: 2em; }
    h1 { font-size: 2em; border-bottom: 2px solid var(--border); padding-bottom: .3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: .25em; }
    h3 { font-size: 1.2em; }
    a { color: var(--accent); }
    code, pre {
      font-family: SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    code {
      background: var(--code-bg);
      padding: .15em .35em;
      border-radius: 4px;
      font-size: .9em;
    }
    pre {
      background: var(--code-bg);
      padding: 14px 18px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: .88em;
      line-height: 1.5;
    }
    pre code { background: transparent; padding: 0; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: .94em;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #fafafc; }
    blockquote {
      border-left: 4px solid var(--accent);
      margin: 1em 0;
      padding: .25em 1em;
      background: #f7faff;
      color: var(--muted);
    }
    .mermaid {
      background: #fbfbfd;
      padding: 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      text-align: center;
      overflow-x: auto;
      margin: 1em 0;
    }
    .print-hint {
      position: sticky;
      top: 0;
      background: #fff8e1;
      border: 1px solid #ffe082;
      color: #6a4f00;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 24px;
      font-size: .9em;
    }
    @media print {
      .print-hint { display: none; }
      body { margin: 0; max-width: none; }
      pre, .mermaid { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-hint">
    To save as PDF: press <strong>Ctrl+P</strong>, then choose
    <strong>Save as PDF</strong>. Wait a few seconds for the diagrams to
    render before printing.
  </div>
  <article id="content">Loading\u2026</article>

  <script id="md-source" type="text/markdown">
${safeMd}
  </script>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    const md = document.getElementById('md-source').textContent;
    const html = marked.parse(md, { breaks: false, gfm: true });
    document.getElementById('content').innerHTML = html;

    // Convert highlighted mermaid code blocks into Mermaid containers.
    document.querySelectorAll('pre code.language-mermaid').forEach((code) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid';
      wrapper.textContent = code.textContent;
      code.closest('pre').replaceWith(wrapper);
    });

    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    mermaid.run({ querySelector: '.mermaid' });
  </script>
</body>
</html>
`;

writeFileSync(new URL("../LEARN.html", import.meta.url), html, "utf8");
console.log("Wrote LEARN.html — open it in your browser and Ctrl+P → Save as PDF.");
