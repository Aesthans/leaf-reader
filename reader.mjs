import { makeBook } from './vendor/foliate/view.js';
import { makeTextBook } from './text-book.mjs';
import { createReadingTools } from './reading-tools.mjs';

const byId = id => document.getElementById(id);
const fileInput = byId('file');
const readingArea = byId('reading-area');
const shelf = byId('shelf');
const toc = byId('toc');
const notice = byId('notice');
const libraryDialog = byId('library-dialog');
const actionDialog = byId('action-dialog');
const bookExtension = /\.(epub|txt|mobi|azw3|pdf)$/i;
const interactiveContent = 'a, button, input, select, textarea, label, summary, audio, video, [contenteditable], [role="button"]';
const preferencesKey = 'leaf.preferences';
const bookPreferencesKey = id => `leaf.book-preferences.${id}`;
const lastBookKey = 'leaf.last-book';
const shelfGroupKey = 'leaf.shelf-group';
const allGroups = 'all';
const ungrouped = '';
const progressKey = id => `leaf.progress.${id}`;
const scrollKey = id => `leaf.scroll.${id}`;
const themes = {
  paper: { text: '#262922', background: '#fffefa', link: '#35634b' },
  sepia: { text: '#342b1f', background: '#fdf2df', link: '#635a37' },
  dark: { text: '#eceee7', background: '#181c1a', link: '#aad4b5' }
};

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

const validSize = size => Number.isInteger(size) && size >= 14 && size <= 36;
function readPreferences(value, fallback) {
  return {
    theme: Object.hasOwn(themes, value?.theme) ? value.theme : fallback.theme,
    flow: ['paginated', 'scrolled'].includes(value?.flow) ? value.flow : fallback.flow,
    leading: [1.45, 1.65, 2].includes(value?.leading) ? value.leading : fallback.leading,
    size: validSize(value?.size) ? value.size : fallback.size
  };
}
const defaultPreferences = readPreferences(readLocal(preferencesKey), {
  theme: document.body.hasAttribute('data-mobile') ? 'sepia' : 'paper', flow: 'paginated', size: 20, leading: 1.65
});
let preferences = defaultPreferences;
let defaultsRevision = 0;
let activeDefaultsRevision = 0;
let activeView;
let activeBook;
let mobile;
let desktop;
let makeCover;
let pending = 0;
let operationQueue = Promise.resolve();
let books = [];
let groups = [];
let shelfGroup = allGroups;
const selectedBooks = new Set();
let tocButtons = new Map();
let currentChapter;
let dragTimer;

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('leaf-library', 3);
  request.onupgradeneeded = event => {
    if (event.oldVersion < 1) request.result.createObjectStore('books', { keyPath: 'id' });
    if (event.oldVersion < 2) request.result.createObjectStore('groups', { keyPath: 'id' });
    if (event.oldVersion < 3) {
      request.result.createObjectStore('marks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function useLibrary(stores, mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    transaction.onabort = () => reject(transaction.error ?? new Error('Library transaction aborted'));
    try {
      const request = operation(transaction);
      transaction.oncomplete = () => resolve(request?.result);
    } catch (error) {
      reject(error);
      transaction.abort();
    }
  });
}

const useStore = (name, mode, operation) => useLibrary(name, mode, transaction =>
  operation(transaction.objectStore(name)));

function showNotice(message) {
  const target = actionDialog.open ? byId('action-notice') :
    byId('desktop-settings')?.open ? byId('desktop-settings-notice') :
    byId('note-dialog').open ? byId('note-notice') :
    byId('mark-style-dialog').open ? byId('mark-style-notice') :
    libraryDialog.open ? byId('library-notice') :
    mobile && document.body.dataset.screen === 'shelf' ? mobile.shelfNotice : notice;
  target.textContent = message;
  target.hidden = !message;
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(error);
    showNotice('本机存储不可用，阅读进度或设置可能无法保存。');
  }
}

function label(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(label).filter(Boolean).join('、');
  if (value && typeof value === 'object') {
    return label(value.name ?? value['zh-CN'] ?? value.zh ?? Object.values(value)[0]);
  }
  return '';
}

function textNote(message) {
  const note = document.createElement('p');
  note.className = 'list-note';
  note.textContent = message;
  return note;
}

const groupOf = book => book.groupId ?? ungrouped;
const groupById = id => groups.find(group => group.id === id);
const filteredBooks = () => shelfGroup === allGroups ? books :
  books.filter(book => groupOf(book) === shelfGroup);

function bookDetails(book) {
  const format = book.file.name.match(bookExtension)?.[1].toUpperCase() ?? 'EPUB';
  return [book.author, format].filter(Boolean).join(' · ');
}

function bookTitle(book) {
  const title = document.createElement('span');
  title.className = 'single-line';
  title.textContent = book.title;
  return title;
}

function renderShelf() {
  if (mobile) {
    mobile.renderShelf(books, groups, shelfGroup, chooseShelfBook, setShelfGroup);
    return;
  }
  shelf.replaceChildren();
  const visible = filteredBooks();
  if (!visible.length) shelf.append(textNote(shelfGroup === allGroups ?
    '书架空着，导入一本书开始阅读。' : '这个分区还没有书。'));
  for (const book of visible) {
    const button = document.createElement('button');
    const detail = document.createElement('span');
    button.type = 'button';
    button.className = 'entry';
    button.title = book.title;
    button.setAttribute('aria-current', String(book.id === activeBook?.id));
    detail.className = 'single-line shelf-book-detail';
    detail.textContent = bookDetails(book);
    button.append(bookTitle(book), detail);
    button.onclick = () => chooseShelfBook(book);
    shelf.append(button);
  }
}

