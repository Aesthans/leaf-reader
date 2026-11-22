const maxSectionLength = 24000;
const chapterHeading = /^(?:第[\d０-９零〇一二三四五六七八九十百千万两]+[章节回卷部篇集幕]|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)(?=[\s.:：-]|$)|序章|楔子|尾声|后记|終章|终章)/i;
const escapeHTML = text => text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

function decode(bytes) {
  const [first, second] = bytes;
  if (first === 0xff && second === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (first === 0xfe && second === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
  }
}

function splitSections(text) {
  const sections = [];
  let lines = [];
  let heading = '';
  let length = 0;
  const flush = () => {
    if (lines.length) sections.push({ lines, heading, length });
    lines = [];
    heading = '';
    length = 0;
  };
  for (const line of text.split(/\r\n?|\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 70 && chapterHeading.test(trimmed)) {
      flush();
      heading = trimmed;
      lines.push(trimmed);
      length = trimmed.length;
      continue;
    }
    let start = 0;
    while (start < line.length) {
      if (length && length + line.length - start > maxSectionLength) flush();
      let end = Math.min(start + maxSectionLength, line.length);
      if (end < line.length && /[\uDC00-\uDFFF]/.test(line[end])) end--;
      lines.push(line.slice(start, end));
      length += end - start;
      start = end;
    }
  }
  flush();
  return sections;
}

export async function makeTextBook(file) {
  const text = decode(new Uint8Array(await file.arrayBuffer())).replaceAll('\0', '');
  const chapters = splitSections(text);
  if (!chapters.length) throw new Error('Empty text book');
  const ids = chapters.map((_chapter, index) => `text-${index}`);
  const sections = chapters.map(({ lines, heading, length }, index) => {
    let url;
    const html = () => `<!doctype html><html><head><meta charset="utf-8"><style>
      p { white-space: pre-wrap; overflow-wrap: anywhere; margin-block: .65em; }
      </style></head><body>${lines.map((line, lineIndex) => {
      const tag = heading && lineIndex === 0 ? 'h2' : 'p';
      return `<${tag}>${escapeHTML(line)}</${tag}>`;
    }).join('')}</body></html>`;
    return {
      id: ids[index],
      size: length,
      load: () => url ??= URL.createObjectURL(new Blob([html()], { type: 'text/html;charset=utf-8' })),
      unload: () => {
        if (url) URL.revokeObjectURL(url);
        url = undefined;
      },
      createDocument: () => new DOMParser().parseFromString(html(), 'text/html')
    };
  });
  const hasHeadings = chapters.some(chapter => chapter.heading);
  const toc = chapters.flatMap(({ heading }, index) => {
    if (hasHeadings && !heading && index > 0) return [];
    return [{ label: heading || (hasHeadings ? '正文开头' : `正文 ${index + 1}`), href: ids[index] }];
  });
  return {
    metadata: { title: file.name.replace(/\.txt$/i, ''), language: /\p{Script=Han}/u.test(text) ? 'zh-CN' : 'en' },
    sections,
    toc,
    resolveHref: href => ({ index: ids.indexOf(href) }),
    splitTOCHref: href => [href, null],
    getTOCFragment: () => null
  };
}
