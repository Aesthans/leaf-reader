import { AnnotationMode, GlobalWorkerOptions, getDocument } from './vendor/pdfjs/build/pdf.mjs';
import { EventBus, PDFLinkService, PDFViewer, ScrollMode } from './vendor/pdfjs/web/pdf_viewer.mjs';
import { appearance } from './mark-style.mjs';
import { pdfSearchPattern, searchPDFPage } from './pdf-search.mjs';

const assets = new URL('./vendor/pdfjs/', import.meta.url);
GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', assets).href;

const fitModes = ['page-width', 'page-fit'];
const minZoom = .25;
const maxZoom = 4;
const validZoom = zoom => fitModes.includes(zoom) ||
  (Number.isFinite(zoom) && zoom >= minZoom && zoom <= maxZoom);

function mapOutline(items) {
  return items.map(({ title, dest, items: children }) => ({
    label: title, href: dest, subitems: mapOutline(children ?? [])
  }));
}

async function loadPDF(file) {
  return getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: new URL('cmaps/', assets).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    wasmUrl: new URL('wasm/', assets).href,
    iccUrl: new URL('iccs/', assets).href,
    useWorkerFetch: false
  });
}

async function readMetadata(pdf) {
  const info = await pdf.getMetadata().then(({ info }) => info).catch(() => ({}));
  return { title: info.Title, author: info.Author };
}