function chooseShelfBook(book) {
  run(async () => {
    const current = books.find(item => item.id === book.id);
    if (!current) return;
    if (current.id !== activeBook?.id || activeDefaultsRevision !== defaultsRevision) await openBook(current);
    else if (mobile) {
      mobile.showReader(current);
      updateSettings();
    }
  }, '无法打开这本书。');
}

function renderGroupOptions() {
  const options = groups.map(({ id, name }) => new Option(name, id));
  for (const id of ['shelf-filter', 'library-filter']) {
    const select = byId(id);
    select.replaceChildren(new Option('全部书籍', allGroups), new Option('未分区', ungrouped),
      ...options.map(option => option.cloneNode(true)));
    select.value = shelfGroup;
  }
  const destination = byId('move-destination');
  const previous = destination.value;
  const placeholder = new Option('移动到…', allGroups);
  placeholder.disabled = true;
  destination.replaceChildren(placeholder, new Option('未分区', ungrouped), ...options);
  destination.value = groupById(previous) || previous === ungrouped ? previous : allGroups;
}

function updateSelection() {
  const total = filteredBooks().length;
  const selectAll = byId('select-all');
  selectAll.disabled = !total;
  selectAll.checked = total > 0 && selectedBooks.size === total;
  selectAll.indeterminate = selectedBooks.size > 0 && !selectAll.checked;
  byId('selection-count').textContent = `已选 ${selectedBooks.size} 本`;
  byId('remove-books').disabled = !selectedBooks.size;
  const destination = byId('move-destination').value;
  byId('move-books').disabled = destination === allGroups ||
    !books.some(book => selectedBooks.has(book.id) && groupOf(book) !== destination);
}

function renderLibraryList() {
  const list = byId('library-list');
  list.replaceChildren();
  const visible = filteredBooks();
  if (!visible.length) list.append(textNote('这个列表还没有书。'));
  for (const book of visible) {
    const row = document.createElement('label');
    row.className = 'library-book';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedBooks.has(book.id);
    checkbox.onchange = () => {
      if (checkbox.checked) selectedBooks.add(book.id);
      else selectedBooks.delete(book.id);
      updateSelection();
    };
    const text = document.createElement('span');
    const title = bookTitle(book);
    title.title = book.title;
    const detail = document.createElement('small');
    detail.className = 'single-line';
    detail.textContent = `${bookDetails(book)} · ${groupById(groupOf(book))?.name ?? '未分区'} · ${book.file.name}`;
    detail.title = detail.textContent;
    text.append(title, detail);
    row.append(checkbox, text);
    list.append(row);
  }
  byId('rename-group').disabled = !groupById(shelfGroup);
  byId('delete-group').disabled = !groupById(shelfGroup);
  updateSelection();
}

function refreshLibrary() {
  renderGroupOptions();
  renderShelf();
  if (libraryDialog.open) renderLibraryList();
}

function setShelfGroup(id) {
  shelfGroup = id;
  selectedBooks.clear();
  writeLocal(shelfGroupKey, id);
  refreshLibrary();
}

async function saveGroup(id, name) {
  const normalized = name.toLocaleLowerCase();
  if (!name || name.length > 24 || ['全部书籍', '未分区'].includes(name) ||
      groups.some(group => group.id !== id && group.name.toLocaleLowerCase() === normalized)) {
    throw new Error('请输入一个未使用的分区名称。');
  }
  const group = { id: id ?? crypto.randomUUID(), name };
  await useStore('groups', 'readwrite', store => store.put(group));
  groups = [...groups.filter(item => item.id !== group.id), group]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  refreshLibrary();
  if (!id) {
    byId('move-destination').value = group.id;
    updateSelection();
  }
}

async function deleteGroup(id) {
  const changes = books.filter(book => groupOf(book) === id)
    .map(book => ({ ...book, groupId: ungrouped }));
  await useLibrary(['groups', 'books'], 'readwrite', transaction => {
    const store = transaction.objectStore('books');
    for (const book of changes) store.put(book);
    transaction.objectStore('groups').delete(id);
  });
  groups = groups.filter(group => group.id !== id);
  books = books.map(book => groupOf(book) === id ? { ...book, groupId: ungrouped } : book);
  setShelfGroup(allGroups);
}

async function moveBooks(ids, destination) {
  if (destination !== ungrouped && !groupById(destination)) return;
  const changes = books.filter(book => ids.has(book.id) && groupOf(book) !== destination)
    .map(book => ({ ...book, groupId: destination }));
  if (!changes.length) return;
  await useStore('books', 'readwrite', store => {
    for (const book of changes) store.put(book);
  });
  const updated = new Map(changes.map(book => [book.id, book]));
  books = books.map(book => updated.get(book.id) ?? book);
  selectedBooks.clear();
  refreshLibrary();
  showNotice(`已移动 ${changes.length} 本书。`);
}

