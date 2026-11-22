async function request(source, term, signal) {
  const query = new URLSearchParams({ source, term });
  const response = await fetch(`./word-lookup?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Lookup service unavailable');
  return response.json();
}

const han = /^\p{Script=Han}+$/u;

function dictionaryParts(term) {
  if ([...term].length < 4) return [];
  const parts = typeof Intl.Segmenter === 'function' ?
    Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(term), part => part.segment) : [];
  if (parts.length < 2 || parts.some(part => [...part].length < 2)) {
    const letters = [...term];
    if (letters.length === 4) return [letters.slice(0, 2).join(''), letters.slice(2).join('')];
    return [];
  }
  return [...new Set(parts)].slice(0, 3);
}

async function dictionary(term, signal) {
  const data = await request('dictionary', term, signal);
  if (data.error && data.error !== 'Not Found') throw new Error('Dictionary service error');
  return (data.h ?? []).slice(0, 3).map(entry => ({
    term: data.t?.replace(/[`~]/g, '') || term,
    reading: entry.p,
    meaning: (entry.d ?? []).map(definition => definition.f?.replace(/[`~]/g, '')).filter(Boolean).slice(0, 5).join('\n'),
    source: '萌典 · 教育部《重編國語辭典修訂本》 · CC BY-ND 3.0 TW'
  })).filter(entry => entry.reading || entry.meaning);
}

export async function onlineLookup(term, signal) {
  let dictionaryUnavailable = false;
  if (han.test(term)) {
    try {
      const exact = await dictionary(term, signal);
      if (exact.length) return { items: exact };
      const parts = dictionaryParts(term);
      if (parts.length) {
        const results = await Promise.allSettled(parts.map(part => dictionary(part, signal)));
        dictionaryUnavailable = results.some(result => result.status === 'rejected');
        const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        if (entries.length) return {
          items: entries, split: true, incomplete: dictionaryUnavailable
        };
      }
    } catch {
      dictionaryUnavailable = true;
    }
  }
  const jobs = [request('encyclopedia', term, signal).then(data => {
    if (data.error) throw new Error('Encyclopedia service error');
    return (data.query?.pages ?? []).sort((a, b) => a.index - b.index)
      .filter(page => page.extract?.trim()).slice(0, 3)
      .map(page => ({ term: page.title, meaning: page.extract.trim().slice(0, 500), source: '中文维基百科 · CC BY-SA' }));
  })];
  if (/^\p{Script=Han}{1,12}$/u.test(term)) jobs.unshift(
    request('pronunciation', term, signal).then(data => {
      if (data.error && data.error.code !== 'missingtitle') throw new Error('Wiktionary service error');
      const text = data.parse?.wikitext ?? '';
      const readings = [...text.matchAll(/\{\{zh-pron\b[^}]*?\|\s*m\s*=\s*([^|}\n]+)/gi)]
        .map(match => match[1].trim()).filter(value => /^[\p{Script=Latin}\p{M}\s,;/'’0-5-]{1,120}$/u.test(value));
      const reading = [...new Set(readings)].slice(0, 5).join(' / ');
      const chinese = text.split(/^==\s*Chinese\s*==\s*$/mi)[1]?.split(/^==[^=\n].*==\s*$/m)[0] ?? '';
      const glosses = [...chinese.matchAll(/^#\s+(.+)$/gm)].map(match => match[1]
        .replace(/^\{\{(?:lb|label|q)\|[^{}]*\}\}\s*/, '')
        .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').replace(/'{2,5}/g, '').trim())
        .filter(gloss => gloss && !/[{}<>]/.test(gloss)).slice(0, 4);
      const meaning = glosses.join('\n').slice(0, 420);
      return reading || meaning ? [{ term, reading, meaning, source: '维基词典 · CC BY-SA' }] : [];
    }));
  const results = await Promise.allSettled(jobs);
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (han.test(term) && !items.some(item => item.reading) && !signal.aborted) {
    const data = await request('system-reading', term, signal).catch(() => ({}));
    if (data.reading && !/\p{Script=Han}/u.test(data.reading)) {
      items.unshift({ term, reading: data.reading, source: '系统推读 · 多音字读法仅供参考' });
    }
  }
  return { items, incomplete: dictionaryUnavailable || results.some(result => result.status === 'rejected') };
}
