import { enableDisableFontOpt } from './fontContainer.js';

/**
 *
 * @param {FontContainerFamily} font
 * @param {Array<OcrPage>} pageArr
 * @param {Array<HTMLImageElement>} binaryImageArr
 * @param {Array<boolean>} binaryRotatedArr
 * @param {number} n - Number of words to compare
 */
export async function evalPageFonts(font, pageArr, binaryImageArr, binaryRotatedArr, n = 500) {
  const browserMode = typeof process === 'undefined';

  let metricTotal = 0;
  let wordsTotal = 0;

  for (let i = 0; i < pageArr.length; i++) {
    if (wordsTotal > n) break;

    // The Node.js canvas package does not currently support worke threads
    // https://github.com/Automattic/node-canvas/issues/1394
    let res;
    if (!browserMode) {
      const { evalPageFont } = await import('./worker/compareOCRModule.js');

      res = await evalPageFont({
        font: font.normal.family, page: pageArr[i], binaryImage: binaryImageArr[i], imageRotated: binaryRotatedArr[i], pageMetricsObj: globalThis.pageMetricsArr[i],
      });
      // Browser case
    } else {
      res = await globalThis.gs.evalPageFont({
        font: font.normal.family, page: pageArr[i], binaryImage: binaryImageArr[i].src, imageRotated: binaryRotatedArr[i], pageMetricsObj: globalThis.pageMetricsArr[i],
      });
    }

    metricTotal += res.metricTotal;
    wordsTotal += res.wordsTotal;
  }

  return metricTotal;
}

let loadedRaw = false;
let loadedOpt = false;

/**
 *
 * @param {*} scheduler
 * @param {Object<string, ?FontContainerAll>} fontAll
 */
export async function setFontAllWorker(scheduler, fontAll) {
  if (!fontAll.active) return;

  // const opt = !(typeof fontAll.active.Carlito.normal.src == 'string');
  const { opt } = fontAll.active.Carlito.normal;

  const alreadyLoaded = (!opt && loadedRaw) || (opt && loadedOpt);

  // If the active font data is not already loaded, load it now.
  // This assumes that only one version of the raw/optimized fonts ever exist--
  // it does not check whether the current optimized font changed since it was last loaded.
  if (!alreadyLoaded) {
    const resArr = [];
    for (let i = 0; i < scheduler.workers.length; i++) {
      const worker = scheduler.workers[i];
      const res = worker.loadFontContainerAllWorker({
        src: {
          Carlito: { normal: fontAll.active.Carlito.normal.src, italic: fontAll.active.Carlito.italic.src, smallCaps: fontAll.active.Carlito['small-caps'].src },
          Century: { normal: fontAll.active.Century.normal.src, italic: fontAll.active.Century.italic.src, smallCaps: fontAll.active.Century['small-caps'].src },
          Garamond: { normal: fontAll.active.Garamond.normal.src, italic: fontAll.active.Garamond.italic.src, smallCaps: fontAll.active.Garamond['small-caps'].src },
          Palatino: { normal: fontAll.active.Palatino.normal.src, italic: fontAll.active.Palatino.italic.src, smallCaps: fontAll.active.Palatino['small-caps'].src },
          NimbusRomNo9L: { normal: fontAll.active.NimbusRomNo9L.normal.src, italic: fontAll.active.NimbusRomNo9L.italic.src, smallCaps: fontAll.active.NimbusRomNo9L['small-caps'].src },
          NimbusSans: { normal: fontAll.active.NimbusSans.normal.src, italic: fontAll.active.NimbusSans.italic.src, smallCaps: fontAll.active.NimbusSans['small-caps'].src },
        },
        opt,
      });
      resArr.push(res);
    }
    await Promise.all(resArr);

    // Theoretically this should be changed to use promises to avoid the race condition when `setFontAllWorker` is called multiple times quickly and `loadFontContainerAllWorker` is still running.
    if (opt) {
      loadedOpt = true;
    } else {
      loadedRaw = true;
    }
  }

  // Set the active font in the workers to match the active font in `fontAll`
  const resArr = [];
  for (let i = 0; i < scheduler.workers.length; i++) {
    const worker = scheduler.workers[i];
    const res = worker.setFontActiveWorker({ opt, fontFamilySans: fontAll.active.SansDefault.normal.family, fontFamilySerif: fontAll.active.SerifDefault.normal.family });
    resArr.push(res);
  }
  await Promise.all(resArr);
}