function resetReader() {
  readingTools.setBook();
  const view = activeView;
  activeView = activeBook = undefined;
  desktop?.setBook();
  preferences = defaultPreferences;
  view?.close();
  view?.remove();
  byId('empty').hidden = false;
  byId('book-title').textContent = '阅读室';
  byId('book-title').removeAttribute('title');
  byId('book-author').hidden = true;
  byId('chapter').textContent = '等待打开书籍';
  byId('chapter').removeAttribute('title');
  byId('progress').value = '—';
  byId('previous').disabled = true;
  byId('next').disabled = true;
  tocButtons.clear();
  currentChapter = undefined;
  toc.replaceChildren(textNote('打开一本书后，这里会显示目录。'));
  updateSettings();
  mobile?.showShelf();
}

async function removeBooks(ids) {
  const removed = books.filter(book => ids.has(book.id));
  await useLibrary(['books', 'marks'], 'readwrite', transaction => {
    const store = transaction.objectStore('books');
    const marks = transaction.objectStore('marks');
    for (const book of removed) {
      store.delete(book.id);
      const request = marks.index('bookId').openKeyCursor(book.id);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        marks.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
  });
  books = books.filter(book => !ids.has(book.id));
  if (ids.has(activeBook?.id)) resetReader();
  selectedBooks.clear();
  refreshLibrary();
  try {
    if (ids.has(readLocal(lastBookKey))) localStorage.removeItem(lastBookKey);
    for (const { id } of removed) {
      localStorage.removeItem(progressKey(id));
      localStorage.removeItem(scrollKey(id));
      if (mobile) localStorage.removeItem(bookPreferencesKey(id));
    }
  } catch (error) {
    console.error(error);
    return '书籍已移除，但部分阅读记录无法清理。';
  }
  return `已从书架移除 ${removed.length} 本书。`;
}

let dialogAction;
function confirmAction({ title, description, name, confirm, danger = false }, action) {
  const needsName = name !== undefined;
  byId('action-title').textContent = title;
  byId('action-description').textContent = description;
  byId('group-field').hidden = !needsName;
  const input = byId('group-name');
  input.value = name ?? '';
  input.disabled = !needsName;
  byId('action-notice').hidden = true;
  byId('confirm-action').textContent = confirm;
  byId('confirm-action').className = danger ? 'danger' : 'primary';
  dialogAction = action;
  actionDialog.showModal();
  if (needsName) input.select();
  else byId('cancel-action').focus();
}

function selectTab(tab) {
  if (tab === 'notes' && desktop && activeBook && byId('desktop-book-time')) {
    byId('desktop-book-time').textContent = `本书已读 ${desktop.readingTime(activeBook.id)}`;
  }
  for (const [name, panel] of [['shelf', shelf], ['toc', toc],
    ['search', byId('search-panel')], ['notes', byId('notes-panel')]]) {
    panel.hidden = tab !== name;
    byId(`${name}-tab`).setAttribute('aria-pressed', String(tab === name));
  }
  byId('shelf-tools').hidden = tab !== 'shelf';
  byId('search-form').hidden = tab !== 'search';
}

function showReadingTab(tab) {
  if (mobile) {
    mobile.showReadingTab(tab);
    return;
  }
  byId('sidebar').hidden = false;
  byId('toggle-sidebar').setAttribute('aria-expanded', 'true');
  selectTab(tab);
}

const readingTools = createReadingTools({
  showTab: showReadingTab,
  run,
  notice: showNotice,
  readingTime: id => mobile ? mobile.bookReadingTime(id) : desktop?.readingTime(id),
  afterJump: () => mobile?.closeMenu(),
  putMark: mark => {
    if (!books.some(book => book.id === mark.bookId)) throw new Error('Book no longer exists');
    return useStore('marks', 'readwrite', store => store.put(mark));
  },
  deleteMark: mark => useStore('marks', 'readwrite', store => store.delete(mark.id)),
  confirmDelete: (label, action) => confirmAction({
    title: `删除${label}`, description: '这个阅读标记将从本书的笔记中移除。',
    confirm: '删除', danger: true
  }, action)
});

function renderTOC(items) {
  const list = document.createElement('ul');
  list.className = 'toc-list';
  for (const item of items) {
    const entry = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entry';
    button.textContent = item.label || '未命名章节';
    button.disabled = !item.href;
    button.onclick = () => run(async () => {
      await activeView?.goTo(item.href);
      mobile?.closeMenu();
    }, '无法跳转到该章节。');
    entry.append(button);
    if (item.href) tocButtons.set(item.href, button);
    if (item.subitems?.length) entry.append(renderTOC(item.subitems));
    list.append(entry);
  }
  return list;
}

function updateLocation(location) {
  mobile?.updateLocation(location, activeBook.title);
  if (activeView.isPDF) {
    writeLocal(progressKey(activeBook.id), location.pdf);
    if (document.activeElement !== byId('pdf-page')) byId('pdf-page').value = location.page;
    byId('pdf-total').value = location.total;
    byId('pdf-zoom').value = typeof activeView.zoom === 'string' ? activeView.zoom : 'custom';
    byId('pdf-zoom-percent').value = `${activeView.zoomPercent}%`;
    byId('pdf-zoom-out').disabled = activeView.zoomPercent <= 25;
    byId('pdf-zoom-in').disabled = activeView.zoomPercent >= 400;
    byId('previous').disabled = location.page <= 1;
    byId('next').disabled = location.page >= location.total;
    byId('chapter').textContent = 'PDF';
    byId('chapter').title = activeBook.title;
    return;
  }
  const { cfi, fraction, tocItem } = location;
  if (cfi) {
    writeLocal(progressKey(activeBook.id), cfi);
    const renderer = activeView.renderer;
    if (renderer.scrolled) {
      writeLocal(scrollKey(activeBook.id), { cfi, offset: renderer.start, ...scrollGeometry(renderer) });
    }
  }
  byId('chapter').textContent = tocItem?.label || activeBook.title;
  byId('chapter').title = byId('chapter').textContent;
  byId('progress').textContent = Number.isFinite(fraction)
    ? `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` : '—';
  currentChapter?.removeAttribute('aria-current');
  currentChapter = tocButtons.get(tocItem?.href);
  currentChapter?.setAttribute('aria-current', 'true');
}

function scrollGeometry(renderer) {
  const { width, height } = renderer.getBoundingClientRect();
  return { width, height, extent: renderer.viewSize, fontSize: preferences.size };
}

async function restoreScroll(view, savedScroll, cfi) {
  const renderer = view.renderer;
  if (!renderer.scrolled || !view.lastLocation || savedScroll?.cfi !== cfi ||
      !Number.isFinite(savedScroll?.offset)) return;
  const doc = renderer.getContents()[0]?.doc;
  await doc?.fonts?.ready;
  await new Promise(resolve => requestAnimationFrame(resolve));
  const geometry = scrollGeometry(renderer);
  if (Object.entries(geometry).every(([key, value]) => Math.abs(savedScroll[key] - value) < 1)) {
    await renderer.scrollReadingTo(savedScroll.offset);
  }
}

function applyBookStyle(view, settings = preferences, layout = mobile?.readerLayout) {
  const palette = themes[settings.theme];
  view?.renderer.setStyles?.(`
    html { font-size: ${settings.size}px !important; color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; }
    body { font-size: 1rem !important; color: ${palette.text} !important; background: ${palette.background} !important; }
    a:link, a:visited { color: ${palette.link} !important; }
    p, li, blockquote { line-height: ${layout?.leading ?? settings.leading}; }
  `);
}

function updateSettings() {
  document.documentElement.dataset.theme = preferences.theme;
  byId('theme').value = preferences.theme;
  const fixed = activeView?.isFixedLayout;
  const pdf = activeView?.isPDF;
  const flow = pdf ? (activeView.scrolled ? 'scrolled' : 'paginated') : preferences.flow;
  byId('flow').options[0].textContent = pdf ? '单页翻阅' : '横向分页';
  byId('flow').options[1].textContent = pdf ? '连续滚动' : '纵向滚动';
  byId('flow').value = fixed ? 'paginated' : flow;
  byId('flow').disabled = Boolean(fixed);
  byId('flow').title = fixed ? '固定版式书籍按原版面分页显示' : '切换阅读模式';
  const scrolling = !fixed && !pdf && flow === 'scrolled';
  byId('previous').textContent = scrolling ? '↑ 向上' : '← 上一页';
  byId('next').textContent = scrolling ? '向下 ↓' : '下一页 →';
  delete readingArea.dataset.edge;
  byId('font-control').hidden = Boolean(pdf);
  byId('pdf-tools').hidden = !pdf;
  byId('pdf-page-form').hidden = !pdf;
  byId('progress').hidden = Boolean(pdf);
  byId('font-size').value = preferences.size;
  byId('smaller').disabled = preferences.size <= 14;
  byId('larger').disabled = preferences.size >= 36;
}

function savePreference(name) {
  if (mobile && activeBook) {
    const key = bookPreferencesKey(activeBook.id);
    writeLocal(key, { ...readLocal(key), [name]: preferences[name] });
  } else writeLocal(preferencesKey, preferences);
}

async function changeFlow(flow) {
  if (activeView?.isPDF) {
    activeView.setFlow(flow);
    updateSettings();
    return;
  }
  if (flow === preferences.flow || activeView?.isFixedLayout) return;
  const location = activeView?.lastLocation?.cfi;
  preferences.flow = flow;
  activeView?.renderer.setAttribute('flow', flow);
  if (location) await activeView.goTo(location);
  savePreference('flow');
  updateSettings();
}

async function changeSize(step) {
  const size = Math.min(36, Math.max(14, preferences.size + step));
  if (size === preferences.size) return;
  const location = activeView?.lastLocation?.cfi;
  preferences.size = size;
  savePreference('size');
  updateSettings();
  applyBookStyle(activeView);
  if (location && !activeView.isFixedLayout) await activeView.goTo(location);
}

async function saveBook(record, book) {
  record.title = label(book.metadata?.title) || record.file.name.replace(bookExtension, '');
  record.author = label(book.metadata?.author);
  await useStore('books', 'readwrite', store => store.add(record));
  books.unshift(record);
}

async function addMobileCover(id, book) {
  try {
    // Let the shelf paint the new entry before decoding or rendering its cover.
    await new Promise(resolve => setTimeout(resolve, 0));
    const cover = await makeCover(await book.getCover?.());
    if (!cover) return;
    await run(async () => {
      const record = books.find(item => item.id === id);
      if (!record) return;
      const updated = { ...record, cover };
      await useStore('books', 'readwrite', store => store.put(updated));
      books = books.map(item => item.id === id ? updated : item);
      renderShelf();
    }, '已导入书籍，封面未能保存。', false);
  } catch (error) {
    console.warn('Book cover unavailable', error);
  } finally {
    try { await book.destroy?.(); }
    catch (error) { console.warn('Unable to release book after import', error); }
  }
}

class ImportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
  }
}

