const fs = require('node:fs');
const path = require('node:path');

function copyWebAssets(project, target, { legacyPDF = false } = {}) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of ['index.html', 'reader.mjs', 'text-book.mjs', 'pdf-reader.mjs', 'reading-tools.mjs',
    'mark-style.mjs', 'word-lookup.mjs', 'desktop-settings.mjs', 'pdf-search.mjs', 'styles.css', 'assets', 'vendor',
    'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    fs.cpSync(path.join(project, entry), path.join(target, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(project, 'mobile', 'reading-clock.mjs'), path.join(target, 'reading-clock.mjs'));
  const pdfSource = path.join(project, 'node_modules', 'pdfjs-dist');
  for (const entry of ['LICENSE', 'build/pdf.mjs', 'build/pdf.worker.mjs', 'web/pdf_viewer.mjs',
    'web/pdf_viewer.css', 'web/images', 'cmaps', 'standard_fonts', 'iccs', 'wasm']) {
    const destination = path.join(target, 'vendor', 'pdfjs', entry);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const source = legacyPDF && entry.endsWith('.mjs') ? path.join(pdfSource, 'legacy', entry) :
      path.join(pdfSource, entry);
    fs.cpSync(source, destination, { recursive: true });
  }
}

module.exports = { copyWebAssets };
