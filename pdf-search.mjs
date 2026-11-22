const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const letter = /\p{L}/u;
const cjk = /[\p{Ideographic}\u3040-\u30ff]/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function pdfSearchPattern(query) {
  const chars = Array.from(query.normalize('NFKC').trim().replace(/\s+/g, ' '));
  if (!chars.length) return;
  const pattern = chars.map((char, index) => {
    if (/\s/u.test(char)) return '\\s+';
    let part = escapePattern(char);
    if (/[-\u2010]/u.test(char)) part += '(?:[ \\t]*\\n[ \\t]*)?';
    if (letter.test(char) && letter.test(chars[index + 1] ?? '')) {
      // Permit a typesetting hyphen only at an extracted line ending.
      part += '(?:[-\u2010][ \\t]*\\n[ \\t]*|\u00ad\\n?)?';
      if (cjk.test(char) && cjk.test(chars[index + 1])) part += '\\n?';
    }
    return part;
  }).join('');
  return new RegExp(pattern, 'giu');
}

function normalizeItem(str) {
  const text = str.normalize('NFKC');
  if (text === str) return { text };
  const starts = [], ends = [];
  for (const { segment, index } of graphemes.segment(str)) {
    const length = segment.normalize('NFKC').length;
    for (let unit = 0; unit < length; unit++) {
      starts.push(index);
      ends.push(index + segment.length);
    }
  }
  return { text, starts, ends };
}

export function* searchPDFPage(items, pattern) {
  const spans = [];
  let text = '', index = 0;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (item.str) {
      const normalized = normalizeItem(item.str);
      spans.push({ offset: text.length, end: text.length + normalized.text.length,
        item, index, ...normalized });
      text += normalized.text;
    }
    if (item.hasEOL) text += '\n';
    index++;
  }
  let first = 0;
  for (const match of text.matchAll(pattern)) {
    while (spans[first]?.end <= match.index) first++;
    const end = match.index + match[0].length;
    const ranges = [];
    for (let at = first; at < spans.length && spans[at].offset < end; at++) {
      const span = spans[at];
      const startOffset = Math.max(0, match.index - span.offset);
      const endOffset = Math.min(span.text.length, end - span.offset);
      ranges.push({ index: span.index,
        start: span.starts?.[startOffset] ?? startOffset,
        end: span.ends?.[endOffset - 1] ?? endOffset });
    }
    const item = spans[first]?.item;
    if (!item || !ranges.length) continue;
    yield {
      left: item.transform[4], top: item.transform[5] + item.height + 20,
      textRanges: ranges,
      excerpt: {
        pre: (match.index > 36 ? '…' : '') + text.slice(Math.max(0, match.index - 36), match.index).replace(/\s+/g, ' '),
        match: match[0].replace(/\s+/g, ' '),
        post: text.slice(end, end + 36).replace(/\s+/g, ' ') + (end + 36 < text.length ? '…' : '')
      }
    };
  }
}