async function loadPDFReader() {
  const runtime = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  if (mobile && runtime && Number(runtime) < 125) {
    throw new ImportError(`PDF 阅读需要更新 Android System WebView 或系统浏览器。当前内核版本为 ${runtime}，需要 125 或以上。`);
  }
  try {
    return await import('./pdf-reader.mjs');
  } catch (error) {
    if (!mobile) throw error;
    throw new ImportError('PDF 阅读组件无法启动。请更新 Android System WebView 或系统浏览器后重试。', error);
  }
}

async function importToMobileShelf(record) {
  const { file } = record;
  const isPDF = /\.pdf$/i.test(file.name);
  let book;
  let stage = 'parse';
  try {
    book = isPDF ? await (await loadPDFReader()).inspectPDF(file) :
      await (/\.txt$/i.test(file.name) ? makeTextBook(file) : makeBook(file));
    if (!isPDF && !book.sections.length) throw new Error('Empty book');
    stage = 'save';
    await saveBook(record, book);
  } catch (error) {
    try { await book?.destroy?.(); }
    catch (cleanupError) { console.warn('Unable to release book after import', cleanupError); }
    if (error instanceof ImportError || error?.name === 'PasswordException' || error?.message === 'MOBI_DRM') throw error;
    if (stage === 'save') {
      throw new ImportError('书架保存失败（E03）。请检查应用的本地存储后重试。', error);
    }
    const runtime = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1];
    const hint = error?.name === 'TypeError' && runtime ? `当前 WebView 版本为 ${runtime}。` : '';
    throw new ImportError(`无法解析这本书（E02）。请确认文件格式和完整性。${hint}`, error);
  }
  void addMobileCover(record.id, book);
}

