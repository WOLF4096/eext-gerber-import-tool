// 空文档校验测试：注入一个假的 eda 全局对象，验证四种情况的守卫行为
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = 'D:/Project/3LCEDA/API/导入Gerber/pro-api-sdk';
const FIXTURE = path.join(ROOT, '.workbuddy/tmp/fixtures/test3.GTL');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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

const INIT = () => {
  window.__calls = [];
  window.__mode = 'nonempty';
  window.__confirmResult = false;
  const SRC_PRIMS = ['{"type":"DOCHEAD","docType":"PCB"}||{}',
    '{"type":"LAYER","layerId":1}||{}',
    '{"type":"RULE","id":"r1"}||{}',
    '{"type":"PAD","ticket":1}||{}',
    '{"type":"PAD","ticket":2}||{}',
    '{"type":"TRACK","ticket":3}||{}'].join('\n') + '\n';
  const SRC_BLANK = ['{"type":"DOCHEAD","docType":"PCB"}||{}',
    '{"type":"LAYER","layerId":1}||{}',
    '{"type":"RULE","id":"r1"}||{}'].join('\n') + '\n';
  const SRC_V2_PRIMS = ['["DOCTYPE","PCB","1.8"]', '["LAYER",1,"TOP"]', '["PAD","1",1,0,0]'].join('\n') + '\n';
  window.__srcs = { nonempty: SRC_PRIMS, blank: SRC_BLANK, v2: SRC_V2_PRIMS };
  window.eda = {
    sys_Environment: { getEditorCurrentVersion: () => '3.0.0' },
    sys_FileManager: {
      getDocumentSource: async () => {
        window.__calls.push('getDocumentSource');
        if (window.__mode === 'throw') throw new Error('没有权限调用');
        if (window.__mode === 'undef') return undefined;
        return window.__srcs[window.__mode];
      },
      setDocumentSource: async () => true
    },
    sys_Dialog: {
      showConfirmationMessage: (content, title, main, cancel, cb) => {
        window.__calls.push({ kind: 'confirm', content, title, main, cancel });
        setTimeout(() => cb(window.__confirmResult), 0);
      }
    }
  };
};

const log = (page) => page.evaluate(() => document.getElementById('debug-source-area').value);