/**
* @param {Array<OcrPage>} pageArr
* @param {Array<Promise<HTMLImageElement>>|Array<Promise<Image>>} binaryImageArr
* @param {Array<boolean>} binaryRotatedArr
* @param {*} fontAll
*/
export async function selectDefaultFontsDocument(pageArr, binaryImageArr, binaryRotatedArr, fontAll) {
  const debug = false;

  const browserMode = typeof process === 'undefined';

  const binaryImageArrRes = await Promise.all(binaryImageArr);

  await setFontAllWorker(globalThis.generalScheduler, fontAll);

  if (!browserMode) {
    const { setFontAll, initCanvasNode } = await import('./worker/compareOCRModule.js');
    setFontAll(fontAll);
    await initCanvasNode();
  }

  const sansMetrics = {
    Carlito: await evalPageFonts(fontAll.active.Carlito, pageArr, binaryImageArrRes, binaryRotatedArr),
    NimbusSans: await evalPageFonts(fontAll.active.NimbusSans, pageArr, binaryImageArrRes, binaryRotatedArr),
  };

  let minKeySans = 'NimbusSans';
  let minValueSans = Number.MAX_VALUE;

  for (const [key, value] of Object.entries(sansMetrics)) {
    if (debug) console.log(`${key} metric: ${String(value)}`);
    if (value < minValueSans) {
      minValueSans = value;
      minKeySans = key;
    }
  }

  let change = false;
  if (minKeySans !== 'NimbusSans') {
    fontAll.raw.SansDefault = fontAll.raw[minKeySans];
    if (fontAll.opt) fontAll.opt.SansDefault = fontAll.opt[minKeySans];
    change = true;
  }

  const serifMetrics = {
    Century: await evalPageFonts(fontAll.active.Century, pageArr, binaryImageArrRes, binaryRotatedArr),
    Palatino: await evalPageFonts(fontAll.active.Palatino, pageArr, binaryImageArrRes, binaryRotatedArr),
    Garamond: await evalPageFonts(fontAll.active.Garamond, pageArr, binaryImageArrRes, binaryRotatedArr),
    NimbusRomNo9L: await evalPageFonts(fontAll.active.NimbusRomNo9L, pageArr, binaryImageArrRes, binaryRotatedArr),
  };

  let minKeySerif = 'NimbusRomNo9L';
  let minValueSerif = Number.MAX_VALUE;

  for (const [key, value] of Object.entries(serifMetrics)) {
    if (debug) console.log(`${key} metric: ${String(value)}`);
    if (value < minValueSerif) {
      minValueSerif = value;
      minKeySerif = key;
    }
  }

  if (minKeySerif !== 'NimbusRomNo9L') {
    fontAll.raw.SerifDefault = fontAll.raw[minKeySerif];
    if (fontAll.opt) fontAll.opt.SerifDefault = fontAll.opt[minKeySerif];
    change = true;
  }

  await setFontAllWorker(globalThis.generalScheduler, fontAll);

  return change;
}

/**
* @param {Array<OcrPage>} pageArr
* @param {Array<Promise<HTMLImageElement>>|Array<Promise<Image>>} binaryImageArr
* @param {Array<boolean>} binaryRotatedArr
* @param {*} fontAll
*/
export async function validateOptimizedFonts(pageArr, binaryImageArr, binaryRotatedArr, fontAll) {
  const debug = false;
  const binaryImageArrRes = await Promise.all(binaryImageArr);

  // The metrics for the optimized fonts must be re-calculated since the active OCR data may have changed since `selectDefaultFontsDocument` was run.
  const sansMetricOpt = await evalPageFonts(fontAll.active.SansDefault, pageArr, binaryImageArrRes, binaryRotatedArr);
  const serifMetricOpt = await evalPageFonts(fontAll.active.SerifDefault, pageArr, binaryImageArrRes, binaryRotatedArr);

  if (debug) console.log(`Optimized SansDefault metric: ${String(sansMetricOpt)}`);
  if (debug) console.log(`Optimized SerifDefault metric: ${String(serifMetricOpt)}`);

  // Disable optimized fonts
  await enableDisableFontOpt(false);

  // Re-calculate with unoptimized fonts
  const sansMetrics = {
    Carlito: await evalPageFonts(fontAll.active.Carlito, pageArr, binaryImageArrRes, binaryRotatedArr),
    NimbusSans: await evalPageFonts(fontAll.active.NimbusSans, pageArr, binaryImageArrRes, binaryRotatedArr),
  };

  let minKeySans = 'NimbusSans';
  let minValueSans = Number.MAX_VALUE;

  for (const [key, value] of Object.entries(sansMetrics)) {
    if (debug) console.log(`${key} metric: ${String(value)}`);
    if (value < minValueSans) {
      minValueSans = value;
      minKeySans = key;
    }
  }

  let change = false;
  if (sansMetricOpt > minValueSans) {
    fontAll.raw.SansDefault = fontAll.raw[minKeySans];
    // TODO: Think about the best way to remove optimized fonts, this only removes one.
    if (fontAll.opt) fontAll.opt.SansDefault = fontAll.raw[minKeySans];
    change = true;
  }

  const serifMetrics = {
    Century: await evalPageFonts(fontAll.active.Century, pageArr, binaryImageArrRes, binaryRotatedArr),
    Palatino: await evalPageFonts(fontAll.active.Palatino, pageArr, binaryImageArrRes, binaryRotatedArr),
    Garamond: await evalPageFonts(fontAll.active.Garamond, pageArr, binaryImageArrRes, binaryRotatedArr),
    NimbusRomNo9L: await evalPageFonts(fontAll.active.NimbusRomNo9L, pageArr, binaryImageArrRes, binaryRotatedArr),
  };

  let minKeySerif = 'NimbusRomNo9L';
  let minValueSerif = Number.MAX_VALUE;

  for (const [key, value] of Object.entries(serifMetrics)) {
    if (debug) console.log(`${key} metric: ${String(value)}`);
    if (value < minValueSerif) {
      minValueSerif = value;
      minKeySerif = key;
    }
  }

  if (minKeySerif !== 'NimbusRomNo9L') {
    fontAll.raw.SerifDefault = fontAll.raw[minKeySerif];
    if (fontAll.opt) fontAll.opt.SerifDefault = fontAll.opt[minKeySerif];
    change = true;
  }

  if (!change) await enableDisableFontOpt(true);
  return change;
}