async function openBook(record, isNew = false) {
  const nextPreferences = mobile ? readPreferences(readLocal(bookPreferencesKey(record.id)), defaultPreferences) : preferences;
  const nextLayout = mobile?.layoutFor(record.id);
  const revision = defaultsRevision;
  const isPDF = /\.pdf$/i.test(record.file.name);
  if (isPDF) await loadPDFReader();
  const view = document.createElement(isPDF ? 'leaf-pdf-view' : 'foliate-view');
  view.dataset.staging = '';
  view.addEventListener('external-link', event => event.preventDefault());
  view.addEventListener('pageerror', () => {
    if (activeView === view) showNotice('此 PDF 页面无法渲染，可以尝试跳到其他页。');
  });
  view.addEventListener('load', ({ detail: { doc, index } }) => {
    doc.addEventListener('keydown', handleKeys);
    bindDrop(doc);
    bindReadingInput(doc, view);
    readingTools.bindDocument(view, doc, index);
    mobile?.bindTouch(doc, view, interactiveContent);
  });
  readingArea.append(view);
  let appliedTheme;
  let marks;
  try {
    const lastLocation = readLocal(progressKey(record.id));
    if (isPDF) {
      await view.open(record.file, lastLocation);
    } else {
      const book = /\.txt$/i.test(record.file.name) ? await makeTextBook(record.file) : record.file;
      await view.open(book);
      if (!view.book.sections.length) throw new Error('Empty book');
      if (!view.isFixedLayout) view.renderer.setAttribute('flow', nextPreferences.flow);
      if (mobile && !view.isFixedLayout) {
        view.renderer.setAttribute('gap', nextLayout.gap);
        view.renderer.setAttribute('data-mobile-curl', '');
      }
      applyBookStyle(view, nextPreferences, nextLayout);
      appliedTheme = nextPreferences.theme;
      try {
        await view.init({ lastLocation, showTextStart: true });
      } catch (error) {
        if (!lastLocation) throw error;
        await view.init({ showTextStart: true });
      }
      if (!view.lastLocation) throw new Error('Could not render book content');
      if (lastLocation) await restoreScroll(view, readLocal(scrollKey(record.id)), lastLocation);
    }
    if (isNew) await saveBook(record, view.book);
    marks = isNew ? [] : await useStore('marks', 'readonly', store => store.index('bookId').getAll(record.id));
  } catch (error) {
    try { view.close(); }
    finally { view.remove(); }
    throw error;
  }
  activeView?.close();
  activeView?.remove();
  activeView = view;
  activeBook = record;
  preferences = nextPreferences;
  activeDefaultsRevision = revision;
  mobile?.showReader(record);
  desktop?.setBook(record);
  readingTools.setBook(view, record.id, marks, record.title);
  updateSettings();
  if (!isPDF && appliedTheme !== preferences.theme) applyBookStyle(view);
  delete view.dataset.staging;
  byId('empty').hidden = true;
  byId('book-title').textContent = record.title;
  byId('book-title').title = record.title;
  byId('book-author').textContent = record.author;
  byId('book-author').hidden = !record.author;
  byId('previous').disabled = false;
  byId('next').disabled = false;
  tocButtons = new Map();
  const items = view.book.toc;
  toc.replaceChildren(items?.length ? renderTOC(items) : textNote('这本书没有目录。'));
  refreshLibrary();
  view.addEventListener('relocate', event => {
    if (view === activeView) updateLocation(event.detail);
  });
  writeLocal(lastBookKey, record.id);
  updateLocation(view.lastLocation);
}