(async () => {
  const srv = await serve(ROOT, 8841);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto('http://127.0.0.1:8841/iframe/ImportGerber.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.setInputFiles('#file-input', FIXTURE);
  await page.waitForTimeout(600);

  let fail = 0;
  const chk = (name, cond, extra) => {
    console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${cond ? '' : '   ' + JSON.stringify(extra)}`);
    if (!cond) fail++;
  };

  console.log('=== 1. 纯函数：文档源码图元计数 ===');
  const unit = await page.evaluate(() => {
    const f = countPrimitivesInDocumentSource;
    return {
      nullSrc: f(null),
      empty: f(''),
      blankV3: f('{"type":"DOCHEAD"}||{}\n{"type":"LAYER","layerId":1}||{}\n{"type":"RULE","id":"a"}||{}'),
      primsV3: f('{"type":"DOCHEAD"}||{}\n{"type":"PAD"}||{}\n{"type":"VIA"}||{}\n{"type":"TRACK"}||{}'),
      primsV2: f('["DOCTYPE","PCB","1.8"]\n["LAYER",1,"TOP"]\n["PAD","1",1,0,0]\n["LINE",1,0,0,1,1]'),
      blankV2: f('["DOCTYPE","PCB","1.8"]\n["LAYER",1,"TOP"]'),
      unknown: f('{"type":"SOMETHINGELSE"}||{}')
    };
  });
  chk('null 源码 → 0', unit.nullSrc === 0, unit);
  chk('空白 V3 文档（只有 DOCHEAD/LAYER/RULE）→ 0', unit.blankV3 === 0, unit);
  chk('V3 含 PAD/VIA/TRACK → 3', unit.primsV3 === 3, unit);
  chk('V2 含 PAD/LINE → 2', unit.primsV2 === 2, unit);
  chk('空白 V2 文档 → 0', unit.blankV2 === 0, unit);
  chk('未知类型不计入 → 0', unit.unknown === 0, unit);

  const run = async (mode, confirmResult) => {
    await page.evaluate(([m, c]) => {
      window.__mode = m;
      window.__confirmResult = c;
      window.__calls = [];
      document.getElementById('debug-source-area').value = '';
    }, [mode, confirmResult]);
    await page.evaluate(() => { try { handleExportToCanvas('source'); } catch (e) { window.__calls.push('exportThrew: ' + e.message); } });
    await page.waitForTimeout(450);
    return {
      calls: await page.evaluate(() => window.__calls),
      log: await log(page)
    };
  };

  console.log('\n=== 2. 当前文档非空 + 用户点「取消」 ===');
  let r = await run('nonempty', false);
  const dlg = r.calls.find((c) => c && c.kind === 'confirm');
  chk('弹出了确认框', !!dlg, r.calls);
  chk('提示里带出图元数量 3', !!dlg && /已存在 3 个图元/.test(dlg.content), dlg && dlg.content.slice(0, 60));
  chk('按钮文案为「仍然继续」/「取消」', !!dlg && dlg.main === '仍然继续' && dlg.cancel === '取消', dlg);
  chk('日志记录了「已取消导入」', /已取消导入/.test(r.log), r.log.slice(-120));
  chk('取消后没有再往下走（无导出异常）', !r.calls.some((c) => typeof c === 'string' && c.startsWith('exportThrew')), r.calls);

  console.log('\n=== 3. 当前文档非空 + 用户点「仍然继续」 ===');
  r = await run('nonempty', true);
  chk('弹出了确认框', !!r.calls.some((c) => c && c.kind === 'confirm'), r.calls);
  chk('未记录「已取消导入」', !/已取消导入/.test(r.log), r.log.slice(-120));

  console.log('\n=== 4. 当前文档是空白 → 应直接放行 ===');
  r = await run('blank', false);
  chk('没有弹出确认框', !r.calls.some((c) => c && c.kind === 'confirm'), r.calls);
  chk('未记录「已取消导入」', !/已取消导入/.test(r.log), r.log.slice(-120));

  console.log('\n=== 5. getDocumentSource 抛异常 → 放行且不拦路 ===');
  r = await run('throw', false);
  chk('没有弹出确认框', !r.calls.some((c) => c && c.kind === 'confirm'), r.calls);
  chk('日志说明已跳过校验', /空文档校验已跳过/.test(r.log), r.log.slice(-140));

  console.log('\n=== 6. getDocumentSource 返回 undefined → 放行 ===');
  r = await run('undef', false);
  chk('没有弹出确认框', !r.calls.some((c) => c && c.kind === 'confirm'), r.calls);

  console.log('\n=== 7. 无 eda 全局（浏览器直开）→ 放行 ===');
  const saved = await page.evaluate(() => { const s = window.eda; window.eda = undefined; window.__calls = []; document.getElementById('debug-source-area').value = ''; return !!s; });
  await page.evaluate(() => { try { handleExportToCanvas('source'); } catch (e) { window.__calls.push('exportThrew: ' + e.message); } });
  await page.waitForTimeout(400);
  const noEda = await page.evaluate(() => ({ calls: window.__calls, log: document.getElementById('debug-source-area').value }));
  chk('整体流程未崩溃', !noEda.calls.some((c) => typeof c === 'string' && c.startsWith('exportThrew')), noEda.calls);
  await page.evaluate((s) => { window.eda = s ? window.eda || undefined : undefined; }, saved);

  console.log('\n页面错误:', errs.length ? errs : '无');
  await browser.close();
  srv.close();
  console.log('\n' + '='.repeat(60));
  if (fail) { console.log(`失败 ${fail} 项`); process.exit(1); }
  console.log('空文档校验全部行为符合预期。');
})();
