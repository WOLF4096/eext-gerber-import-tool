// 前后对比冒烟测试：用真实 Chrome 分别加载「原单文件」与「拆分后」两个版本，
// 比对控制台错误、全局 API、渲染出的 DOM 文本、CSS 计算样式与画布像素。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = 'D:/Project/3LCEDA/API/导入Gerber/pro-api-sdk';
const BEFORE = path.join(ROOT, '.workbuddy/tmp/serve_before');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 注意：故意不给 .js/.css 下发 charset —— 模拟未知服务端，验证 BOM + 编码继承是否可靠
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };

function serve(root, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/iframe/ImportGerber.html';
      const f = path.join(root, p);
      fs.readFile(f, (e, d) => {
        if (e) { console.log('   [404] ' + p); rsp.writeHead(404); rsp.end('404'); return; }
        rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        rsp.end(d);
      });
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

async function probe(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const bad = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const cv = g('main-canvas');
    return {
      apis: ['switchTab', 'exportPDF', 'generateDebugSource', 'resetConfig', 'reparseFiles', 'setBoardType', 'stepVal', 'updateDpiUI']
        .reduce((o, k) => (o[k] = typeof window[k], o), {}),
      sidebarWidth: getComputedStyle(g('sidebar')).width,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim(),
      tabs: [...document.querySelectorAll('.tab-item')].map((e) => e.textContent.trim()),
      layerRows: g('layer-list-content').children.length,
      firstLayerText: (g('layer-list-content').textContent || '').replace(/\s+/g, ' ').slice(0, 80),
      tabTitles: [...document.querySelectorAll('.section-title')].map((e) => e.textContent.trim()).slice(0, 6),
      canvasW: cv.width, canvasH: cv.height,
      canvasPng: cv.toDataURL().length,
      bodyTextLen: document.body.innerText.length,
      disclaimer: getComputedStyle(g('disclaimer-modal')).display,
      dropZone: getComputedStyle(g('global-drop-zone')).display,
    };
  });
  await page.close();
  return { data, errors, bad };
}

(async () => {
  // 自动搭建「原版单文件」对照目录（原文件 + 第三方库）
  const bi = path.join(BEFORE, 'iframe');
  fs.mkdirSync(path.join(bi, 'js'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.workbuddy/tmp/ImportGerber.html.orig'), path.join(bi, 'ImportGerber.html'));
  for (const lib of ['jszip.min.js', 'jspdf.umd.min.js']) {
    fs.copyFileSync(path.join(ROOT, 'iframe', 'js', lib), path.join(bi, 'js', lib));
  }
  const s1 = await serve(ROOT, 8801);
  const s2 = await serve(BEFORE, 8802);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const before = await probe(browser, 'http://127.0.0.1:8802/iframe/ImportGerber.html');
  const after = await probe(browser, 'http://127.0.0.1:8801/iframe/ImportGerber.html');
  await browser.close();
  s1.close(); s2.close();

  let fail = 0;
  const cmp = (label, a, b) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (!ok) fail++;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}` + (ok ? '' : `\n        原版=${JSON.stringify(a)}\n        新版=${JSON.stringify(b)}`));
  };

  console.log('=== 控制台错误 / 失败请求 ===');
  console.log('  原版 errors:', before.errors.length ? before.errors : '无');
  console.log('  新版 errors:', after.errors.length ? after.errors : '无');
  console.log('  原版 4xx/5xx:', before.bad.length ? before.bad : '无');
  console.log('  新版 4xx/5xx:', after.bad.length ? after.bad : '无');
  // 等价性判据：新版的控制台错误集合不得多于原版
  cmp('控制台错误集合', before.errors, after.errors);
  cmp('失败请求集合', before.bad, after.bad);

  console.log('\n=== 渲染结果逐项比对 ===');
  cmp('window 全局 API 集合', before.data.apis, after.data.apis);
  cmp('侧栏宽度（CSS 生效）', before.data.sidebarWidth, after.data.sidebarWidth);
  cmp('body 背景色（CSS 变量生效）', before.data.bodyBg, after.data.bodyBg);
  cmp('强调色变量', before.data.accent, after.data.accent);
  cmp('Tab 标签', before.data.tabs, after.data.tabs);
  cmp('图层表格行数', before.data.layerRows, after.data.layerRows);
  cmp('图层表格首行文本（中文）', before.data.firstLayerText, after.data.firstLayerText);
  cmp('分区标题', before.data.tabTitles, after.data.tabTitles);
  cmp('画布尺寸', `${before.data.canvasW}x${before.data.canvasH}`, `${after.data.canvasW}x${after.data.canvasH}`);
  cmp('画布像素数据长度', before.data.canvasPng, after.data.canvasPng);
  cmp('body 可见文本长度', before.data.bodyTextLen, after.data.bodyTextLen);
  cmp('免责声明弹窗显示态', before.data.disclaimer, after.data.disclaimer);
  cmp('拖拽遮罩显示态', before.data.dropZone, after.data.dropZone);

  console.log('\n' + '='.repeat(60));
  if (fail) { console.log(`前后对比存在 ${fail} 项差异`); process.exit(1); }
  console.log('前后对比完全一致：拆分未改变任何功能与表现。');
})();