async function importBook(file) {
  if (!bookExtension.test(file.name)) {
    showNotice('请选择 EPUB、TXT、MOBI、AZW3 或 PDF 文件。');
    return;
  }
  const groupId = groupById(shelfGroup)?.id ?? ungrouped;
  if (mobile) showNotice('正在导入书籍…');
  let id;
  try {
    const bytes = await file.arrayBuffer();
    if (mobile && !bytes.byteLength) throw new Error('Empty file');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (mobile && !books.some(book => book.id === id)) {
      // Use our own copy for parsing and IndexedDB instead of reopening the file provider.
      file = new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
    }
  } catch (error) {
    if (!mobile) throw error;
    throw new ImportError('无法读取所选文件（E01）。请先将完整文件保存到手机的「下载」目录，再从那里导入。', error);
  }
  const existing = books.find(book => book.id === id);
  if (mobile) {
    if (!existing) await importToMobileShelf({ id, file, groupId, importedAt: Date.now() });
    mobile.showShelf();
    if (existing && shelfGroup !== allGroups && groupOf(existing) !== shelfGroup) setShelfGroup(groupOf(existing));
    else refreshLibrary();
    showNotice(existing ? '这本书已在书架中。' : '已加入书架。');
    return;
  }
  if (activeBook?.id !== id) {
    await openBook(existing ?? { id, file, groupId, importedAt: Date.now() }, !existing);
  }
  if (existing && shelfGroup !== allGroups && groupOf(existing) !== shelfGroup) setShelfGroup(groupOf(existing));
  selectTab('shelf');
}

function run(operation, errorMessage, clearNotice = true) {
  pending++;
  operationQueue = operationQueue.then(async () => {
    if (clearNotice) showNotice('');
    try {
      await operation();
    } catch (error) {
      console.error(error);
      const message = error instanceof ImportError ? error.message :
        error?.message === 'MOBI_DRM' ? '这本 Kindle 书有 DRM，无法在一页中打开。' :
        error?.name === 'PasswordException' ? '这个 PDF 需要打开密码。请导入可直接打开的版本。' : errorMessage;
      showNotice(message);
    } finally {
      pending--;
    }
  });
  return operationQueue;
}

const chooseFile = () => {
  if (!pending && !libraryDialog.open && !actionDialog.open && !byId('note-dialog').open) fileInput.click();
};
const openFile = file => {
  if (file) run(() => importBook(file), '导入失败。请确认书籍文件完整，且本机有可用存储空间。');
};
const turnPage = (method, gesture) => run(() => {
  readingTools.clearSelection();
  const view = activeView;
  if (!view) return;
  const turn = () => view[method]();
  return mobile ? mobile.animateTurn(view, method, turn, gesture) : turn();
}, '无法翻页。');
const scrollReading = distance => {
  if (!pending && activeView?.renderer.scrolled) {
    run(() => activeView.renderer.scrollReadingBy(distance), '无法滚动正文。');
  }
};

function handleKeys(event) {
  if (event.defaultPrevented || event.isComposing || libraryDialog.open || actionDialog.open ||
      byId('note-dialog').open || byId('lookup-dialog').open || byId('mark-style-dialog').open ||
      byId('desktop-settings')?.open) return;
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    readingTools.openSearch();
  } else if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    chooseFile();
  } else if (activeView && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      !event.target.closest?.(interactiveContent)) {
    const scrolling = activeView.renderer.scrolled;
    const keys = scrolling ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (scrolling) scrollReading(event.key === 'ArrowDown' ? 72 : -72);
    else if (!event.repeat || !pending) turnPage(event.key === 'ArrowRight' ? 'goRight' : 'goLeft');
  }
}

