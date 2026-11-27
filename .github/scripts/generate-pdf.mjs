// .github/scripts/generate-pdf.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { chromium } from 'playwright';

const mdxFiles = process.argv.slice(2).filter((f) => f.endsWith('.mdx'));

if (mdxFiles.length === 0) {
  console.log('No MDX files provided. Exiting.');
  process.exit(0);
}

function cleanMdxContent(rawContent) {
  return rawContent
    // Remove top-level ES module imports/exports used in MDX
    .replace(/^\s*(import|export)\s+.*$/gm, '')
    // Optional: unwrap self-closing custom JSX tags or keep inner text of wrapper JSX tags
    .replace(/<([A-Z][A-Za-z0-9]*)\b[^>]*\/>/g, '')
    .replace(/<\/?([A-Z][A-Za-z0-9]*)\b[^>]*>/g, '');
}

async function getBase64Image(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase() || 'jpeg';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

const browser = await chromium.launch();

try {
  for (const mdxRelativePath of mdxFiles) {
    const fullMdxPath = path.resolve(mdxRelativePath);

    // Ensure the file still exists (wasn't deleted in the commit)
    try {
      await fs.access(fullMdxPath);
    } catch {
      console.log(`Skipping deleted or missing file: ${mdxRelativePath}`);
      continue;
    }

    // Expected structure: content/blog/<topic_name>/<file>.mdx
    const topicName = path.basename(path.dirname(mdxRelativePath));
    const coverPath = path.resolve('public/blog', topicName, 'cover.jpg');

    // Output location in the main tree (adjust if you prefer root or content/blog/<topic>/)
    const outputDir = path.resolve('public/blog', topicName);
    const outputPdfPath = path.join(outputDir, `${topicName}.pdf`);

    const rawFile = await fs.readFile(fullMdxPath, 'utf8');
    const { data: frontmatter, content } = matter(rawFile);

    const cleanedMarkdown = cleanMdxContent(content);
    const htmlBody = await marked.parse(cleanedMarkdown);
    const coverDataUri = await getBase64Image(coverPath);

    const title = frontmatter.title || topicName.replace(/[-_]/g, ' ');
    const dateStr = frontmatter.date
      ? new Date(frontmatter.date).toLocaleDateString('hu-HU', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';
    const summary = frontmatter.description || frontmatter.excerpt || '';

    const htmlDocument = `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8" />
  <style>
    @page {
      size: A4;
      margin: 20mm 18mm 22mm 18mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1f2937;
      line-height: 1.65;
      font-size: 11pt;
      margin: 0;
    }
    .cover-wrapper {
      margin-bottom: 24px;
      border-radius: 10px;
      overflow: hidden;
    }
    .cover-wrapper img {
      width: 100%;
      max-height: 300px;
      object-fit: cover;
      display: block;
    }
    .meta-date {
      color: #6b7280;
      font-size: 9.5pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    h1.doc-title {
      font-size: 24pt;
      line-height: 1.2;
      color: #111827;
      margin: 0 0 12px 0;
    }
    .lead {
      font-size: 12pt;
      color: #4b5563;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    h2, h3, h4 {
      color: #111827;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      page-break-after: avoid;
    }
    p, li {
      orphans: 3;
      widows: 3;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      page-break-inside: avoid;
    }
    pre {
      background: #f3f4f6;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }
    blockquote {
      border-left: 4px solid #2563eb;
      margin: 1em 0;
      padding: 0.25em 1em;
      color: #374151;
      background: #f9fafb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.2em 0;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background: #f3f4f6;
    }
  </style>
</head>
<body>
  ${coverDataUri ? `<div class="cover-wrapper"><img src="${coverDataUri}" alt="Cover" /></div>` : ''}
  ${dateStr ? `<div class="meta-date">${dateStr}</div>` : ''}
  <h1 class="doc-title">${title}</h1>
  ${summary ? `<div class="lead">${summary}</div>` : ''}
  <main>${htmlBody}</main>
</body>
</html>`;

    await fs.mkdir(outputDir, { recursive: true });
    const page = await browser.newPage();
    await page.setContent(htmlDocument, { waitUntil: 'networkidle' });

    await page.pdf({
      path: outputPdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width: 100%; font-size: 8pt; color: #9ca3af; padding: 0 18mm; display: flex; justify-content: space-between;">
          <span>SmartERP</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });

    await page.close();
    console.log(`Generated PDF: ${outputPdfPath}`);
  }
} finally {
  await browser.close();
}
