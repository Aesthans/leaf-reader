import { createReadingClock, formatReadingTime } from './reading-clock.mjs';

const byId = id => document.getElementById(id);
const body = document.body;
const glyphs = {
  back: '<path d="M14 5 7 12l7 7"/>',
  toc: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  notes: '<path d="M5 19c6 0 13-4 14-14-10 1-14 8-14 14Zm0 0 7-7"/>',
  progress: '<circle cx="12" cy="12" r="4"/><path d="M2 12h4m12 0h4"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2m10-10 2-2"/>',
  layout: '<path d="m4 19 7-14 7 14M7 14h8m4 5h2"/>',
  bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
  underline: '<path d="m6 16 6-12 6 12M8 12h8M5 20h14"/>',
  thought: '<path d="M5 5h14v11h-7l-4 4v-4H5zM8 9h8M8 12h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  settings: '<path d="m10 3-.6 2.4-2 .9L5 5.5 3 9l1.8 1.7v2.6L3 15l2 3.5 2.4-.8 2 .9.6 2.4h4l.6-2.4 2-.9 2.4.8 2-3.5-1.8-1.7v-2.6L21 9l-2-3.5-2.4.8-2-.9L14 3z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
const titleText = (text, cssClass) => {
  const element = document.createElement('span');
  element.className = cssClass;
  element.textContent = text;
  return element;
};

export async function coverThumbnail(source) {
  if (!source) return;
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 240 / image.naturalWidth, 340 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createMobile({ selectTab, turnPage, clearSelection, getView, goToProgress, changeLayout,
  canManageShelf, moveSelection, removeSelection, readLocal, writeLocal, defaultPreferences, saveDefaults }) {
  const sidebar = byId('sidebar');
  const shelf = byId('shelf');
  const reading = byId('reading-area');
  const root = document.documentElement;
  const clock = createReadingClock(readLocal('leaf.reading-time'), value => writeLocal('leaf.reading-time', value));
  const bookReadingTime = id => formatReadingTime(clock.forBook(id));
  const wideNotes = matchMedia('(min-width: 720px)');
  const sideNotes = matchMedia('(min-width: 640px)');
  const placementKey = 'leaf.notes-placement';
  let notesPlacement = readLocal(placementKey);
  if (!['auto', 'bottom', 'side'].includes(notesPlacement)) notesPlacement = 'auto';
  let readingBook;
  byId('highlight-selection').innerHTML = `${icon('underline')}<span id="selection-mark-label">划线</span>`;
  byId('highlight-selection').setAttribute('aria-expanded', 'false');
  byId('note-selection').innerHTML = `${icon('thought')}<span>写想法</span>`;
  byId('lookup-selection').innerHTML = `${icon('search')}<span>查词</span>`;
  byId('note-text').placeholder = '记下此刻的想法';
  const curl = document.createElement('div');
  curl.className = 'mobile-curl';
  curl.hidden = true;
  curl.setAttribute('aria-hidden', 'true');
  curl.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs>
      <linearGradient id="leaf-curl-paper" gradientUnits="userSpaceOnUse" x1="24" x2="40" y1="-3.2" y2="0">
        <stop stop-color="#000" stop-opacity=".24"/><stop offset=".22" stop-color="#fff" stop-opacity=".12"/>
        <stop offset=".62" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity=".32"/>
      </linearGradient>
      <linearGradient id="leaf-curl-shadow" gradientUnits="userSpaceOnUse" x1="40" x2="53" y1="0" y2="2.6">
        <stop stop-opacity=".36"/><stop offset="1" stop-opacity="0"/>
      </linearGradient>
      <path id="leaf-curl-edge" d="M40 0 20 100 Q17 100 15 98 L2 94 23 5 Q32 1 40 0Z"/>
    </defs>
    <g>
      <path d="M40 0H54L34 100H20Z" fill="url(#leaf-curl-shadow)"/>
      <use href="#leaf-curl-edge" fill="var(--page)"/>
      <use href="#leaf-curl-edge" fill="url(#leaf-curl-paper)"/>
    </g>
  </svg>`;
  const paperFold = curl.querySelector('g');
  reading.append(curl);
  const tools = byId('shelf-tools');
  const importButton = byId('import');
  const workspace = document.querySelector('.workspace');
  const header = document.createElement('div');
  header.className = 'mobile-shelf-heading';
  header.innerHTML = `<div><p><img src="assets/icon.svg" alt=""> 一页 · 本地阅读</p><h1>书架</h1></div><div class="mobile-shelf-header-actions"><span id="mobile-shelf-count"></span><button id="mobile-select-shelf" type="button">选择</button><button id="open-mobile-settings" type="button" aria-label="设置">${icon('settings')}</button></div>`;
  sidebar.prepend(header);
  const settingsDialog = document.createElement('dialog');
  settingsDialog.id = 'mobile-settings';
  settingsDialog.className = 'action-dialog mobile-settings';
  settingsDialog.setAttribute('aria-labelledby', 'mobile-settings-title');
  settingsDialog.innerHTML = `<form id="mobile-settings-form">
    <header class="dialog-header"><h2 id="mobile-settings-title">设置</h2><button id="close-mobile-settings" type="button" aria-label="关闭设置">✕</button></header>
    <section aria-labelledby="reading-settings-title">
      <h3 id="reading-settings-title">阅读设置</h3>
      <label>默认主题<select name="theme"><option value="paper">白纸</option><option value="sepia">暖纸</option><option value="dark">夜间</option></select></label>
      <label>默认字号 <output id="settings-size" for="settings-font-size"></output><input id="settings-font-size" name="size" type="range" min="14" max="36"></label>
      <label>默认行距<select name="leading"><option value="1.45">紧凑</option><option value="1.75">标准</option><option value="2">舒展</option></select></label>
      <label>电子书翻页<select name="flow"><option value="paginated">横向分页</option><option value="scrolled">纵向滚动</option></select></label>
      <label>笔记位置<select name="placement"><option value="auto">自动</option><option value="bottom">底部</option><option value="side">侧边</option></select></label>
      <small>屏幕空间不足时，笔记会显示在底部。书内单独调整的排版会随该书保存。</small>
    </section>
    <section aria-labelledby="reading-stats-title">
      <h3 id="reading-stats-title">阅读统计</h3>
      <div class="mobile-time-row"><span>本机累计阅读</span><strong id="mobile-total-time"></strong></div>
    </section>
    <button class="primary" type="submit">保存设置</button>
  </form>`;
  body.append(settingsDialog);
  const selectionHeader = document.createElement('header');
  selectionHeader.className = 'mobile-shelf-selection';
  selectionHeader.hidden = true;
  selectionHeader.innerHTML = `<button id="mobile-select-all" type="button">全选</button>
    <div><strong>选择书籍</strong><span id="mobile-selected-count" role="status"></span></div>
    <button id="mobile-cancel-selection" type="button">取消</button>`;
  header.after(selectionHeader);
  const selectionActions = document.createElement('footer');
  selectionActions.className = 'mobile-shelf-actions';
  selectionActions.hidden = true;
  selectionActions.innerHTML = `<select id="mobile-move-selection" aria-label="移动到分区"></select>
    <button id="mobile-remove-selection" class="danger" type="button">移出书架</button>`;
  sidebar.append(selectionActions);
  const selectShelf = byId('mobile-select-shelf');
  const selectAll = byId('mobile-select-all');
  const moveTo = byId('mobile-move-selection');
  const remove = byId('mobile-remove-selection');
  const selected = new Set();
  const shelfTiles = new Map();
  let selectable = [];
  let selecting = false;
  const sheetClose = document.createElement('button');
  sheetClose.className = 'mobile-sheet-close';
  sheetClose.type = 'button';
  sheetClose.setAttribute('aria-label', '关闭面板');
  sidebar.prepend(sheetClose);
  tools.append(importButton);
  importButton.textContent = '＋ 导入';
  const shelfNotice = document.createElement('p');
  shelfNotice.className = 'list-note mobile-shelf-notice';
  shelfNotice.hidden = true;
  shelfNotice.setAttribute('role', 'status');
  tools.after(shelfNotice);

  const overlays = document.createElement('div');
  overlays.className = 'mobile-overlays';
  overlays.innerHTML = `
    <div class="mobile-reading-caption" aria-hidden="true">
      <span id="mobile-chapter" class="single-line"></span><span id="mobile-position"></span>
    </div>
    <header class="mobile-reader-top">
      <button id="mobile-back" aria-label="返回书架">${icon('back')}</button>
      <strong id="mobile-title" class="single-line"></strong>
      <button id="mobile-add-mark" aria-label="添加书签">${icon('bookmark')}</button>
    </header>
    <section class="mobile-bottom-panel" id="mobile-progress-panel" hidden aria-label="阅读进度">
      <div class="mobile-panel-heading"><strong>阅读进度</strong><span id="mobile-progress-label"></span></div>
      <div class="mobile-segments"><button id="mobile-prev">上一页</button>
        <input id="mobile-seek" type="range" min="0" max="1000" value="0" aria-label="全书进度">
        <button id="mobile-next">下一页</button></div>
      <div id="mobile-pdf-jump"></div>
    </section>
    <section class="mobile-bottom-panel" id="mobile-theme-panel" hidden aria-label="阅读主题">
      <div class="mobile-panel-heading"><strong>纸张颜色</strong></div>
      <div class="mobile-theme-choices">
        <button data-paper="paper">白纸</button><button data-paper="sepia">暖纸</button><button data-paper="dark">夜间</button>
      </div>
    </section>
    <section class="mobile-bottom-panel" id="mobile-layout-panel" hidden aria-label="阅读排版">
      <div class="mobile-panel-heading"><strong>阅读排版</strong></div>
      <div class="mobile-layout-main" id="mobile-layout-main"></div>
      <div class="mobile-layout-spacings" id="mobile-layout-spacings">
        <label>页边距<select id="mobile-gap"><option value="3%">窄</option><option value="6%">标准</option><option value="9%">宽</option></select></label>
        <label>行距<select id="mobile-leading"><option value="1.45">紧凑</option><option value="1.75">标准</option><option value="2">舒展</option></select></label>
      </div>
    </section>
    <nav class="mobile-reader-nav" aria-label="阅读工具">${[
      ['toc', '目录'], ['notes', '笔记'], ['progress', '进度'], ['theme', '主题'], ['layout', '排版']
    ].map(([key, label]) => `<button data-panel="${key}" type="button" aria-pressed="false">${icon(key)}<span>${label}</span></button>`).join('')}</nav>`;
  workspace.append(overlays);
  const layout = byId('mobile-layout-main');
  for (const id of ['flow', 'font-control', 'pdf-tools']) layout.append(byId(id));
  byId('mobile-pdf-jump').append(byId('pdf-page-form'));
  const seek = byId('mobile-seek');
  const theme = byId('theme');
  const sheetTabs = ['toc', 'search', 'notes'];
  const panels = ['progress', 'theme', 'layout'];
  let urls = [];
  let panel;
  let isReader = false;
  let position = '';
  let chapter = '';
  let turning = false;
  let dragTurn;

  const layoutKey = 'leaf.mobile-layout';
  const bookLayoutKey = id => `leaf.book-layout.${id}`;
  function normalizeLayout(values, fallback) {
    return {
      gap: ['3%', '6%', '9%'].includes(values?.gap) ? values.gap : fallback.gap,
      leading: [1.45, 1.75, 2].includes(values?.leading) ? values.leading : fallback.leading
    };
  }
  const defaultLayout = normalizeLayout(readLocal(layoutKey), { gap: '6%', leading: 1.75 });
  const readerLayout = { ...defaultLayout };
  const layoutFor = id => normalizeLayout(readLocal(bookLayoutKey(id)), defaultLayout);
  for (const key of ['gap', 'leading']) byId(`mobile-${key}`).onchange = event => {
    if (!readingBook) return;
    const value = key === 'leading' ? Number(event.currentTarget.value) : event.currentTarget.value;
    readerLayout[key] = value;
    const storageKey = bookLayoutKey(readingBook.id);
    writeLocal(storageKey, { ...readLocal(storageKey), [key]: value });
    changeLayout();
  };

  function updateNotesPlacement() {
    body.toggleAttribute('data-mobile-notes-side', isReader && panel === 'notes' &&
      (notesPlacement === 'side' ? sideNotes.matches : notesPlacement === 'auto' && wideNotes.matches));
  }
  wideNotes.addEventListener('change', updateNotesPlacement);
  sideNotes.addEventListener('change', updateNotesPlacement);

  const settingsForm = byId('mobile-settings-form');
  const settingsControls = settingsForm.elements;
  const showDefaultSize = () => { byId('settings-size').value = settingsControls.namedItem('size').value; };
  byId('settings-font-size').oninput = showDefaultSize;
  byId('open-mobile-settings').onclick = () => {
    for (const [key, value] of Object.entries({ ...defaultPreferences, leading: defaultLayout.leading, placement: notesPlacement })) {
      settingsControls.namedItem(key).value = value;
    }
    showDefaultSize();
    byId('mobile-total-time').textContent = formatReadingTime(clock.total());
    settingsDialog.showModal();
  };
  byId('close-mobile-settings').onclick = () => settingsDialog.close();
  settingsForm.onsubmit = event => {
    event.preventDefault();
    const values = new FormData(settingsForm);
    const next = normalizeLayout({ leading: Number(values.get('leading')) }, defaultLayout);
    const layoutChanged = next.leading !== defaultLayout.leading;
    Object.assign(defaultLayout, next);
    writeLocal(layoutKey, defaultLayout);
    notesPlacement = values.get('placement');
    writeLocal(placementKey, notesPlacement);
    saveDefaults({ theme: values.get('theme'), size: Number(values.get('size')), flow: values.get('flow') }, layoutChanged);
    root.dataset.theme = defaultPreferences.theme;
    settingsDialog.close();
  };

  function showPanel(next) {
    if (!turning) clearDrag();
    panel = next;
    const sheet = isReader && sheetTabs.includes(next);
    sidebar.hidden = isReader && !sheet;
    body.toggleAttribute('data-mobile-menu', isReader && next !== undefined);
    body.toggleAttribute('data-mobile-sheet', sheet);
    updateNotesPlacement();
    if (sheet) selectTab(next);
    const bookTime = byId('mobile-book-time');
    if (next === 'notes' && readingBook && bookTime) bookTime.textContent = `本书已读 ${bookReadingTime(readingBook.id)}`;
    for (const key of panels) byId(`mobile-${key}-panel`).hidden = !isReader || key !== next;
    for (const button of overlays.querySelectorAll('[data-panel]')) {
      const value = next === 'search' ? 'toc' : next;
      button.setAttribute('aria-pressed', String(button.dataset.panel === value));
    }
    if (next === 'theme') syncTheme();
  }

  function closeMenu() { showPanel(undefined); }

  function showShelf() {
    exitShelfSelection();
    clearSelection();
    isReader = false;
    readingBook = undefined;
    clock.setBook();
    body.dataset.screen = 'shelf';
    root.dataset.theme = defaultPreferences.theme;
    closeMenu();
    selectTab('shelf');
  }

  function showReader(record) {
    exitShelfSelection();
    isReader = true;
    readingBook = record;
    Object.assign(readerLayout, layoutFor(record.id));
    byId('mobile-gap').value = readerLayout.gap;
    byId('mobile-leading').value = readerLayout.leading;
    clock.setBook(record.id);
    body.dataset.screen = 'reader';
    byId('mobile-title').textContent = record.title;
    byId('mobile-layout-spacings').hidden = Boolean(getView()?.isPDF || getView()?.isFixedLayout);
    closeMenu();
  }

  function showReadingTab(tab) {
    if (isReader) showPanel(tab);
    else selectTab(tab);
  }

  function syncTheme() {
    for (const button of overlays.querySelectorAll('[data-paper]')) {
      button.setAttribute('aria-pressed', String(button.dataset.paper === theme.value));
    }
  }

  function showPosition() {
    byId('mobile-position').textContent = position;
    byId('mobile-chapter').textContent = chapter;
    byId('mobile-progress-label').textContent = position;
  }

  function updateLocation(location, title) {
    if (location.pdf) {
      position = `${location.page} / ${location.total}`;
      chapter = title;
      if (document.activeElement !== seek) {
        seek.value = location.total > 1 ? (location.page - 1) * 1000 / (location.total - 1) : 0;
      }
    } else {
      const fraction = Number.isFinite(location.fraction) ? location.fraction : 0;
      position = `${Math.round(fraction * 100)}%`;
      chapter = location.tocItem?.label || title;
      if (document.activeElement !== seek) seek.value = fraction * 1000;
    }
    showPosition();
  }

  function cover(book, mini = false) {
    const card = document.createElement('span');
    card.className = `mobile-cover${mini ? ' mini-cover' : ''}`;
    if (book.cover) {
      card.classList.add('has-cover');
      const image = document.createElement('img');
      image.alt = '';
      const url = URL.createObjectURL(book.cover);
      urls.push(url);
      image.src = url;
      card.append(image);
    } else {
      const palette = parseInt(book.id.slice(0, 2), 16) % 4;
      card.dataset.palette = palette;
      card.append(titleText(book.title, 'mobile-cover-name'));
      if (!mini) card.append(titleText(book.author || '一页', 'mobile-cover-author'));
    }
    return card;
  }

  function updateShelfSelection() {
    body.toggleAttribute('data-shelf-selection', selecting);
    selectionHeader.hidden = selectionActions.hidden = !selecting;
    selectShelf.disabled = !selectable.length;
    byId('mobile-selected-count').textContent = `已选 ${selected.size} 本`;
    selectAll.textContent = selected.size === selectable.length && selectable.length ? '取消全选' : '全选';
    selectAll.disabled = !selectable.length;
    const chosen = selected.size ? selectable.filter(book => selected.has(book.id)) : [];
    for (const option of Array.from(moveTo.options).slice(1)) {
      option.disabled = !chosen.some(book => (book.groupId || '') !== option.value);
    }
    moveTo.disabled = remove.disabled = !selected.size;
    for (const [tile, ids] of shelfTiles) {
      tile.disabled = selecting && !ids.length;
      if (!selecting) {
        tile.removeAttribute('aria-pressed');
        continue;
      }
      const count = ids.filter(id => selected.has(id)).length;
      tile.setAttribute('aria-pressed', count ? (count === ids.length ? 'true' : 'mixed') : 'false');
    }
  }

  function enterShelfSelection(ids = []) {
    if (!canManageShelf() || !selectable.length || isReader) return false;
    selecting = true;
    for (const id of ids) selected.add(id);
    updateShelfSelection();
    return true;
  }

  function exitShelfSelection() {
    if (!selecting) return;
    selecting = false;
    selected.clear();
    updateShelfSelection();
  }

  function bindShelfTile(tile, image, ids, open) {
    shelfTiles.set(tile, ids);
    const mark = titleText('✓', 'mobile-selection-mark');
    mark.setAttribute('aria-hidden', 'true');
    image.append(mark);
    let press;
    let held = false;
    const cancel = () => {
      clearTimeout(press?.timer);
      press = undefined;
    };
    tile.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0) { cancel(); return; }
      held = false;
      if (selecting || event.pointerType === 'mouse' || !ids.length) return;
      press = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
        if (tile.isConnected) held = enterShelfSelection(ids);
        cancel();
      }, 500) };
    };
    tile.onpointermove = event => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        held = true;
        cancel();
      }
    };
    tile.onpointerup = tile.onpointerleave = tile.onpointercancel = cancel;
    tile.oncontextmenu = event => event.preventDefault();
    tile.ondragstart = event => event.preventDefault();
    tile.onclick = event => {
      if (held && event.detail) { held = false; return; }
      if (!selecting) { open(); return; }
      const alreadySelected = ids.every(id => selected.has(id));
      for (const id of ids) {
        if (alreadySelected) selected.delete(id);
        else selected.add(id);
      }
      updateShelfSelection();
    };
  }

  function renderShelf(books, groups, filter, open, select) {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    shelf.replaceChildren();
    shelfTiles.clear();
    selectable = filter === 'all' ? books : books.filter(book => (book.groupId || '') === filter);
    const visibleIds = new Set(selectable.map(book => book.id));
    for (const id of selected) if (!visibleIds.has(id)) selected.delete(id);
    moveTo.replaceChildren(new Option('移动到分区', 'all', true, true),
      new Option('未分区', ''), ...groups.map(group => new Option(group.name, group.id)));
    moveTo.options[0].disabled = true;
    const available = filter === 'all' ? books.filter(book => !book.groupId) :
      selectable;
    byId('mobile-shelf-count').textContent = `${filter === 'all' ? books.length : available.length} 本`;
    const grid = document.createElement('div');
    grid.className = 'mobile-book-grid';
    if (filter === 'all') for (const group of groups) {
      const contents = books.filter(book => book.groupId === group.id);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'mobile-book-tile';
      const mosaic = document.createElement('span');
      mosaic.className = 'mobile-cover mobile-folder';
      for (const book of contents.slice(0, 4)) mosaic.append(cover(book, true));
      if (!contents.length) mosaic.textContent = '▧';
      tile.append(mosaic, titleText(group.name, 'single-line'), titleText(`${contents.length} 本`, 'mobile-book-format'));
      bindShelfTile(tile, mosaic, contents.map(book => book.id), () => select(group.id));
      grid.append(tile);
    }
    for (const book of available) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'mobile-book-tile';
      tile.title = book.title;
      const image = cover(book);
      tile.append(image, titleText(book.title, 'single-line'),
        titleText(book.file.name.split('.').at(-1).toUpperCase(), 'mobile-book-format'));
      bindShelfTile(tile, image, [book.id], () => open(book));
      grid.append(tile);
    }
    if (!grid.childElementCount) {
      const empty = document.createElement('section');
      empty.className = 'mobile-shelf-empty';
      empty.innerHTML = '<img src="assets/icon.svg" alt=""><strong></strong><p>从手机的文件中选一本书，就可以离线阅读。</p><button class="primary" type="button">选择文件</button>';
      empty.querySelector('strong').textContent = filter === 'all' ? '书架还是空的' : '这个分区还没有书';
      empty.querySelector('button').onclick = () => importButton.click();
      shelf.append(empty);
    } else shelf.append(grid);
    updateShelfSelection();
  }

  function canAnimate(view) {
    return isReader && !view.isPDF && !view.renderer.scrolled && typeof curl.animate === 'function' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function turnsFromLeft(view, method) {
    return method === 'goLeft' || (method === 'next' && view.book.dir === 'rtl') ||
      (method === 'prev' && view.book.dir !== 'rtl');
  }

  function atTurnBoundary(view, fromLeft) {
    const forward = fromLeft === (view.book.dir === 'rtl');
    return forward ? view.renderer.atEnd : view.renderer.atStart;
  }

  function foldTilt(y, area) {
    return Math.max(-25, Math.min(25, 50 * ((y - area.top) / area.height - .5)));
  }

  let paintedTilt;
  function tiltFold(tilt) {
    if (paintedTilt === tilt) return;
    paintedTilt = tilt;
    const shift = tilt - 10;
    paperFold.setAttribute('transform', `matrix(1 0 ${-shift / 50} 1 ${shift} 0)`);
  }

  function foldOffset({ progress, tilt }) {
    const shift = tilt - 10;
    // Start the outermost corner at the edge, even when the paper is tilted.
    const edge = Math.min(2 - .88 * shift, 23 + .9 * shift);
    return `${102 - edge - 118 * progress}%`;
  }

  function paintDrag(gesture, progress) {
    gesture.progress = progress;
    reading.style.setProperty('--leaf-fold-start', foldOffset(gesture));
    reading.style.setProperty('--leaf-fold-tilt', `${gesture.tilt}%`);
    tiltFold(gesture.tilt);
  }

  function trackDrag(gesture, progress, tilt) {
    gesture.target = progress;
    gesture.tilt = tilt;
    if (gesture.frame) return;
    gesture.frame = requestAnimationFrame(() => {
      gesture.frame = 0;
      if (dragTurn !== gesture) return;
      paintDrag(gesture, gesture.target);
      curl.dataset.from = body.dataset.mobileDrag = gesture.method === 'goLeft' ? 'left' : 'right';
      curl.hidden = false;
    });
  }

  function flushDrag(gesture) {
    cancelAnimationFrame(gesture.frame);
    gesture.frame = 0;
    paintDrag(gesture, gesture.target);
  }

  function clearDrag() {
    if (!dragTurn) return;
    cancelAnimationFrame(dragTurn.frame);
    dragTurn = undefined;
    curl.hidden = true;
    delete body.dataset.mobileDrag;
    reading.style.removeProperty('--leaf-fold-start');
    reading.style.removeProperty('--leaf-fold-tilt');
  }

  function settleDrag(gesture, end, duration) {
    const from = gesture.progress;
    const start = performance.now();
    return new Promise(resolve => {
      function frame(now) {
        if (dragTurn !== gesture) { resolve(); return; }
        const time = Math.min(1, (now - start) / duration);
        paintDrag(gesture, from + (end - from) * (1 - (1 - time) ** 3));
        if (time < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  async function cancelDrag(gesture) {
    if (!gesture || gesture !== dragTurn || turning) return;
    flushDrag(gesture);
    await settleDrag(gesture, 0, 230);
    if (dragTurn === gesture) clearDrag();
  }

  async function animateTurn(view, method, turn, gesture) {
    const dragged = gesture === dragTurn && Boolean(gesture);
    if (gesture?.width && !dragged) return;
    if (!dragged) clearDrag();
    const fromLeft = turnsFromLeft(view, method);
    if (!canAnimate(view) || atTurnBoundary(view, fromLeft)) {
      clearDrag();
      return turn();
    }
    const sign = fromLeft ? 1 : -1;
    const leftEdge = '16% 0 0 24% / 9% 0 0 12%';
    const rightEdge = '0 16% 24% 0 / 0 9% 12% 0';
    turning = true;
    curl.dataset.from = fromLeft ? 'left' : 'right';
    let cover;
    let reveal;
    try {
      // Only the snapshots bend. The paginator always measures the live reader at its original size.
      if (typeof document.startViewTransition === 'function') {
        const tilt = gesture?.tilt ?? 10;
        body.dataset.mobileTurn = curl.dataset.from;
        root.style.setProperty('--leaf-fold-tilt', `${tilt}%`);
        tiltFold(tilt);
        if (dragged) {
          root.style.setProperty('--leaf-fold-start', foldOffset(gesture));
          root.style.setProperty('--leaf-turn-duration', `${Math.round(460 - gesture.progress * 210)}ms`);
        }
        const transition = document.startViewTransition(async () => {
          delete body.dataset.mobileDrag;
          if (view !== getView()) return;
          await turn();
          curl.hidden = false;
        });
        await transition.finished;
        return;
      }
      if (dragged) {
        await settleDrag(gesture, 1.65, 330);
        if (view === getView()) await turn();
        return;
      }
      curl.hidden = false;
      cover = curl.animate([
        { transform: `translateX(${-sign * 106}%)`, borderRadius: fromLeft ? rightEdge : leftEdge },
        { transform: 'translateX(0)', borderRadius: '0' }
      ], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      await cover.finished;
      if (view === getView()) await turn();
      reveal = curl.animate([
        { transform: 'translateX(0)', borderRadius: '0' },
        { transform: `translateX(${sign * 106}%)`, borderRadius: fromLeft ? leftEdge : rightEdge }
      ], { duration: 230, easing: 'ease-out', fill: 'forwards' });
      await reveal.finished;
    } finally {
      curl.hidden = true;
      delete body.dataset.mobileTurn;
      clearDrag();
      for (const name of ['--leaf-fold-start', '--leaf-fold-tilt', '--leaf-turn-duration']) {
        root.style.removeProperty(name);
      }
      cover?.cancel();
      reveal?.cancel();
      turning = false;
    }
  }

  function bindTouch(target, owner, interactive) {
    let start;
    let pinch;
    const current = () => owner ?? getView();
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY);
    target.addEventListener('touchstart', event => {
      const view = current();
      if (!isReader || turning || !view || view !== getView() || event.target.closest?.(interactive)) return;
      if (event.touches.length !== 1) cancelDrag(start?.gesture);
      else clearDrag();
      if (event.touches.length === 2 && view.isPDF) {
        pinch = { distance: distance(event.touches), zoom: view.zoomPercent / 100, ratio: 1 };
        start = undefined;
        return;
      }
      if (event.touches.length !== 1) { start = undefined; return; }
      const touch = event.touches[0];
      const renderer = view.renderer;
      const frame = target.defaultView?.frameElement?.getBoundingClientRect();
      start = { x: touch.clientX, y: touch.clientY, at: performance.now(),
        frameTop: frame?.top ?? 0,
        edgeStart: renderer.scrolled && renderer.start <= 1,
        edgeEnd: renderer.scrolled && renderer.viewSize - renderer.end <= 2 };
    }, { passive: true });
    target.addEventListener('touchmove', event => {
      if (pinch && event.touches.length === 2) {
        if (event.cancelable) event.preventDefault();
        pinch.ratio = distance(event.touches) / pinch.distance;
      } else if (start && event.touches.length === 1 && panel === undefined) {
        const view = current();
        const doc = target.nodeType === Node.DOCUMENT_NODE ? target : document;
        const dx = event.touches[0].clientX - start.x;
        const dy = event.touches[0].clientY - start.y;
        if (!view || view !== getView() || view.isPDF || view.renderer.scrolled ||
            !doc.getSelection()?.isCollapsed) return;
        if (!start.gesture && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          const method = dx < 0 ? 'goRight' : 'goLeft';
          if (canAnimate(view) && !atTurnBoundary(view, dx > 0)) {
            const area = reading.getBoundingClientRect();
            start.gesture = dragTurn = { method, sign: Math.sign(dx), width: area.width, area };
          }
        }
        if (start.gesture || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.35)) {
          if (event.cancelable) event.preventDefault();
          if (start.gesture) {
            const gesture = start.gesture;
            trackDrag(gesture, Math.max(0, Math.min(1.25, dx * gesture.sign / gesture.width)),
              foldTilt(event.touches[0].clientY + start.frameTop, gesture.area));
          }
        }
      }
    }, { passive: false });
    target.addEventListener('touchcancel', () => {
      cancelDrag(start?.gesture);
      start = pinch = undefined;
    });
    target.addEventListener('touchend', event => {
      const view = current();
      if (pinch && event.touches.length < 2) {
        view.setZoom(Math.max(.25, Math.min(4, pinch.zoom * pinch.ratio)));
        pinch = undefined;
      }
      const origin = start;
      start = undefined;
      if (!origin || !view || view !== getView() || event.touches.length) {
        cancelDrag(origin?.gesture);
        return;
      }
      const doc = target.nodeType === Node.DOCUMENT_NODE ? target : document;
      if (!doc.getSelection()?.isCollapsed) { cancelDrag(origin.gesture); return; }
      const touch = event.changedTouches[0];
      const dy = touch.clientY - origin.y;
      const dx = touch.clientX - origin.x;
      if (origin.gesture) {
        const gesture = origin.gesture;
        if (gesture !== dragTurn) return;
        const travel = dx * gesture.sign;
        if (travel >= gesture.width * .27 || (travel > 44 && performance.now() - origin.at < 280)) {
          flushDrag(gesture);
          turnPage(gesture.method, gesture);
        } else cancelDrag(gesture);
        return;
      }
      if (!view.isPDF && !view.renderer.scrolled && panel === undefined &&
          Math.abs(dx) > Math.abs(dy) * 1.35 &&
          (Math.abs(dx) >= reading.clientWidth * .27 || (Math.abs(dx) > 44 && performance.now() - origin.at < 280))) {
        turnPage(dx < 0 ? 'goRight' : 'goLeft');
        return;
      }
      if (view.renderer.scrolled && !view.isPDF && Math.abs(dy) > 42 && Math.abs(dy) > Math.abs(dx)) {
        if (dy < 0 && origin.edgeEnd) turnPage('next');
        if (dy > 0 && origin.edgeStart) turnPage('prev');
        return;
      }
      if (performance.now() - origin.at > 330 || Math.hypot(dx, dy) > 13) return;
      const offset = doc.defaultView.frameElement?.getBoundingClientRect().left ?? 0;
      const bounds = reading.getBoundingClientRect();
      const x = (touch.clientX + offset - bounds.left) / bounds.width;
      if (x > .25 && x < .75) showPanel(panel === undefined ? null : undefined);
      else if (!view.renderer.scrolled && panel === undefined) {
        turnPage(x <= .25 ? 'goLeft' : 'goRight', { tilt: foldTilt(touch.clientY + origin.frameTop, bounds) });
      }
    }, { passive: true });
  }

  byId('mobile-back').onclick = showShelf;
  selectShelf.onclick = () => { if (enterShelfSelection()) selectAll.focus(); };
  selectAll.onclick = () => {
    if (selected.size === selectable.length) selected.clear();
    else for (const book of selectable) selected.add(book.id);
    updateShelfSelection();
  };
  byId('mobile-cancel-selection').onclick = exitShelfSelection;
  moveTo.onchange = () => {
    const destination = moveTo.value;
    moveTo.selectedIndex = 0;
    if (selected.size && destination !== 'all') moveSelection(new Set(selected), destination);
  };
  remove.onclick = () => removeSelection(new Set(selected));
  byId('mobile-add-mark').onclick = () => byId('add-bookmark').click();
  byId('mobile-prev').onclick = () => turnPage('prev');
  byId('mobile-next').onclick = () => turnPage('next');
  seek.oninput = () => { byId('mobile-progress-label').textContent = `${Math.round(seek.value / 10)}%`; };
  seek.onchange = () => {
    const fraction = Number(seek.value) / 1000;
    seek.blur();
    goToProgress(fraction);
  };
  sheetClose.onclick = () => showPanel(null);
  for (const button of overlays.querySelectorAll('[data-panel]')) {
    button.onclick = () => showPanel(button.dataset.panel === panel ? null : button.dataset.panel);
  }
  for (const button of overlays.querySelectorAll('[data-paper]')) {
    button.onclick = () => {
      theme.value = button.dataset.paper;
      theme.dispatchEvent(new Event('change'));
      syncTheme();
    };
  }
  window.leafBack = () => {
    for (const id of ['mobile-settings', 'lookup-dialog', 'mark-style-dialog', 'note-dialog', 'action-dialog', 'library-dialog']) {
      const dialog = byId(id);
      if (!dialog.open) continue;
      if (!dialog.querySelector('button[type="submit"]:disabled')) dialog.close();
      return true;
    }
    if (panel !== undefined) { closeMenu(); return true; }
    if (!byId('selection-tools').hidden) { clearSelection(); return true; }
    if (isReader) { showShelf(); return true; }
    if (selecting) { exitShelfSelection(); return true; }
    return false;
  };
  showShelf();
  return { renderShelf, showReader, showShelf, showReadingTab, closeMenu, updateLocation, animateTurn,
    bindTouch, readerLayout, layoutFor, bookReadingTime, shelfNotice, exitShelfSelection };
}
