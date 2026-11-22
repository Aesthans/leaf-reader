import { searchMatcher } from './vendor/foliate/search.js';
import { textWalker } from './vendor/foliate/text-walker.js';
import { appearance, markColors, markStyles, markDecoration } from './mark-style.mjs';
import { onlineLookup } from './word-lookup.mjs';

const byId = id => document.getElementById(id);
const maxResults = 200;
const compact = text => text.replace(/\s+/g, ' ').trim();
const shorten = (text, limit = 150) => text.length > limit ? `${text.slice(0, limit)}…` : text;
const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

function textBoundaries(doc, range) {
  const isText = node => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
  if (isText(range.startContainer) && isText(range.endContainer)) return range;
  // A selection can start or end between elements. CFIs need text offsets to
  // reproduce the full selection when an element has an ID.
  const walker = doc.createTreeWalker(range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  let first, last;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || node.parentElement?.closest('script, style')) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end) continue;
    first ??= { node, start };
    last = { node, end };
  }
  if (!first) return;
  const result = doc.createRange();
  result.setStart(first.node, first.start);
  result.setEnd(last.node, last.end);
  return result;
}

async function* searchBook(view, query, signal) {
  const matches = searchMatcher(textWalker, { defaultLocale: view.language?.canonical });
  for (const [index, section] of view.book.sections.entries()) {
    if (signal.aborted) return;
    await yieldToUI();
    if (!section.createDocument) continue;
    const doc = await section.createDocument();
    if (!doc?.body) continue;
    for (const { range, excerpt } of matches(doc, query)) {
      if (signal.aborted) return;
      const { tocItem } = view.getProgressOf(index, range);
      yield { anchor: view.getCFI(index, range), excerpt, location: tocItem?.label || `第 ${index + 1} 节` };
    }
  }
}