export async function inspectPDF(file) {
  const task = await loadPDF(file);
  try {
    const pdf = await task.promise;
    return {
      metadata: await readMetadata(pdf),
      getCover: async () => {
        const page = await pdf.getPage(1);
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(240 / size.width, 340 / size.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
      },
      destroy: () => task.destroy()
    };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

class LeafPDFView extends HTMLElement {
  isPDF = true;
  renderer = this;
  #abort = new AbortController();
  #events = new EventBus();
  #viewer;
  #links;
  #task;
  #position;
  #zoom = 'page-width';
  #readingMarks = [];
  #searchHit;
  #searchTimer;
  #container = document.createElement('div');

  get page() { return this.#viewer.currentPageNumber; }
  get pageCount() { return this.#viewer.pagesCount; }
  get scrolled() { return this.#viewer.scrollMode === ScrollMode.VERTICAL; }
  get zoom() { return this.#zoom; }
  get zoomPercent() { return Math.round(this.#viewer.currentScale * 100); }

  async open(file, position) {
    this.#container.className = 'pdf-container';
    this.#container.tabIndex = 0;
    this.#container.setAttribute('aria-label', 'PDF 正文');
    const pages = document.createElement('div');
    pages.className = 'pdfViewer';
    this.#container.append(pages);
    this.append(this.#container);

    const eventBus = this.#events;
    this.#links = new PDFLinkService({ eventBus, ignoreDestinationZoom: true });
    this.#links.externalLinkEnabled = false;
    this.#viewer = new PDFViewer({
      container: this.#container, viewer: pages, eventBus, linkService: this.#links,
      abortSignal: this.#abort.signal, annotationMode: AnnotationMode.ENABLE,
      enableAutoLinking: false, imageResourcesPath: new URL('web/images/', assets).href
    });
    this.#links.setViewer(this.#viewer);
    eventBus.on('updateviewarea', ({ location }) => {
      this.#position = location;
      this.#relocate();
    });
    eventBus.on('pagerendered', ({ error, pageNumber }) => {
      if (error && pageNumber === this.page) this.dispatchEvent(new Event('pageerror'));
      if (!error) this.#paintPageMarks(pageNumber);
    });
    eventBus.on('textlayerrendered', ({ pageNumber, error }) => {
      if (!error) this.#paintSearchHit(pageNumber);
    });

    this.#task = await loadPDF(file);
    const pdf = await this.#task.promise;
    const [metadata, outline] = await Promise.all([
      readMetadata(pdf),
      pdf.getOutline().catch(() => null)
    ]);
    this.book = { metadata, toc: mapOutline(outline ?? []) };

    const initialized = new Promise(resolve => eventBus.on('pagesinit', resolve, { once: true }));
    this.#links.setDocument(pdf);
    this.#viewer.setDocument(pdf);
    await Promise.race([initialized, this.#viewer.pagesPromise]);
    this.#viewer.scrollMode = position?.flow === 'paginated' ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    if (validZoom(position?.zoom)) this.#zoom = position.zoom;
    if (Number.isInteger(position?.page)) {
      const page = this.#validPage(position.page);
      await this.#preparePage(page);
      this.#viewer.currentPageNumber = page;
    }
    this.#viewer.currentScaleValue = this.#zoom;
    this.#restorePosition(position);
    this.#viewer.update();
    this.#relocate();
  }

  #validPage(page) {
    return Math.max(1, Math.min(this.pageCount, page));
  }

  async #preparePage(page) {
    const pageView = this.#viewer.getPageView(page - 1);
    if (!pageView.pdfPage) {
      const pdfPage = await this.#viewer.pdfDocument.getPage(page);
      if (!pageView.pdfPage) pageView.setPdfPage(pdfPage);
    }
  }

  #restorePosition(position) {
    if (!Number.isInteger(position?.page) || !Number.isFinite(position.left) ||
        !Number.isFinite(position.top)) return;
    this.#viewer.scrollPageIntoView({
      pageNumber: this.#validPage(position.page),
      destArray: [null, { name: 'XYZ' }, position.left, position.top, null],
      ignoreDestinationZoom: true,
      allowNegativeOffset: true
    });
  }

  async *searchText(query, signal) {
    const pdf = this.#viewer.pdfDocument;
    const pattern = pdfSearchPattern(query);
    if (!pattern) return;
    this.hasSearchableText = false;
    for (let page = 1; page <= pdf.numPages && !signal.aborted; page++) {
      const { items } = await (await pdf.getPage(page)).getTextContent({ disableNormalization: true });
      if (signal.aborted) return;
      if (items.some(item => item.str?.trim())) this.hasSearchableText = true;
      for (const { left, top, textRanges, excerpt } of searchPDFPage(items, pattern)) {
        if (signal.aborted) return;
        yield {
          anchor: { page, left, top, textRanges }, location: `第 ${page} 页`, excerpt
        };
      }
    }
  }

  selectionAnchor(range) {
    if (!this.contains(range.startContainer) || !this.contains(range.endContainer)) return;
    const regions = [];
    for (const layer of this.#container.querySelectorAll('.textLayer')) {
      if (!range.intersectsNode(layer)) continue;
      const page = Number(layer.closest('.page')?.dataset.pageNumber);
      const bounds = layer.getBoundingClientRect();
      if (!page || !bounds.width || !bounds.height) continue;
      const boxes = [];
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!range.intersectsNode(node)) continue;
        const part = document.createRange();
        part.setStart(node, node === range.startContainer ? range.startOffset : 0);
        part.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
        for (const rect of part.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          boxes.push([
            (rect.left - bounds.left) / bounds.width, (rect.top - bounds.top) / bounds.height,
            rect.width / bounds.width, rect.height / bounds.height
          ]);
        }
      }
      if (boxes.length) regions.push({ page, boxes });
    }
    if (!regions.length) return;
    const [{ page, boxes: [[x, y]] }] = regions;
    const { viewport } = this.#viewer.getPageView(page - 1);
    const [left, top] = viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
    return { page, left, top, regions };
  }

  setReadingMarks(marks) {
    this.#readingMarks = marks;
    for (const page of this.#container.querySelectorAll('.page[data-loaded]')) {
      this.#paintPageMarks(Number(page.dataset.pageNumber));
    }
  }

  #paintPageMarks(page) {
    const { div } = this.#viewer.getPageView(page - 1);
    div.querySelector('.leaf-pdf-marks')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'leaf-pdf-marks';
    overlay.setAttribute('aria-hidden', 'true');
    const marks = this.#searchHit?.anchor.regions ?
      [...this.#readingMarks, this.#searchHit] : this.#readingMarks;
    for (const mark of marks) {
      const region = mark.anchor.regions?.find(item => item.page === page);
      const look = appearance(mark);
      for (const [x, y, width, height] of region?.boxes ?? []) {
        const box = document.createElement('span');
        if (mark === this.#searchHit) box.classList.add('search-hit');
        if (look) {
          box.dataset.style = look.style;
          box.style.setProperty('--mark-ink', look.ink);
          box.style.setProperty('--mark-fill', `${look.ink}55`);
        } else if (mark.note) box.className = 'with-note';
        Object.assign(box.style, {
          left: `${x * 100}%`, top: `${y * 100}%`,
          width: `${width * 100}%`, height: `${height * 100}%`
        });
        overlay.append(box);
      }
    }
    if (overlay.childElementCount) div.append(overlay);
  }

  #clearSearchHit() {
    clearTimeout(this.#searchTimer);
    const page = this.#searchHit?.anchor.page;
    this.#searchHit = undefined;
    if (page && this.#viewer?.pdfDocument) this.#paintPageMarks(page);
  }

  #paintSearchHit(page) {
    const hit = this.#searchHit;
    if (hit?.anchor.page !== page) return;
    // PDF.js keeps text divs in the same order as getTextContent's string items.
    const divs = this.#viewer.getPageView(page - 1)._textHighlighter?.textDivs;
    if (!divs?.length) return;
    const regions = [];
    let firstRect;
    for (const { index, start, end } of hit.anchor.textRanges ?? []) {
      const div = divs[index];
      const node = div?.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE || end > node.length) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      firstRect ??= Array.from(range.getClientRects()).find(rect => rect.width && rect.height);
      regions.push(...this.selectionAnchor(range)?.regions ?? []);
    }
    if (!regions.length) return;
    hit.anchor.regions = [{ page, boxes: regions.flatMap(region => region.boxes) }];
    this.#paintPageMarks(page);
    if (!hit.located && firstRect) {
      hit.located = true;
      const bounds = this.#container.getBoundingClientRect();
      this.#container.scrollBy(firstRect.left - bounds.left - 24, firstRect.top - bounds.top - 24);
      this.#searchTimer = setTimeout(() => this.#clearSearchHit(), 3500);
    }
  }

  async goToReadingMark(anchor, fromSearch = false) {
    this.#clearSearchHit();
    if (fromSearch && anchor.textRanges) {
      this.#searchHit = { anchor: { ...anchor }, style: 'highlight', color: 'yellow' };
    }
    await this.goToPage(anchor.page);
    this.#restorePosition(anchor.regions ?
      { ...anchor, left: Math.max(0, anchor.left - 20), top: anchor.top + 20 } : anchor);
    this.#viewer.update();
    if (fromSearch) this.#paintSearchHit(anchor.page);
  }

  #relocate() {
    const { pageNumber, top, left } = this.#position ?? {};
    this.lastLocation = {
      page: this.page,
      total: this.pageCount,
      pdf: { page: pageNumber ?? this.page, left, top, zoom: this.#zoom,
        flow: this.scrolled ? 'scrolled' : 'paginated' }
    };
    this.dispatchEvent(new CustomEvent('relocate', { detail: this.lastLocation }));
  }

  setFlow(flow) {
    const position = this.lastLocation.pdf;
    this.#viewer.scrollMode = flow === 'scrolled' ? ScrollMode.VERTICAL : ScrollMode.PAGE;
    this.#restorePosition(position);
    this.#viewer.update();
  }

  setZoom(zoom) {
    if (!validZoom(zoom)) return;
    this.#zoom = zoom;
    this.#viewer.currentScaleValue = zoom;
    this.#viewer.update();
  }

  stepZoom(direction) {
    const scale = this.#viewer.currentScale * (direction > 0 ? 1.2 : 1 / 1.2);
    this.setZoom(Math.max(minZoom, Math.min(maxZoom, Math.round(scale * 100) / 100)));
  }

  async goToPage(page) {
    if (!Number.isInteger(page)) return;
    page = this.#validPage(page);
    await this.#preparePage(page);
    this.#viewer.currentPageNumber = page;
    this.#viewer.update();
    if (!this.scrolled && typeof this.#zoom === 'string') {
      this.#viewer.currentScaleValue = this.#zoom;
      this.#viewer.update();
    }
  }

  goTo(destination) { return this.#links.goToDestination(destination); }
  prev() { return this.goToPage(this.page - 1); }
  next() { return this.goToPage(this.page + 1); }
  goLeft() { return this.prev(); }
  goRight() { return this.next(); }
  scrollReadingBy(distance) { this.#container.scrollBy(0, distance); }

  close() {
    this.#clearSearchHit();
    this.#viewer?.setDocument(null);
    this.#links?.setDocument(null);
    this.#abort.abort();
    this.#viewer?.l10n.destroy().catch(error => console.error(error));
    this.#task?.destroy().catch(error => console.error(error));
  }
}

customElements.define('leaf-pdf-view', LeafPDFView);