function bindReadingInput(target, view) {
  const bookDocument = target.nodeType === Node.DOCUMENT_NODE ? target : null;
  const eventView = () => view ?? activeView;
  const edgeAt = event => {
    if (!activeView || eventView() !== activeView || activeView.renderer.scrolled ||
        event.target.closest?.(interactiveContent) || event.pointerType !== 'mouse') return;
    const bounds = readingArea.getBoundingClientRect();
    const frameOffset = bookDocument?.defaultView?.frameElement?.getBoundingClientRect().left ?? 0;
    const x = event.clientX + frameOffset - bounds.left;
    const edgeWidth = Math.min(64, bounds.width * .1);
    if (x >= 0 && x < edgeWidth) return 'left';
    if (x <= bounds.width && x > bounds.width - edgeWidth) return 'right';
  };
  let press;
  target.addEventListener('pointermove', event => {
    const edge = edgeAt(event);
    if (edge) readingArea.dataset.edge = edge;
    else delete readingArea.dataset.edge;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press = undefined;
  });
  target.addEventListener('pointerdown', event => {
    press = event.button === 0 && { x: event.clientX, y: event.clientY, edge: edgeAt(event) };
  });
  target.addEventListener('pointerleave', () => {
    delete readingArea.dataset.edge;
    press = undefined;
  });
  target.addEventListener('pointercancel', () => { press = undefined; });
  target.addEventListener('click', event => {
    const start = press;
    press = undefined;
    const edge = edgeAt(event);
    if (!edge || start?.edge !== edge || event.defaultPrevented || event.detail !== 1 ||
        event.ctrlKey || event.shiftKey || event.altKey || event.metaKey ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const selection = (bookDocument ?? activeView.renderer.getContents?.()[0]?.doc ?? document).getSelection();
    if (selection && !selection.isCollapsed) return;
    turnPage(edge === 'right' ? 'goRight' : 'goLeft');
  });
  target.addEventListener('wheel', event => {
    if (eventView() !== activeView || activeView?.isPDF || !activeView?.renderer.scrolled || event.ctrlKey ||
        event.defaultPrevented || !event.deltaY) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? activeView.renderer.size : 1;
    scrollReading(event.deltaY * unit);
  }, { passive: false });
}

function bindDrop(target) {
  target.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    const unavailable = pending || libraryDialog.open || actionDialog.open || byId('note-dialog').open;
    event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy';
    byId('drop-overlay').hidden = Boolean(unavailable);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => { byId('drop-overlay').hidden = true; }, 160);
  });
  target.addEventListener('drop', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    clearTimeout(dragTimer);
    byId('drop-overlay').hidden = true;
    if (pending || libraryDialog.open || actionDialog.open || byId('note-dialog').open) return;
    if (event.dataTransfer.files.length > 1) {
      showNotice('请一次导入一本书。');
      return;
    }
    openFile(event.dataTransfer.files[0]);
  });
}

