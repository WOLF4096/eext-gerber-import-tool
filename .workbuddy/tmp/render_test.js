// 渲染基准测试：加载最小 Gerber，读取画布像素统计，用于比较改动前后的渲染结果。
// 用法: node render_test.js [标签]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = 'D:/Project/3LCEDA/API/导入Gerber/pro-api-sdk';
let FIXTURE = path.join(ROOT, '.workbuddy/tmp/fixtures/test.GTL');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LABEL = process.argv[2] || 'run';
const FIX = process.argv[3] || 'test.GTL';
const OUT = path.join(ROOT, '.workbuddy/tmp/render_' + LABEL + '.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };

function serve(root, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/iframe/ImportGerber.html';
      fs.readFile(path.join(root, p), (e, d) => {
        if (e) { rsp.writeHead(404); rsp.end('404'); return; }
        rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
        rsp.end(d);
      });
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

// 在页面内统计：整体非黑像素、图层色(#cc6633 橙)像素及其包围盒、以及画布完整 dataURL
const STATS_FN = `() => {
  const cv = document.getElementById('main-canvas');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, on = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const r = d[i], gg = d[i+1], b = d[i+2];
      if (r + gg + b > 30) n++;
      // 只挑橙色系（图层色），把灰白十字线排除掉
      if (r > 70 && r > gg + 35 && gg >= b) {
        on++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const url = cv.toDataURL();
  let h = 0;
  for (let i = 0; i < url.length; i++) { h = ((h << 5) - h + url.charCodeAt(i)) | 0; }
  return { count: n, orange: on, minX, minY, maxX, maxY, w: cv.width, h: cv.height,
           urlHash: h, urlLen: url.length,
           layers: loadedFiles.length,
           commands: loadedFiles.reduce((s, f) => s + (f.data && f.data.commands ? f.data.commands.length : 0), 0) };
}`;

(async () => {
  FIXTURE = path.join(ROOT, '.workbuddy/tmp/fixtures', FIX);
  const srv = await serve(ROOT, 8831);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });

  await page.goto('http://127.0.0.1:8831/iframe/ImportGerber.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 通过真实的文件输入框喂入 Gerber，走完整导入链路
  await page.setInputFiles('#file-input', FIXTURE);
  await page.waitForTimeout(900);

  const afterLoad = await page.evaluate(eval('(' + STATS_FN + ')'));
  const info = await page.evaluate(() => ({
    layerNames: loadedFiles.map((f) => f.name),
    layerIds: loadedFiles.map((f) => f.layerId),
    visible: loadedFiles.map((f) => f.visible),
    scale: viewState.scale,
    offsetX: viewState.offsetX,
    offsetY: viewState.offsetY,
  }));

  // 保存画布截图，便于肉眼核对渲染结果
  const dump = async (tag) => {
    const u = await page.evaluate(() => document.getElementById('main-canvas').toDataURL('image/png'));
    fs.writeFileSync(path.join(ROOT, '.workbuddy/tmp/render_' + LABEL + '_' + tag + '.png'), Buffer.from(u.split(',')[1], 'base64'));
  };
  await dump('load');

  // 平移 + 缩放后再测一次（针对"平移重画"这条优化）
  const afterPan = await page.evaluate(`(() => {
    // 用直接改视图状态 + requestDraw 的方式模拟平移/缩放，避免依赖鼠标事件时序
    viewState.offsetX += 60;
    viewState.offsetY += 40;
    requestDraw();
    return { ok: true };
  })()`);
  await page.waitForTimeout(400);
  const afterPanStats = await page.evaluate(eval('(' + STATS_FN + ')'));
  await dump('pan');

  await browser.close();
  srv.close();

  const result = { label: LABEL, fixture: FIX, errors: errs, info, afterLoad, panRafCalls: afterPan.rafCalls, afterPanStats };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[${LABEL}] 错误:`, errs.length ? errs : '无');
  console.log(`[${LABEL}] 图层:`, JSON.stringify(info.layerNames), 'ids=', JSON.stringify(info.layerIds));
  console.log(`[${LABEL}] 命令总数:`, afterLoad.commands, "scale=", info.scale, "offset=", info.offsetX, info.offsetY);
  console.log(`[${LABEL}] 载入后 非黑=${afterLoad.count} 图层色像素=${afterLoad.orange} 橙色包围盒=(${afterLoad.minX},${afterLoad.minY})-(${afterLoad.maxX},${afterLoad.maxY}) 画布=${afterLoad.w}x${afterLoad.h}`);
  console.log(`[${LABEL}] 载入后 dataURL 哈希=${afterLoad.urlHash} 长度=${afterLoad.urlLen}`);
  console.log(`[${LABEL}] 平移后 非黑=${afterPanStats.count} 图层色像素=${afterPanStats.orange} 橙色包围盒=(${afterPanStats.minX},${afterPanStats.minY})-(${afterPanStats.maxX},${afterPanStats.maxY}) dataURL哈希=${afterPanStats.urlHash}`);
  console.log(`[${LABEL}] 结果已写入 ${path.basename(OUT)}`);
})();