export function createReadingTools({ showTab, run, notice, putMark, deleteMark, confirmDelete, afterJump, readingTime }) {
  const searchInput = byId('search-query');
  const searchStatus = byId('search-status');
  const results = byId('search-results');
  const markList = byId('mark-list');
  const toolbar = byId('selection-tools');
  const noteDialog = byId('note-dialog');
  const noteInput = byId('note-text');
  const mobile = document.body.hasAttribute('data-mobile');
  const styleDialog = byId('mark-style-dialog');
  const lookupDialog = byId('lookup-dialog');
  const onlineButton = byId('online-lookup');
  const webSearch = byId('lookup-web-search');
  const selectionOptions = byId('selection-mark-options');
  const markButton = byId('highlight-selection');
  selectionOptions.hidden = mobile;
  byId('lookup-selection').hidden = !mobile;
  const documents = new WeakMap();
  let view;
  let bookId;
  let bookTitle;
  let marks = [];
  let selection;
  let draft;
  let search;
  let lookupJob;
  let lookupTerm;
  let editingSelection;

  function palette(id, onChange) {
    const container = byId(id);
    let choice = { style: 'highlight', color: 'yellow' };
    for (const [key, choices] of [['style', Object.entries(markStyles)], ['color', Object.entries(markColors)]]) {
      const row = document.createElement('div');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', key === 'style' ? '标记样式' : '标记颜色');
      for (const [value, label] of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset[key] = value;
        if (key === 'color') {
          button.style.setProperty('--swatch', label[1]);
          button.setAttribute('aria-label', label[0]);
          button.title = label[0];
        } else if (mobile && id === 'selection-mark-options') {
          button.textContent = 'A';
          button.setAttribute('aria-label', label);
          button.title = label;
        } else button.textContent = label;
        button.onclick = () => {
          set({ ...choice, [key]: value });
          onChange?.(choice);
        };
        row.append(button);
      }
      container.append(row);
    }
    function set(next) {
      choice = { style: next?.style ?? 'highlight', color: next?.color ?? 'yellow' };
      for (const button of container.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.style === choice.style ||
          button.dataset.color === choice.color));
      }
    }
    set(choice);
    return { set, get: () => choice };
  }

  const selectionPalette = palette('selection-mark-options', choice => {
    if (!editingSelection) return;
    editingSelection = { ...editingSelection, ...choice };
    saveSelectionMark(editingSelection);
  });
  const stylePreview = byId('mark-style-preview');
  function previewStyle(choice) {
    const { style, ink } = appearance(choice);
    stylePreview.style.cssText = markDecoration(style, ink);
  }
  const editPalette = palette('edit-mark-options', previewStyle);

  function matchingMark(anchor) {
    return marks.find(mark => mark.kind === 'highlight' && (view?.isPDF ?
      JSON.stringify(mark.anchor.regions) === JSON.stringify(anchor.regions) : mark.anchor === anchor));
  }

  function clearSelection(clearNative = true) {
    if (clearNative) selection?.doc?.getSelection()?.removeAllRanges();
    selection = undefined;
    editingSelection = undefined;
    if (mobile) setSelectionActions(false);
    toolbar.hidden = true;
  }

  function setSelectionActions(editing) {
    selectionOptions.hidden = !editing;
    toolbar.classList.toggle('editing-mark', editing);
    byId('selection-mark-label').textContent = editing ? '删除划线' : '划线';
    markButton.setAttribute('aria-expanded', String(editing));
  }

  function positionSelection() {
    if (!mobile || !selection || noteDialog.open) return;
    const { doc, range } = selection;
    const area = toolbar.parentElement.getBoundingClientRect();
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    const offsetX = frame?.left ?? 0;
    const offsetY = frame?.top ?? 0;
    const lines = Array.from(range.getClientRects()).filter(rect =>
      rect.width && rect.height && rect.bottom + offsetY > area.top &&
      rect.top + offsetY < area.bottom && rect.right + offsetX > area.left &&
      rect.left + offsetX < area.right);
    toolbar.hidden = !lines.length;
    if (!lines.length) return;
    const gap = 12;
    const below = lines.at(-1).bottom + offsetY - area.top + gap;
    const height = toolbar.offsetHeight;
    const above = below + height > area.height - gap;
    const line = above ? lines[0] : lines.at(-1);
    const anchor = (line.left + line.right) / 2 + offsetX - area.left;
    const halfWidth = toolbar.offsetWidth / 2;
    const left = Math.max(halfWidth + gap, Math.min(anchor, area.width - halfWidth - gap));
    const top = above ? line.top + offsetY - area.top - height - gap : below;
    toolbar.dataset.side = above ? 'above' : 'below';
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(gap, Math.min(top, area.height - height - gap))}px`;
    toolbar.style.setProperty('--selection-arrow',
      `${Math.max(14, Math.min(anchor - left + halfWidth, 2 * halfWidth - 14))}px`);
  }

  function updateSelection(owner, doc, index) {
    if (owner !== view || noteDialog.open) return;
    if (mobile && document.body.dataset.screen !== 'reader') return;
    const selected = doc.getSelection();
    const range = selected?.rangeCount && selected.getRangeAt(0);
    const quote = range && !range.collapsed ? compact(range.toString()) : '';
    if (!quote) {
      if (selection?.doc === doc && !editingSelection) clearSelection(false);
      return;
    }
    const textRange = !owner.isPDF && doc.body?.contains(range.commonAncestorContainer) ?
      textBoundaries(doc, range) : undefined;
    const anchor = owner.isPDF ? owner.selectionAnchor(range) :
      textRange ? owner.getCFI(index, textRange) : undefined;
    if (!anchor) {
      clearSelection(false);
      return;
    }
    const location = owner.isPDF ? `第 ${anchor.page} 页` :
      owner.getProgressOf(index, textRange).tocItem?.label || `第 ${index + 1} 节`;
    const oldMark = matchingMark(anchor);
    const changed = !selection || selection.doc !== doc || (owner.isPDF ?
      JSON.stringify(selection.anchor.regions) !== JSON.stringify(anchor.regions) : selection.anchor !== anchor);
    selection = { doc, range: range.cloneRange(), anchor, quote, location };
    if (changed) {
      editingSelection = undefined;
      if (mobile) setSelectionActions(false);
      selectionPalette.set(appearance(oldMark ?? {}) ?? selectionPalette.get());
    }
    toolbar.hidden = false;
    positionSelection();
  }

  function paintDocument(owner, doc, index) {
    const win = doc.defaultView;
    if (!win?.CSS?.highlights) return;
    const layers = new Map();
    for (const name of ['leaf-reading-mark', 'leaf-reading-note',
      ...Object.keys(markStyles).flatMap(style => Object.keys(markColors).map(color => `leaf-${style}-${color}`))]) {
      win.CSS.highlights.delete(name);
    }
    for (const mark of marks) {
      if (mark.kind !== 'highlight') continue;
      const target = owner.resolveNavigation(mark.anchor);
      if (target?.index !== index) continue;
      try {
        const range = target.anchor?.(doc);
        if (!range) continue;
        const look = appearance(mark);
        const name = look ? `leaf-${look.style}-${look.color}` : (mark.note ? 'leaf-reading-note' : 'leaf-reading-mark');
        if (!layers.has(name)) layers.set(name, new win.Highlight());
        layers.get(name).add(range);
      } catch (error) {
        console.warn('Unable to draw reading mark', error);
      }
    }
    for (const [name, layer] of layers) win.CSS.highlights.set(name, layer);
  }

  function paintMarks() {
    if (!view) return;
    if (view.isPDF) {
      view.setReadingMarks(marks.filter(mark => mark.kind === 'highlight'));
      return;
    }
    const loaded = documents.get(view);
    for (const [doc, index] of loaded ?? []) {
      if (!doc.defaultView?.frameElement?.isConnected) loaded.delete(doc);
      else paintDocument(view, doc, index);
    }
  }

  function bindDocument(owner, doc, index) {
    if (!documents.has(owner)) documents.set(owner, new Map());
    const loaded = documents.get(owner);
    for (const previous of loaded.keys()) {
      if (!previous.defaultView?.frameElement?.isConnected) loaded.delete(previous);
    }
    loaded.set(doc, index);
    const style = doc.createElement('style');
    style.textContent = `::highlight(leaf-reading-mark) { background-color: #f5bf3970; ${mobile ? 'text-decoration: underline;' : ''} }
      ::highlight(leaf-reading-note) { background-color: #70c6b780; text-decoration: underline; }` +
      Object.keys(markStyles).flatMap(style => Object.entries(markColors).map(([color, [, ink]]) =>
        `::highlight(leaf-${style}-${color}) { ${markDecoration(style, ink)} }`)).join('\n');
    (doc.head ?? doc.documentElement).append(style);
    doc.addEventListener('selectionchange', () => updateSelection(owner, doc, index));
    if (mobile) doc.addEventListener('pointerdown', () => {
      if (owner === view && editingSelection) clearSelection();
    });
    if (owner === view) {
      clearSelection();
      paintDocument(owner, doc, index);
    }
  }

  function jump(owner, anchor, fromSearch = false) {
    run(async () => {
      if (owner !== view) return;
      clearSelection();
      if (owner.isPDF) await owner.goToReadingMark(anchor, fromSearch);
      else if (fromSearch && !owner.isFixedLayout) await owner.select(anchor);
      else await owner.goTo(anchor);
      afterJump?.();
    }, '无法跳回该阅读位置。');
  }

  function addResult(owner, result) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entry search-result';
    const location = document.createElement('small');
    location.className = 'result-location';
    location.textContent = result.location;
    const hit = document.createElement('mark');
    hit.textContent = result.excerpt.match;
    button.append(location, result.excerpt.pre, hit, result.excerpt.post);
    button.onclick = () => jump(owner, result.anchor, true);
    results.append(button);
  }

  async function find(query) {
    search?.abort();
    results.replaceChildren();
    if (!view || !query) {
      searchStatus.textContent = view ? '输入要查找的文字。' : '打开一本书后即可搜索。';
      return;
    }
    const owner = view;
    const job = search = new AbortController();
    const { signal } = job;
    const matches = owner.isPDF ? owner.searchText(query, signal) : searchBook(owner, query, signal);
    searchStatus.textContent = '正在查找…';
    let count = 0;
    try {
      for await (const result of matches) {
        if (signal.aborted) return;
        if (count === maxResults) {
          searchStatus.textContent = `仅显示前 ${maxResults} 条结果。`;
          return;
        }
        addResult(owner, result);
        if (++count % 20 === 0) await yieldToUI();
      }
      if (!signal.aborted) searchStatus.textContent = count ? `找到 ${count} 条结果` :
        owner.isPDF && !owner.hasSearchableText ? '这个 PDF 没有可搜索的文字层。' : '没有找到匹配内容。';
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      searchStatus.textContent = count ? `搜索中断，已显示 ${count} 条结果。` : '无法读取本书的搜索内容。';
    }
  }

  function renderMarks() {
    markList.replaceChildren();
    if (!mobile && view) {
      const time = document.createElement('p');
      time.id = 'desktop-book-time';
      time.textContent = `本书已读 ${readingTime(bookId) ?? '0 秒'}`;
      markList.append(time);
    }
    if (mobile && view) {
      const summary = document.createElement('header');
      summary.className = 'mobile-notes-summary';
      const title = document.createElement('strong');
      title.className = 'single-line';
      title.textContent = title.title = bookTitle;
      const count = document.createElement('p');
      count.textContent = `共 ${marks.length} 条阅读记录`;
      const time = document.createElement('p');
      time.id = 'mobile-book-time';
      time.textContent = `本书已读 ${readingTime(bookId)}`;
      summary.append(title, count, time);
      markList.append(summary);
    }
    if (!marks.length) {
      const empty = document.createElement('p');
      empty.className = 'list-note';
      empty.textContent = view ? mobile ? '长按正文选中文字，即可划线或写想法。' :
        '可添加当前位置书签，或选中文字做高亮和批注。' : '打开一本书后即可添加阅读标记。';
      markList.append(empty);
    }
    const owner = view;
    const groups = new Map();
    for (const mark of marks) {
      const row = document.createElement('div');
      row.className = 'mark-card';
      const label = mark.kind === 'bookmark' ? '书签' : mark.note ? (mobile ? '想法' : '批注') :
        markStyles[appearance(mark)?.style] ?? (mobile ? '划线' : '高亮');
      const target = document.createElement('button');
      target.type = 'button';
      target.className = 'entry';
      const location = document.createElement('small');
      location.className = 'result-location';
      location.textContent = mobile ? label : `${label} · ${mark.location}`;
      const text = document.createElement('span');
      text.className = mobile ? 'mark-quote' : 'single-line';
      const quote = mark.quote || mark.location;
      text.textContent = mobile ? shorten(quote, 500) : quote;
      text.title = quote;
      const look = appearance(mark);
      if (look) text.style.cssText = markDecoration(look.style, look.ink);
      target.append(location, text);
      target.onclick = () => jump(owner, mark.anchor);
      row.append(target);
      if (mark.note) {
        const note = document.createElement('p');
        note.className = 'mark-note';
        note.textContent = mobile ? mark.note : shorten(mark.note, 160);
        note.title = mark.note;
        row.append(note);
      }
      const actions = document.createElement('div');
      actions.className = 'mark-actions';
      if (mark.kind === 'highlight') {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = mobile ? (mark.note ? '编辑想法' : '写想法') : (mark.note ? '编辑批注' : '写批注');
        edit.onclick = () => openNote(mark);
        const restyle = document.createElement('button');
        restyle.type = 'button';
        restyle.textContent = '改样式';
        restyle.onclick = () => openStyle(mark);
        actions.append(restyle, edit);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除${label}`);
      remove.onclick = () => confirmDelete(label, async () => {
        await deleteMark(mark);
        if (owner === view) {
          marks = marks.filter(item => item.id !== mark.id);
          paintMarks();
          renderMarks();
        }
      });
      actions.append(remove);
      row.append(actions);
      if (mobile) {
        let group = groups.get(mark.location);
        if (!group) {
          group = document.createElement('section');
          group.className = 'mobile-note-group';
          const heading = document.createElement('h3');
          heading.textContent = mark.location;
          group.append(heading);
          markList.append(group);
          groups.set(mark.location, group);
        }
        group.append(row);
      } else markList.append(row);
    }
  }

  async function storeMark(mark) {
    await putMark(mark);
    if (mark.bookId !== bookId) return;
    const index = marks.findIndex(item => item.id === mark.id);
    if (index < 0) marks.unshift(mark);
    else marks[index] = mark;
    paintMarks();
    renderMarks();
  }

  function newMark(kind, { anchor, quote, location }) {
    return { id: crypto.randomUUID(), bookId, kind, anchor, quote, location, createdAt: Date.now() };
  }

  function openNote(mark) {
    draft = mark;
    if (mobile) byId('note-title').textContent = mark.note ? '编辑想法' : '写想法';
    byId('note-quote').textContent = mark.quote;
    noteInput.value = mark.note ?? '';
    byId('note-notice').hidden = true;
    noteDialog.showModal();
    noteInput.focus();
  }

  function openStyle(mark) {
    const choice = appearance(mark) ?? { style: 'highlight', color: mark.note ? 'green' : 'yellow' };
    editPalette.set(choice);
    stylePreview.textContent = mark.quote;
    previewStyle(choice);
    byId('mark-style-notice').hidden = true;
    styleDialog.showModal();
    const save = byId('save-mark-style');
    save.onclick = () => {
      const cancel = byId('cancel-mark-style');
      save.disabled = cancel.disabled = true;
      run(async () => {
        await storeMark({ ...mark, ...editPalette.get() });
        styleDialog.close();
      }, '无法保存标记样式。').finally(() => { save.disabled = cancel.disabled = false; });
    };
  }

  function showLookupResults(items, message) {
    const result = byId('lookup-results');
    result.replaceChildren();
    for (const { term, reading, meaning, source } of items) {
      const card = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = term;
      card.append(title);
      for (const [tag, content] of [['b', reading], ['p', meaning], ['small', source]]) {
        if (!content) continue;
        const part = document.createElement(tag);
        part.textContent = content;
        card.append(part);
      }
      result.append(card);
    }
    if (message) {
      const status = document.createElement('p');
      status.textContent = message;
      result.append(status);
    }
  }

  function stopLookup() {
    lookupJob?.abort();
    lookupJob = undefined;
  }

  byId('lookup-selection').onclick = () => {
    if (!selection) return;
    const quote = selection.quote.replace(/^[《「『“（]+|[，。！？；：、》」』”）]+$/g, '');
    lookupTerm = [...quote].slice(0, 32).join('');
    byId('lookup-title').textContent = lookupTerm || '查词';
    clearSelection();
    lookupDialog.showModal();
    lookup();
  };
  byId('close-lookup').onclick = () => lookupDialog.close();
  webSearch.onclick = () => lookupDialog.close();
  lookupDialog.addEventListener('close', () => { if (!lookupDialog.open) stopLookup(); });
  onlineButton.onclick = lookup;
  async function lookup() {
    stopLookup();
    onlineButton.hidden = true;
    webSearch.hidden = true;
    if (!lookupTerm) return showLookupResults([], '请选择要查的词语或汉字。');
    const job = lookupJob = new AbortController();
    const timeout = setTimeout(() => job.abort(), 12000);
    showLookupResults([], '正在联网查询…');
    try {
      const { items, incomplete, split } = await onlineLookup(lookupTerm, job.signal);
      if (lookupJob !== job) return;
      showLookupResults(items, split ? '整词未收录，以上是拆分后的词条。' : incomplete ?
        (items.length ? '部分词典来源暂时无法连接。' : '暂时无法连接词典。') :
        (items.length ? '' : '词典暂无匹配结果。'));
      onlineButton.hidden = !incomplete;
      if (!items.some(item => item.meaning)) {
        webSearch.href = `./word-search?term=${encodeURIComponent(lookupTerm)}`;
        webSearch.hidden = false;
        if (!items.length && lookupDialog.open) webSearch.click();
      }
    } finally {
      clearTimeout(timeout);
      if (lookupJob === job) stopLookup();
    }
  }

  function addBookmark() {
    const position = view?.lastLocation;
    if (!position) return;
    const anchor = view.isPDF ? position.pdf : position.cfi;
    if (!anchor) return;
    const location = view.isPDF ? `第 ${anchor.page} 页` : position.tocItem?.label ||
      `进度 ${Math.round((position.fraction || 0) * 100)}%`;
    const quote = view.isPDF ? '' : shorten(compact(position.range?.toString() ?? ''));
    const sameAnchor = marks.some(mark => mark.kind === 'bookmark' && (view.isPDF ?
      mark.anchor.page === anchor.page && mark.anchor.top === anchor.top && mark.anchor.left === anchor.left :
      mark.anchor === anchor));
    if (sameAnchor) {
      notice('当前位置已有书签。');
      return;
    }
    const mark = newMark('bookmark', { anchor, quote, location });
    run(async () => {
      await storeMark(mark);
      showTab('notes');
    }, '无法保存书签。');
  }

  byId('search-form').onsubmit = event => {
    event.preventDefault();
    find(compact(searchInput.value));
  };
  byId('add-bookmark').onclick = addBookmark;
  toolbar.addEventListener('pointerdown', event => event.preventDefault());
  if (mobile) window.addEventListener('resize', positionSelection);
  byId('cancel-mark-style').onclick = () => styleDialog.close();
  styleDialog.addEventListener('cancel', event => {
    if (byId('save-mark-style').disabled) event.preventDefault();
  });
  function saveSelectionMark(mark) {
    run(() => storeMark(mark), '无法保存划线。');
  }

  markButton.onclick = () => {
    if (!selection) return;
    const stored = matchingMark(selection.anchor);
    const existing = stored && { ...stored, quote: selection.quote };
    if (mobile) {
      if (editingSelection) {
        const mark = editingSelection;
        const remove = async () => {
          await deleteMark(mark);
          marks = marks.filter(item => item.id !== mark.id);
          paintMarks();
          renderMarks();
          clearSelection();
        };
        if (mark.note) confirmDelete('划线及想法', remove);
        else run(remove, '无法删除划线。');
        return;
      }
      if (existing && !appearance(existing)) {
        selectionPalette.set({ style: 'highlight', color: existing.note ? 'green' : 'yellow' });
      }
      editingSelection = existing ?? { ...newMark('highlight', selection), ...selectionPalette.get() };
      setSelectionActions(true);
      selection.doc.getSelection()?.removeAllRanges();
      positionSelection();
      if (!stored || stored.quote !== selection.quote) saveSelectionMark(editingSelection);
      return;
    }
    const mark = { ...(existing ?? newMark('highlight', selection)), ...selectionPalette.get() };
    clearSelection();
    run(async () => {
      await storeMark(mark);
      if (!mobile) showTab('notes');
    }, '无法保存高亮。');
  };
  byId('note-selection').onclick = () => {
    if (!selection) return;
    const mark = editingSelection ?? matchingMark(selection.anchor) ??
      { ...newMark('highlight', selection), ...selectionPalette.get() };
    openNote({ ...mark, quote: selection.quote });
    if (mobile) clearSelection();
  };
  document.addEventListener('selectionchange', () => {
    if (view?.isPDF) updateSelection(view, document);
  });
  if (mobile) byId('reading-area').addEventListener('pointerdown', event => {
    if (editingSelection && !toolbar.contains(event.target)) clearSelection();
  });
  byId('cancel-note').onclick = () => noteDialog.close();
  noteDialog.addEventListener('cancel', event => {
    if (byId('save-note').disabled) event.preventDefault();
  });
  byId('note-form').onsubmit = event => {
    event.preventDefault();
    const text = noteInput.value.trim();
    if (!text) {
      notice(mobile ? '请输入想法。' : '请输入批注内容。');
      noteInput.focus();
      return;
    }
    const save = byId('save-note');
    const cancel = byId('cancel-note');
    save.disabled = cancel.disabled = true;
    const mark = { ...draft, note: text };
    run(async () => {
      await storeMark(mark);
      noteDialog.close();
      clearSelection();
      if (!mobile) showTab('notes');
    }, '无法保存批注。').finally(() => { save.disabled = cancel.disabled = false; });
  };

  function setBook(owner, id, stored = [], title = '') {
    search?.abort();
    clearSelection();
    if (mobile) (view?.isPDF ? view : view?.renderer)?.removeEventListener('scroll', positionSelection, true);
    view = owner;
    bookId = id;
    bookTitle = title;
    if (mobile) (view?.isPDF ? view : view?.renderer)?.addEventListener('scroll', positionSelection, true);
    marks = stored.sort((a, b) => b.createdAt - a.createdAt);
    searchInput.value = '';
    searchInput.disabled = byId('search-submit').disabled = byId('add-bookmark').disabled = !view;
    results.replaceChildren();
    searchStatus.textContent = view ? '输入要查找的文字。' : '打开一本书后即可搜索。';
    paintMarks();
    renderMarks();
  }
  setBook();
  return { setBook, bindDocument, clearSelection, openSearch() { showTab('search'); searchInput.focus(); } };
}