byId('import').onclick = chooseFile;
byId('empty-import').onclick = chooseFile;
fileInput.onchange = () => {
  openFile(fileInput.files[0]);
  fileInput.value = '';
};
for (const tab of ['shelf', 'toc', 'search', 'notes']) {
  byId(`${tab}-tab`).onclick = () => selectTab(tab);
}
for (const id of ['shelf-filter', 'library-filter']) {
  byId(id).onchange = event => setShelfGroup(event.currentTarget.value);
}
byId('manage-shelf').onclick = () => {
  if (pending) return;
  selectedBooks.clear();
  byId('library-notice').hidden = true;
  byId('move-destination').value = allGroups;
  renderLibraryList();
  libraryDialog.showModal();
};
byId('close-library').onclick = () => libraryDialog.close();
byId('new-group').onclick = () => confirmAction({
  title: '新建分区', description: '可以按题材、阅读计划或自己的习惯整理书籍。',
  name: '', confirm: '创建'
}, name => saveGroup(null, name));
byId('rename-group').onclick = () => {
  const group = groupById(shelfGroup);
  if (group) confirmAction({
    title: '重命名分区', description: '修改分区在书架上显示的名称。',
    name: group.name, confirm: '保存'
  }, name => saveGroup(group.id, name));
};
byId('delete-group').onclick = () => {
  const group = groupById(shelfGroup);
  if (group) confirmAction({
    title: '删除分区', description: `「${group.name}」中的书籍会移到「未分区」。`,
    confirm: '删除分区', danger: true
  }, () => deleteGroup(group.id));
};
byId('select-all').onchange = event => {
  selectedBooks.clear();
  if (event.currentTarget.checked) {
    for (const book of filteredBooks()) selectedBooks.add(book.id);
  }
  for (const checkbox of byId('library-list').querySelectorAll('input')) {
    checkbox.checked = event.currentTarget.checked;
  }
  updateSelection();
};
byId('move-destination').onchange = updateSelection;
byId('move-books').onclick = () => {
  const ids = new Set(selectedBooks);
  const destination = byId('move-destination').value;
  run(() => moveBooks(ids, destination), '无法移动所选书籍。');
};
function confirmRemoveBooks(ids) {
  if (pending || !ids.size) return;
  confirmAction({
    title: `移除 ${ids.size} 本书`, description: '将清理应用内的书籍副本和阅读记录。原始文件会保留。',
    confirm: '移除书籍', danger: true
  }, async () => {
    await removeBooks(ids);
    mobile?.exitShelfSelection();
  });
}
byId('remove-books').onclick = () => confirmRemoveBooks(new Set(selectedBooks));
byId('cancel-action').onclick = () => actionDialog.close();
actionDialog.addEventListener('cancel', event => {
  if (byId('confirm-action').disabled) event.preventDefault();
});
byId('action-form').onsubmit = event => {
  event.preventDefault();
  const confirm = byId('confirm-action');
  if (confirm.disabled) return;
  const cancel = byId('cancel-action');
  const input = byId('group-name');
  const name = input.value.trim();
  if (!input.disabled && !name) {
    showNotice('请输入分区名称。');
    input.focus();
    return;
  }
  confirm.disabled = cancel.disabled = true;
  const action = dialogAction;
  run(async () => {
    const message = await action(name);
    actionDialog.close();
    if (message) showNotice(message);
  }, input.disabled ? '操作未完成，请重试。' : '无法保存分区，请检查名称是否已使用。')
    .finally(() => { confirm.disabled = cancel.disabled = false; });
};
byId('toggle-sidebar').onclick = event => {
  const sidebar = byId('sidebar');
  sidebar.hidden = !sidebar.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!sidebar.hidden));
};
byId('previous').onclick = () => turnPage('prev');
byId('next').onclick = () => turnPage('next');
byId('smaller').onclick = () => run(() => changeSize(-2), '无法调整字号。');
byId('larger').onclick = () => run(() => changeSize(2), '无法调整字号。');
byId('flow').onchange = event => {
  const flow = event.currentTarget.value;
  run(() => changeFlow(flow), '无法切换阅读模式。');
};
byId('pdf-zoom').onchange = event => {
  const zoom = event.currentTarget.value;
  run(() => activeView?.setZoom?.(zoom), '无法调整 PDF 缩放。');
};
byId('pdf-zoom-out').onclick = () => run(() => activeView?.stepZoom?.(-1), '无法缩小 PDF。');
byId('pdf-zoom-in').onclick = () => run(() => activeView?.stepZoom?.(1), '无法放大 PDF。');
byId('pdf-page').onblur = event => {
  if (activeView?.isPDF) event.currentTarget.value = activeView.page;
};
byId('pdf-page-form').onsubmit = event => {
  event.preventDefault();
  if (!activeView?.isPDF) return;
  const input = byId('pdf-page');
  const page = Number(input.value.trim());
  if (!Number.isInteger(page) || page < 1 || page > activeView.pageCount) {
    showNotice(`请输入 1 到 ${activeView.pageCount} 之间的页码。`);
    input.select();
    return;
  }
  input.blur();
  run(() => activeView?.goToPage?.(page), '无法跳转到该页。');
};
byId('theme').onchange = event => {
  preferences.theme = event.currentTarget.value;
  savePreference('theme');
  updateSettings();
  applyBookStyle(activeView);
};
document.addEventListener('keydown', handleKeys);
bindDrop(document);
bindReadingInput(readingArea);
if (document.body.hasAttribute('data-mobile')) {
  const { createMobile, coverThumbnail } = await import('./mobile.mjs');
  makeCover = coverThumbnail;
  mobile = createMobile({
    selectTab,
    turnPage,
    clearSelection: readingTools.clearSelection,
    readLocal,
    writeLocal,
    defaultPreferences,
    saveDefaults: (values, layoutChanged) => {
      const next = readPreferences(values, defaultPreferences);
      if (layoutChanged || Object.keys(next).some(key => next[key] !== defaultPreferences[key])) defaultsRevision++;
      Object.assign(defaultPreferences, next);
      writeLocal(preferencesKey, defaultPreferences);
    },
    canManageShelf: () => !pending,
    moveSelection: (ids, destination) => {
      if (pending) return;
      run(async () => {
        await moveBooks(ids, destination);
        mobile.exitShelfSelection();
      }, '无法移动所选书籍。');
    },
    removeSelection: confirmRemoveBooks,
    getView: () => activeView,
    goToProgress: fraction => run(async () => {
      const view = activeView;
      if (view?.isPDF) await view.goToPage(Math.round(fraction * (view.pageCount - 1)) + 1);
      else if (view?.getSectionFractions().length) await view.goToFraction(Math.min(.99999, fraction));
      mobile.closeMenu();
    }, '无法跳转到该进度。'),
    changeLayout: () => run(async () => {
      const view = activeView;
      if (!view || view.isPDF || view.isFixedLayout) return;
      const cfi = view.lastLocation?.cfi;
      applyBookStyle(view);
      view.renderer.setAttribute('gap', mobile.readerLayout.gap);
      if (cfi) await view.goTo(cfi);
    }, '无法调整阅读排版。')
  });
  mobile.bindTouch(readingArea, null, interactiveContent);
} else {
  const { createDesktopSettings } = await import('./desktop-settings.mjs');
  desktop = createDesktopSettings({
    readLocal, writeLocal, getPreferences: () => preferences,
    applyPreferences: settings => run(async () => {
      const location = activeView?.lastLocation?.cfi;
      Object.assign(preferences, readPreferences(settings, preferences));
      writeLocal(preferencesKey, preferences);
      updateSettings();
      if (activeView && !activeView.isPDF && !activeView.isFixedLayout) {
        activeView.renderer.setAttribute('flow', preferences.flow);
        applyBookStyle(activeView);
        if (location) await activeView.goTo(location);
      }
    }, '无法应用阅读设置。')
  });
}
updateSettings();
toc.append(textNote('打开一本书后，这里会显示目录。'));
await run(async () => {
  [books, groups] = await Promise.all([
    useStore('books', 'readonly', store => store.getAll()),
    useStore('groups', 'readonly', store => store.getAll())
  ]);
  books.sort((first, second) => second.importedAt - first.importedAt);
  groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const savedGroup = readLocal(shelfGroupKey);
  shelfGroup = savedGroup === ungrouped || groupById(savedGroup) ? savedGroup : allGroups;
  refreshLibrary();
  const lastBook = books.find(book => book.id === readLocal(lastBookKey));
  if (lastBook && !mobile) await openBook(lastBook);
}, '无法恢复本地书库或上次阅读的书。');
if (mobile) document.body.dataset.readerReady = 'true';
