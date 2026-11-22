const validTime = value => Number.isFinite(value) && value >= 0 ? value : 0;

export function formatReadingTime(milliseconds) {
  const seconds = Math.floor(validTime(milliseconds) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

export function createReadingClock(saved, persist) {
  const books = new Map(Object.entries(saved?.books ?? {}).map(([id, time]) => [id, validTime(time)]));
  let total = validTime(saved?.total);
  let bookId;
  let started;
  let foreground = true;
  let showing = true;

  function elapsed(now = performance.now()) {
    return started === undefined ? 0 : Math.max(0, now - started);
  }

  function checkpoint() {
    if (started === undefined) return;
    const now = performance.now();
    const duration = elapsed(now);
    started = now;
    total += duration;
    books.set(bookId, (books.get(bookId) ?? 0) + duration);
    persist({ total, books: Object.fromEntries(books) });
  }

  function sync() {
    const active = bookId && foreground && showing && !document.hidden;
    if (active) {
      if (started === undefined) started = performance.now();
    } else {
      checkpoint();
      started = undefined;
    }
  }

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { showing = false; sync(); });
  window.addEventListener('pageshow', () => { showing = true; sync(); });
  window.leafForeground = value => { foreground = Boolean(value); sync(); };
  setInterval(checkpoint, 15000);

  return {
    setBook(id) {
      if (bookId === id) return;
      checkpoint();
      started = undefined;
      bookId = id;
      sync();
    },
    total: () => total + elapsed(),
    forBook: id => (books.get(id) ?? 0) + (bookId === id ? elapsed() : 0)
  };
}
