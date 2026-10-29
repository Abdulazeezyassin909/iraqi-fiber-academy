/**
 * Visual verification: pigtail exclude clip over fusion splicer L-clamp lid.
 * Outputs 3 screenshots + pixel sample on lid center (screenshot #2).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { PNG } from 'pngjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'visual-verify');
const URL = 'http://localhost:3456/fusion-splicer';
const FIBER_YELLOW = { r: 250, g: 202, b: 21 }; // #facc15

mkdirSync(OUT_DIR, { recursive: true });

function colorDist(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  );
}

function samplePngPixel(pngPath, x, y) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const ix = Math.round(Math.max(0, Math.min(png.width - 1, x)));
  const iy = Math.round(Math.max(0, Math.min(png.height - 1, y)));
  const idx = (png.width * iy + ix) << 2;
  return {
    x: ix,
    y: iy,
    r: png.data[idx],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    a: png.data[idx + 3],
    hex: '#' + [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join(''),
  };
}

function isFiberYellow(px) {
  return colorDist(px, FIBER_YELLOW) < 55;
}

async function waitForWorkspace(page) {
  await page.waitForFunction(() => {
    const app = document.getElementById('lab-app');
    return app && !app.hidden;
  }, { timeout: 15000 });
  await page.waitForSelector('#lab-canvas-2d', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const stage = document.getElementById('lab-canvas-2d');
    return stage && stage.offsetWidth > 100 && stage.offsetHeight > 100;
  });
}

async function setupScenario(page) {
  return page.evaluate(async () => {
    const out = { steps: [] };

    if (!window.FtthLabProjectManager?.fileNew) {
      throw new Error('FtthLabProjectManager.fileNew missing');
    }
    window.FtthLabProjectManager.fileNew();
    out.steps.push('fileNew');
    await new Promise((r) => setTimeout(r, 400));

    window.FtthLab.centerWorldInView();
    out.steps.push('centerWorldInView');

    const wx = 10000;
    const wy = 10000;
    (window.FusionSplicerMachine.list() || []).forEach((m) => {
      window.FusionSplicerMachine.remove(m.id);
    });

    const m = window.FusionSplicerMachine.place(wx, wy);
    out.machineId = m.id;
    out.steps.push('place machine');

    const node = document.querySelector('[data-fusion-node="' + m.id + '"]');
    const frameEl = node && node.querySelector('iframe');
    if (frameEl) {
      frameEl.loading = 'eager';
      frameEl.scrollIntoView({ block: 'center', inline: 'center' });
    }

    async function waitBridge(id, ms = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const api = window.FusionSplicerMachine.getUI(id);
        if (api?.getState && api.hitTestGrooveHitbox) return api;
        if (frameEl?.contentWindow?.FusionSplicerUI) {
          frameEl.dispatchEvent(new Event('load'));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      return null;
    }

    const api = await waitBridge(m.id);
    if (!api) throw new Error('iframe bridge timeout');
    out.steps.push('iframe bridged');

    const slot = window.FusionSplicerMachine.getGrooveSlot(m.id, 'L');
    out.slot = slot;

    if (api.getState().clampsClosed.L) {
      api.toggleClampLid('L');
      await new Promise((r) => setTimeout(r, 400));
    }

    window.FtthLab.claimToolboxTool('sc-pigtail');
    window.FtthLab.beginDrag({ kind: 'pigtail' });
    const stage = document.getElementById('lab-canvas-2d');
    const z = window.FtthLab.getZoom2d();
    const pan = window.FtthLab.getPan2d();
    const sr = stage.getBoundingClientRect();
    const spawnX = slot.clampFaceX - 70;
    const spawnY = slot.workspaceEdgeY;
    const cx = sr.left + pan.x + spawnX * z;
    const cy = sr.top + pan.y + spawnY * z;
    const ev = new MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
    });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { getData: (k) => (k === 'text/lab-drag' ? 'pigtail' : '') },
    });
    document.getElementById('lab-2d-mount').dispatchEvent(ev);
    window.FtthLab.endDrag();
    await new Promise((r) => setTimeout(r, 500));

    const pigtailId = document.querySelector('[data-pt-node]')?.getAttribute('data-pt-node');
    if (!pigtailId) throw new Error('pigtail not placed');
    out.pigtailId = pigtailId;

    const stripLen = 120;
    window.FtthLab.commitPigtailStripPeelSession(pigtailId, 'jacket', { startAlong: stripLen });
    window.FtthLab.commitPigtailStripPeelSession(pigtailId, 'buffer', { startAlong: stripLen });
    window.FtthLab.commitPigtailStripStage(pigtailId);
    window.FtthLab.commitPigtailCleave(pigtailId);
    const ho = window.FtthLab.handoverPigtailToSplicerClamp(m.id, 'L', { animate: false });
    if (!ho?.ok) throw new Error('handover failed');
    out.steps.push('docked pt-1');

    // Zoom in on machine center for visible clamp + fiber
    const machineCx = sr.left + pan.x + m.x * z;
    const machineCy = sr.top + pan.y + m.y * z;
    if (window.FtthLab.zoom2dAt) {
      window.FtthLab.zoom2dAt(machineCx, machineCy, 1.75);
    } else {
      for (let i = 0; i < 5; i++) {
        stage.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: machineCx,
            clientY: machineCy,
            deltaY: -100,
          })
        );
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await new Promise((r) => setTimeout(r, 350));

    return out;
  });
}

async function getLidSamplePoint(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('lab-canvas-2d');
    const stageRect = stage.getBoundingClientRect();
    const iframe = document.querySelector('.lab-fusion-machine__frame');
    if (!iframe?.contentDocument) return { error: 'no iframe doc' };
    const lid = iframe.contentDocument.getElementById('clampLidL');
    if (!lid) return { error: 'no clampLidL' };
    const lidRect = lid.getBoundingClientRect();
    const clipLeft = Math.max(lidRect.left, stageRect.left);
    const clipRight = Math.min(lidRect.right, stageRect.right);
    const clipTop = Math.max(lidRect.top, stageRect.top);
    const clipBottom = Math.min(lidRect.bottom, stageRect.bottom);
    const cx = (clipLeft + clipRight) / 2;
    const cy = (clipTop + clipBottom) / 2;
    const m = window.FusionSplicerMachine.list()[0];
    return {
      viewportX: cx,
      viewportY: cy,
      stageLocalX: cx - stageRect.left,
      stageLocalY: cy - stageRect.top,
      lidRect: {
        left: lidRect.left,
        top: lidRect.top,
        width: lidRect.width,
        height: lidRect.height,
      },
      clampsClosed: window.FusionSplicerMachine.getUI(m.id).getState().clampsClosed,
    };
  });
}

async function auditFiberPaths(page, pigtailId) {
  return page.evaluate((pid) => {
    const svg = document.querySelector('.lab-pigtail-svg');
    if (!svg) return { error: 'no svg' };
    const wrap = svg.querySelector('[data-pt-fiber-wrap="' + pid + '"]');
    const selectors = [
      '[data-pt-drag="' + pid + '"]',
      '[data-pt-fiber="' + pid + '"]',
      '[data-pt-fiber-stripped="' + pid + '"]',
      '[data-pt-laser="' + pid + '"]',
      '[data-pt-ghost="' + pid + '"]',
    ];
    const nodes = [];
    selectors.forEach((sel) => {
      svg.querySelectorAll(sel).forEach((el) => {
        const cs = getComputedStyle(el);
        nodes.push({
          selector: sel,
          className: el.getAttribute('class'),
          inClipWrap: wrap ? wrap.contains(el) : false,
          stroke: cs.stroke,
          strokeWidth: cs.strokeWidth,
          opacity: cs.opacity,
          visibility: cs.visibility,
        });
      });
    });
    return {
      wrapExists: !!wrap,
      wrapClipPath: wrap?.getAttribute('clip-path') || null,
      nodes,
      unclippedVisible: nodes.filter(
        (n) =>
          !n.inClipWrap &&
          n.opacity !== '0' &&
          n.visibility !== 'hidden' &&
          n.stroke !== 'transparent' &&
          n.stroke !== 'rgba(0, 0, 0, 0)'
      ),
    };
  }, pigtailId);
}

async function shotStage(page, filename) {
  const path = join(OUT_DIR, filename);
  const stage = page.locator('#lab-canvas-2d');
  await stage.screenshot({ path, animations: 'disabled' });
  return path;
}

async function main() {
  const clipLogs = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    if (msg.text().includes('[splicer-clip]')) clipLogs.push(msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const setup = await setupScenario(page);
  await waitForWorkspace(page);
  await page.waitForTimeout(300);

  const api = await page.evaluate(() => {
    const m = window.FusionSplicerMachine.list()[0];
    return !!window.FusionSplicerMachine.getUI(m.id);
  });
  void api;

  // 1) Before close — lid open, fiber visible
  const beforePath = await shotStage(page, '01-before-lid-close.png');
  const sampleBefore = await getLidSamplePoint(page);
  let pixelBefore = null;
  if (sampleBefore.stageLocalX != null) {
    pixelBefore = samplePngPixel(beforePath, sampleBefore.stageLocalX, sampleBefore.stageLocalY);
  }

  // 2) Close lid — wait for animation
  await page.evaluate(() => {
    const m = window.FusionSplicerMachine.list()[0];
    const api = window.FusionSplicerMachine.getUI(m.id);
    if (!api.getState().clampsClosed.L) api.toggleClampLid('L');
  });
  await page.waitForTimeout(900);

  const closedPath = await shotStage(page, '02-lid-closed.png');
  const sampleClosed = await getLidSamplePoint(page);
  const pathAudit = await auditFiberPaths(page, setup.pigtailId);

  let pixelClosed = null;
  let pixelClosedLidElement = null;
  if (sampleClosed.stageLocalX != null) {
    pixelClosed = samplePngPixel(closedPath, sampleClosed.stageLocalX, sampleClosed.stageLocalY);
  }
  try {
    const lidBuf = await page
      .frameLocator('.lab-fusion-machine__frame')
      .locator('#clampLidL')
      .screenshot({ animations: 'disabled' });
    writeFileSync(join(OUT_DIR, '02-lid-element.png'), lidBuf);
    const lidPng = PNG.sync.read(lidBuf);
    const lcx = Math.floor(lidPng.width / 2);
    const lcy = Math.floor(lidPng.height / 2);
    const idx = (lidPng.width * lcy + lcx) << 2;
    pixelClosedLidElement = {
      x: lcx,
      y: lcy,
      r: lidPng.data[idx],
      g: lidPng.data[idx + 1],
      b: lidPng.data[idx + 2],
      hex: '#' + [lidPng.data[idx], lidPng.data[idx + 1], lidPng.data[idx + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join(''),
      distToFiberYellow: Math.round(
        colorDist(
          { r: lidPng.data[idx], g: lidPng.data[idx + 1], b: lidPng.data[idx + 2] },
          FIBER_YELLOW
        )
      ),
      isFiberYellow: isFiberYellow({
        r: lidPng.data[idx],
        g: lidPng.data[idx + 1],
        b: lidPng.data[idx + 2],
      }),
      isDarkLid:
        lidPng.data[idx] < 90 &&
        lidPng.data[idx + 1] < 90 &&
        lidPng.data[idx + 2] < 100,
    };
  } catch (err) {
    pixelClosedLidElement = { error: String(err) };
  }

  // 3) Re-open lid
  await page.evaluate(() => {
    const m = window.FusionSplicerMachine.list()[0];
    const api = window.FusionSplicerMachine.getUI(m.id);
    if (api.getState().clampsClosed.L) api.toggleClampLid('L');
  });
  await page.waitForTimeout(700);

  const openPath = await shotStage(page, '03-lid-reopened.png');

  const report = {
    setup,
    screenshots: {
      beforeClose: beforePath,
      lidClosed: closedPath,
      reopened: openPath,
    },
    lidSamplePoints: {
      beforeClose: sampleBefore,
      lidClosed: sampleClosed,
    },
    pixelOnLidCenter_whenClosed: pixelClosed
      ? {
          ...pixelClosed,
          distToFiberYellow: Math.round(colorDist(pixelClosed, FIBER_YELLOW)),
          isFiberYellow: isFiberYellow(pixelClosed),
          isDarkLid: pixelClosed.r < 90 && pixelClosed.g < 90 && pixelClosed.b < 100,
        }
      : null,
    pixelOnLidCenter_whenOpen: pixelBefore
      ? {
          ...pixelBefore,
          distToFiberYellow: Math.round(colorDist(pixelBefore, FIBER_YELLOW)),
          isFiberYellow: isFiberYellow(pixelBefore),
        }
      : null,
    pathAudit,
    clipLogs,
    pixelOnLidElement_whenClosed: pixelClosedLidElement,
    pass:
      pixelClosedLidElement &&
      !pixelClosedLidElement.error &&
      !pixelClosedLidElement.isFiberYellow &&
      pixelClosedLidElement.isDarkLid &&
      pathAudit.wrapExists === true,
  };

  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();

  if (!report.pass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
