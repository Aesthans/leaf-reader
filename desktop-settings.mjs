import { createReadingClock, formatReadingTime } from './reading-clock.mjs';

const byId = id => document.getElementById(id);

export function createDesktopSettings({ readLocal, writeLocal, getPreferences, applyPreferences }) {
  const clock = createReadingClock(readLocal('leaf.reading-time'), value => writeLocal('leaf.reading-time', value));
  let book;
  const dialog = document.createElement('dialog');
  dialog.className = 'action-dialog desktop-settings';
  dialog.id = 'desktop-settings';
  dialog.setAttribute('aria-labelledby', 'desktop-settings-title');
  dialog.innerHTML = `<form id="desktop-settings-form">
    <header class="dialog-header"><h2 id="desktop-settings-title">阅读设置</h2>
      <button type="button" id="close-desktop-settings" aria-label="关闭设置">✕</button></header>
    <section>
      <label>主题<select name="theme"><option value="paper">白纸</option><option value="sepia">暖纸</option><option value="dark">夜间</option></select></label>
      <label>字号<input name="size" type="number" min="14" max="36" required></label>
      <label>行距<select name="leading"><option value="1.45">紧凑</option><option value="1.65">标准</option><option value="2">舒展</option></select></label>
      <label>电子书阅读方式<select name="flow"><option value="paginated">横向分页</option><option value="scrolled">纵向滚动</option></select></label>
      <small>设置会保存到本机。PDF 使用阅读工具栏中的缩放和阅读模式。</small>
    </section>
    <section><h3>阅读统计</h3>
      <div class="desktop-stat"><span>累计阅读</span><strong id="desktop-total-time"></strong></div>
      <div id="desktop-current-stat"><span id="desktop-current-title" class="single-line"></span><strong id="desktop-current-time"></strong></div>
      <small>从本版开始累计。窗口切到后台、最小化或打开设置时暂停。</small>
    </section>
    <p id="desktop-settings-notice" role="status" hidden></p>
    <div class="action-buttons"><button id="cancel-desktop-settings" type="button">取消</button>
      <button type="submit" class="primary" id="save-desktop-settings">保存设置</button></div>
  </form>`;
  document.body.append(dialog);
  const form = byId('desktop-settings-form');
  const readingTime = id => formatReadingTime(clock.forBook(id));
  function syncClock() { clock.setBook(dialog.open ? undefined : book?.id); }
  window.addEventListener('blur', () => window.leafForeground(false));
  window.addEventListener('focus', () => window.leafForeground(true));
  window.leafForeground(document.hasFocus());
  byId('open-desktop-settings').onclick = () => {
    for (const [key, value] of Object.entries(getPreferences())) form.elements.namedItem(key).value = value;
    byId('desktop-total-time').textContent = formatReadingTime(clock.total());
    byId('desktop-current-stat').hidden = !book;
    byId('desktop-current-title').textContent = book?.title ?? '';
    byId('desktop-current-title').title = book?.title ?? '';
    byId('desktop-current-time').textContent = book ? readingTime(book.id) : '';
    byId('desktop-settings-notice').hidden = true;
    dialog.showModal();
    syncClock();
  };
  byId('close-desktop-settings').onclick = byId('cancel-desktop-settings').onclick = () => dialog.close();
  const outside = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  let backdropPress = false;
  dialog.addEventListener('pointerdown', event => { backdropPress = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => {
    if (backdropPress && event.target === dialog && outside(event) && !byId('save-desktop-settings').disabled) dialog.close();
    backdropPress = false;
  });
  dialog.addEventListener('close', syncClock);
  dialog.addEventListener('cancel', event => {
    if (byId('save-desktop-settings').disabled) event.preventDefault();
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const save = byId('save-desktop-settings');
    save.disabled = byId('cancel-desktop-settings').disabled = byId('close-desktop-settings').disabled = true;
    try {
      const values = new FormData(form);
      await applyPreferences({
        theme: values.get('theme'), size: Number(values.get('size')),
        leading: Number(values.get('leading')), flow: values.get('flow')
      });
      dialog.close();
    } finally {
      save.disabled = byId('cancel-desktop-settings').disabled = byId('close-desktop-settings').disabled = false;
    }
  };
  return { readingTime, setBook(record) { book = record; syncClock(); } };
}
