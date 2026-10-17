// ====================================================================================
// 06-utils.js  —  通用工具函数
// ------------------------------------------------------------------------------------
// 职责：与业务无关、可被任意模块复用的基础函数。
//   mapNameToId / generateUUID / downloadBlobAsFile / downloadStringAsFile /
//   appLog / isGerberText / calculateMaxId / copyDebugSource / getEnvInfo
// 依赖：无（appLog 运行时访问 #debug-source-area，getEnvInfo 运行时访问 eda 全局对象）。
// 加载顺序：第 6 个
// ====================================================================================

// ====================================================================================
// 5. 辅助工具函数 (Utils)
// ====================================================================================

    // --- [新增] 辅助：将文件名中的层名 (Top, Bottom, Inner1...) 转为 ID ---
    function mapNameToId(nameStr) {
        if (!nameStr) return null;
        const upper = nameStr.toUpperCase();
        if (upper === 'TOP') return 1;
        if (upper === 'BOTTOM') return 2;
        // 匹配 Inner1, Inner2 ...
        const m = upper.match(/INNER(\d+)/);
        if (m) {
            return 14 + parseInt(m[1]); // Inner1 -> 15, Inner2 -> 16
        }
        return null;
    }

    // ----------------------------------------------------------------------------------
    // FPC 补强层（Stiffener）文件名解析
    // ------------------------------------------------------------------------------------
    // 嘉立创 EDAP 专业版导出：`Gerber_<Top|Bottom>StiffenerLayer_<材料码>_<厚度>.GTSL`
    // 实测（Temp/FPC：V2/V3/V4 源码与同板导出 Gerber 交叉比对，坐标逐一对应）：
    //   顶层 .GTSL                                  底层 .GBSL
    //   Gerber_TopStiffenerLayer_pit_0.2.GTSL    → Polyimide      0.2
    //   Gerber_TopStiffenerLayer_fr4t_0.2.GTSL   → FR4            0.2
    //   Gerber_TopStiffenerLayer_gpt_0.2.GTSL    → Stainless Steel 0.2
    //   Gerber_TopStiffenerLayer_pst_tesa8854.GTSL → TESA8854     0.1（文件名不带厚度）
    //   Gerber_TopStiffenerLayer_csa_0.018.GTSL  → EMI Shielding Film 0.018
    //   底层同名材料分别写作 pib / fr4b / gpb / psb_<型号> / ssa（实测，非简单 t→b 替换）
    // ⚠️ 材料码与材料名无法由缩写推导（gpt / csa / ssa 的含义不明），这张表是按样本反推的
    //    固定枚举。**未知材料码一律返回 null**，调用方退回普通填充（几何保留、材料不写），
    //    绝不猜一个材料名写进 FPC_FILL —— 材料写错比缺失更难发现。
    const STIFFENER_MATERIAL_CODES = {
        // 顶层（Top Stiffener, layer 58）
        pit: 'Polyimide',
        fr4t: 'FR4',
        gpt: 'Stainless Steel',
        csa: 'EMI Shielding Film',
        // 底层（Bottom Stiffener, layer 59）
        pib: 'Polyimide',
        fr4b: 'FR4',
        gpb: 'Stainless Steel',
        ssa: 'EMI Shielding Film'
    };
    const STIFFENER_DEFAULT_THICKNESS = 0.1;

    /**
     * 从补强层 Gerber 文件名解析材料与厚度。
     * @returns {{material:string, thickness:number}|null} 解析不出材料时返回 null
     */
    function parseStiffenerMeta(fileName) {
        const name = String(fileName || '');
        const m = name.match(/StiffenerLayer_(.+?)\.G[TB]SL$/i) ||
                  name.match(/StiffenerLayer_(.+)$/i);
        if (!m) return null;
        const parts = m[1].split('_').filter(Boolean);
        if (!parts.length) return null;
        let thickness = null;
        const last = parts[parts.length - 1];
        if (parts.length > 1 && /^\d+(\.\d+)?$/.test(last)) {
            thickness = parseFloat(last);
            parts.pop();
        }
        const code = parts.join('_').toLowerCase();
        let material = null;
        if (STIFFENER_MATERIAL_CODES[code]) {
            material = STIFFENER_MATERIAL_CODES[code];
        } else if (code.startsWith('pst_') || code.startsWith('psb_')) {
            // pst_<型号> / psb_<型号>：型号本身即材料名（tesa8854 → TESA8854）
            material = code.slice(4).toUpperCase();
        }
        if (!material) return null;
        return {
            material: material,
            thickness: (thickness === null) ? STIFFENER_DEFAULT_THICKNESS : thickness
        };
    }

    // --- [新增] UUID 生成辅助函数 (无连字符格式) ---
    function generateUUID() {        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // --- [新增] Blob 下载辅助函数 ---
    function downloadBlobAsFile(blob, fileName) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    /**
     * 轻量提示条（吐司）。
     * 优先用嘉立创EDA 原生吐司；不可用时退化成本页面的浮动提示，最后才用 alert。
     * @param {string} msg   提示内容
     * @param {'info'|'warn'|'error'|'success'} [type='info'] 类型
     */
    function showToast(msg, type) {
        const t = type || 'info';
        try {
            if (typeof eda !== 'undefined' && eda.sys_Message &&
                typeof eda.sys_Message.showToastMessage === 'function') {
                eda.sys_Message.showToastMessage(msg, t, 4);
                return;
            }
        } catch (e) { /* 原生吐司不可用，走下面的页面内提示 */ }

        let box = document.getElementById('app-toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'app-toast';
            document.body.appendChild(box);
        }
        box.className = 'app-toast app-toast-' + t + ' app-toast-show';
        box.textContent = msg;
        if (showToast._timer) clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => { box.classList.remove('app-toast-show'); }, 4000);
    }

    // --- [新增] 全局日志工具函数 ---
    /**
     * 运行日志：同时写入「运行日志」面板（侧栏，始终可见）与 DEBUG 文本框（隐藏面板）。
     * 说明：早先只有 #debug-source-area 一处出口，而它在 DEBUG 关闭时是 display:none —— 
     * 普通用户根本看不到日志，导入/导出期间只能盯着一个静态的转圈遮罩。
     */
    function appLog(msg) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${hh}:${min}:${ss}`;

        // ① 侧栏「运行日志」（用户可见，最多保留 200 行）
        const lines = document.getElementById('run-log-lines');
        if (lines) {
            const div = document.createElement('div');
            div.textContent = `${timeStr} ${msg}`;
            lines.appendChild(div);
            while (lines.childElementCount > 200) lines.removeChild(lines.firstChild);
            lines.scrollTop = lines.scrollHeight;
        }

        // ② DEBUG 文本框（保留原有出口，便于复制整段日志）
        const area = document.getElementById('debug-source-area');
        if (area) {
            area.value += `${timeStr} ${msg}\n`;
            area.scrollTop = area.scrollHeight;
        }
    }

    // --- 步骤 / 预计耗时（导入导出进度） ---
    // 统一口径：setStepStatus('生成图元 3/5', elapsedMs, etaMs)
    //   · 遮罩文字实时更新（用户看不到控制台，遮罩是唯一反馈）
    //   · 侧栏「运行日志」上方显示一行当前状态，避免遮罩遮挡时完全没信息
    let _stepT0 = 0;
    function stepBegin(label) {
        _stepT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        setStepStatus(label, 0, null);
        appLog('▶ ' + label);
    }
    function stepStatus(label, etaMs) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        setStepStatus(label, now - _stepT0, etaMs);
    }
    function stepEnd(label) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const ms = Math.round(now - _stepT0);
        setStepStatus(label + '（完成 ' + (ms / 1000).toFixed(ms < 1000 ? 2 : 1) + 's）', 0, 0);
        appLog('✓ ' + label + ` ${ms}ms`);
        return ms;
    }

    /** 把「当前步骤 + 已用 + 预计剩余」写到遮罩与侧栏状态行 */
    function setStepStatus(text, elapsedMs, etaMs) {
        let line = text || '';
        if (elapsedMs > 0) line += `（已用 ${(elapsedMs / 1000).toFixed(1)}s`;
        if (elapsedMs > 0 && etaMs > 0) line += `，预计剩余 ${(etaMs / 1000).toFixed(0)}s`;
        if (elapsedMs > 0) line += '）';

        const st = document.getElementById('run-step');
        if (st) st.textContent = line;

        const overlay = document.getElementById('loading-overlay');
        if (overlay && overlay.style.display !== 'none') overlay.textContent = line;
        return line;
    }

    /** 收起 / 展开运行日志（侧栏空间有限） */
    function toggleRunLog() {
        const lines = document.getElementById('run-log-lines');
        const t = document.getElementById('run-log-toggle');
        if (!lines || !t) return;
        const hidden = lines.style.display === 'none';
        lines.style.display = hidden ? 'block' : 'none';
        t.textContent = hidden ? '收起' : '展开';
    }

    // --- 大数据量导入确认（>500KB 走「通过源码导入」前弹窗） ---
    const HEAVY_IMPORT_BYTES = 500 * 1024;
    /** 当前已加载 Gerber 的总字节数（按文本长度估算，含所有图层） */
    function loadedGerberBytes() {
        if (typeof rawFilesCache === 'undefined' || !rawFilesCache) return 0;
        let n = 0;
        rawFilesCache.forEach(f => { n += (f.content ? f.content.length : 0); });
        return n;
    }
    /**
     * 粗估「生成图元 + 物理网络」耗时（毫秒）。
     * 依据实测：1.6MB 的 Gerber（3.6k 焊盘 / 6.8k 导线 / 1.3k 填充）≈ 8s；
     * 关闭「生成网络」时只剩图元生成 ≈ 1.5s/MB。
     * 只用于给用户一个「大概要等多久」，不做精确承诺。
     */
    function estimateExportMs() {
        const mb = loadedGerberBytes() / 1024 / 1024;
        const netEl = document.getElementById('cfg-netlist');
        const netOn = !!(netEl && netEl.checked);
        return Math.max(300, Math.round(mb * (netOn ? 5000 : 1500)));
    }

    /**
     * 弹出「数据量较大」确认框，返回 Promise<boolean>：
     * 用户点【继续导入】→ true；点【关闭】/ 点遮罩 → false。
     */
    function confirmHeavyImport(bytes) {
        return new Promise(resolve => {
            const modal = document.getElementById('heavy-import-modal');
            const text = document.getElementById('heavy-import-text');
            if (!modal) { resolve(true); return; }
            const mb = (bytes / 1024 / 1024);
            if (text) {
                text.textContent = `本次 Gerber 数据约 ${(bytes / 1024).toFixed(0)} KB（${mb >= 1 ? mb.toFixed(1) + ' MB' : '<1 MB'}），`
                    + `图元数量较多，写入画布可能需要几十秒，期间界面会卡住。`;
            }
            modal.style.display = 'flex';
            window.resolveHeavyImport = (ok) => {
                modal.style.display = 'none';
                window.resolveHeavyImport = null;
                resolve(!!ok);
            };
        });
    }


    // ----------------------------------------------------------------------------------
    // 文件过滤：扩展名黑名单 + 内容特征探测
    // ----------------------------------------------------------------------------------
    // 生成器自带的说明文件、报告文件、嵌套压缩包等都会被当成 Gerber 解析，
    // 轻则多出垃圾图层，重则（二进制内容里出现 D4 之类字节）让整个导入崩溃。
    // 因此这里同时从「扩展名」和「内容特征」两个方向拦截。

    // 明确不是 Gerber 的扩展名
    var NON_GERBER_EXT = {
        zip: 1, rar: 1, '7z': 1, gz: 1, tar: 1, bz2: 1, xz: 1,
        json: 1, xml: 1, html: 1, htm: 1,
        png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, webp: 1, svg: 1, ico: 1,
        pdf: 1, doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1,
        csv: 1, md: 1, log: 1, err: 1, rpt: 1, rep: 1,
        exe: 1, dll: 1, so: 1, dylib: 1, ttf: 1, otf: 1, woff: 1, woff2: 1, eot: 1,
        epro: 1, epro2: 1, epcb: 1, epru: 1, pcbdoc: 1, schdoc: 1, dsn: 1, ses: 1,
        bak: 1, tmp: 1, ini: 1, cfg: 1, conf: 1, db: 1, sqlite: 1, sqlite3: 1
    };

    // 内容特征探测：只有真的含 Gerber / 钻孔特征标记才放行
    function looksLikeGerberContent(content) {
        if (typeof content !== 'string' || content.length === 0) return false;

        // 1) ZIP 魔数（压缩包内套压缩包）
        if (content.charCodeAt(0) === 0x50 && content.charCodeAt(1) === 0x4B) return false;

        // 2) 二进制探测：出现 NUL，或不可打印字符占比过高
        const scanLen = Math.min(content.length, 4096);
        let bad = 0;
        for (let i = 0; i < scanLen; i++) {
            const c = content.charCodeAt(i);
            if (c === 0) return false;
            if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad++;
        }
        if (bad > scanLen * 0.02) return false;

        // 3) 特征标记（只看前 64KB 足够判断）
        const head = content.slice(0, 65536);
        return (
            /%(?:FS|MO|AD|AM|LN|TF|TA|TO|SR|IP|IN|IC|OF|AS|MI)/i.test(head) ||   // 扩展指令
            /(?:^|[\r\n])\s*G0?[0-4]\b/.test(head) ||                              // G01~G04 / M48 语法块
            /(?:^|[\r\n])\s*M0?[248]\b/.test(head) ||                              // M02 / M30 / M48
            /(?:^|[\r\n])\s*T\d+\s*C[\d.]+/i.test(head) ||                          // 钻孔刀具定义
            /(?:^|[\r\n])\s*X[-+]?\d+(?:\.\d+)?Y[-+]?\d+/.test(head) ||             // 坐标系指令
            /D0?[123]\s*\*/.test(head) ||                                          // D01/D02/D03 操作码
            /%FS[LTAI]*[XY]\d\d/i.test(head)                                       // 格式声明
        );
    }

    // ----------------------------------------------------------------------------------
    // 光圈宏（%AM）求值与几何化
    // ----------------------------------------------------------------------------------
    // 现实里的宏几乎都是「参数化」的：宏体里写 $1/$2…，真正的数值来自
    // %ADDnn<宏名>,aXbXc*% 的光圈参数。P-CAD / 嘉立创 / EasyEDA Pro 都这么写，
    // 所以必须支持 $n 代入与 + - * / 运算（Gerber 里 X 也是乘号）。
    // 这里用递归下降手写求值，不用 new Function —— 编辑器 iframe 的 CSP 可能禁用 eval。

    function evalGerberMacroExpr(expr, vars) {
        let s = String(expr === null || expr === undefined ? '' : expr).trim();
        if (!s) return NaN;
        s = s.replace(/\$(\d+)/g, (m, idx) => {
            const v = (vars && vars[Number(idx) - 1] !== undefined) ? vars[Number(idx) - 1] : 0;
            return (typeof v === 'number' && isFinite(v)) ? String(v) : '0';
        });
        s = s.replace(/[xX]/g, '*').replace(/\s+/g, '');
        if (!/^[-+*/().\d]+$/.test(s)) return NaN;

        let pos = 0;
        const peek = () => s[pos];
        const parseExpr = () => {
            let v = parseTerm();
            while (peek() === '+' || peek() === '-') { const op = s[pos++]; const r = parseTerm(); v = op === '+' ? v + r : v - r; }
            return v;
        };
        const parseTerm = () => {
            let v = parseFactor();
            while (peek() === '*' || peek() === '/') { const op = s[pos++]; const r = parseFactor(); v = op === '*' ? v * r : (r === 0 ? NaN : v / r); }
            return v;
        };
        const parseFactor = () => {
            if (peek() === '+') { pos++; return parseFactor(); }
            if (peek() === '-') { pos++; return -parseFactor(); }
            if (peek() === '(') { pos++; const v = parseExpr(); if (peek() === ')') pos++; return v; }
            const start = pos;
            while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
            if (pos === start) { pos = s.length; return NaN; }
            return parseFloat(s.slice(start, pos));
        };
        const out = parseExpr();
        return (pos === s.length && isFinite(out)) ? out : NaN;
    }

    // 把宏定义 + 光圈参数解析为可绘制的基元列表
    // 返回 { type:'POLYGON', points, prims } 或 { type:'MACRO', prims }；解析不出返回 null
    function resolveApertureMacro(def, params) {
        if (!def) return null;
        if (def.type === 'POLYGON' && Array.isArray(def.points) && def.points.length) {
            return { type: 'POLYGON', points: def.points, prims: def.prims || null };
        }
        if (def.type === 'MACRO' && Array.isArray(def.prims)) return def;
        if (def.type !== 'MACRO_DEF' || !Array.isArray(def.blocks)) return null;

        const vars = Array.isArray(params) ? params : [];
        const prims = [];
        def.blocks.forEach((b) => {
            if (!b || b.code === null || b.code === undefined) return;
            const a = (b.args || []).map((t) => evalGerberMacroExpr(t, vars));
            if (!a.length || a.some((v) => !isFinite(v))) return;
            const exposure = a[0] !== 0 ? 'D' : 'C';
            const num = (i, d) => (typeof a[i] === 'number' && isFinite(a[i]) ? a[i] : d);
            const code = b.code;

            if (code === 1) {
                prims.push({ code, exposure, kind: 'circle', dia: num(1, 0), cx: num(2, 0), cy: num(3, 0), rot: num(4, 0) });
            } else if (code === 4) {
                const n = Math.max(0, Math.floor(num(1, 0)));
                const points = [];
                for (let i = 0; i < n; i++) {
                    const x = a[2 + i * 2], y = a[3 + i * 2];
                    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) points.push({ x, y });
                }
                if (points.length >= 3) prims.push({ code, exposure, kind: 'poly', points });
            } else if (code === 5) {
                const n = Math.max(0, Math.floor(num(1, 0)));
                const cx = num(2, 0), cy = num(3, 0), dia = num(4, 0), rot = num(5, 0);
                const points = [];
                for (let i = 0; i < n; i++) {
                    const ang = (rot + i * 360 / n) * Math.PI / 180;
                    points.push({ x: cx + Math.cos(ang) * dia / 2, y: cy + Math.sin(ang) * dia / 2 });
                }
                if (points.length >= 3) prims.push({ code, exposure, kind: 'poly', points });
            } else if (code === 20) {
                prims.push({ code, exposure, kind: 'line', w: num(1, 0), x1: num(2, 0), y1: num(3, 0), x2: num(4, 0), y2: num(5, 0), rot: num(6, 0) });
            } else if (code === 21 || code === 22) {
                prims.push({ code, exposure, kind: 'rect', cx: num(3, 0), cy: num(4, 0), w: num(1, 0), h: num(2, 0), rot: num(5, 0), round: code === 22 ? 1 : 0 });
            }
            // 6 (Moiré) / 7 (Thermal) 等复杂基元跳过
        });
        if (!prims.length) return null;
        if (prims.length === 1 && prims[0].kind === 'poly') {
            return { type: 'POLYGON', points: prims[0].points, prims };
        }
        return { type: 'MACRO', prims };
    }

    // 把宏基元转成「中心在 (cx,cy)、已换算到 mm」的路径（**朴素版，不做布尔运算**）。
    // 背景：Gerber 宏里多个「暗基元」在几何上是**并集**关系，但朴素实现把它们当成
    // 同一条路径的子路径交给 fill('evenodd')，重叠部分会被 XOR 成孔洞 ——
    // EasyEDA 专业版的 RoundRect 宏（4 个圆角 + 4 条边线 + 1 个外框矩形）就会渲染成
    // 「中间被挖掉楔形缺口」的破孔焊盘。所以这里只作为 Clipper 不可用时的兜底保留，
    // 正常路径走 macroPrimsToPath()（先并集后差集）。清基元（exposure === 'C'）在兜底
    // 模式下仍放进路径，靠 fill('evenodd') 形成孔洞。
    function macroPrimsToPathNaive(shape, cx, cy, scale) {
        const out = [];
        if (!shape || !Array.isArray(shape.prims)) return out;
        const sc = (typeof scale === 'number' && isFinite(scale)) ? scale : 1;
        const sx = (v) => cx + v * sc, sy = (v) => cy + v * sc;

        shape.prims.forEach((p) => {
            if (p.kind === 'circle') {
                const r = Math.abs(p.dia) * sc / 2;
                if (!(r > 0)) return;
                const px = sx(p.cx), py = sy(p.cy);
                out.push({ cmd: 'M', x: px - r, y: py });
                out.push({ cmd: 'A', x: px + r, y: py, i: r, j: 0, mode: 3, startX: px - r, startY: py });
                out.push({ cmd: 'A', x: px - r, y: py, i: -r, j: 0, mode: 3, startX: px + r, startY: py });
            } else if (p.kind === 'poly') {
                if (!Array.isArray(p.points) || p.points.length < 3) return;
                p.points.forEach((pt, i) => {
                    out.push(i === 0 ? { cmd: 'M', x: sx(pt.x), y: sy(pt.y) } : { cmd: 'L', x: sx(pt.x), y: sy(pt.y) });
                });
                out.push({ cmd: 'L', x: sx(p.points[0].x), y: sy(p.points[0].y) });
            } else if (p.kind === 'rect') {
                const hw = p.w * sc / 2, hh = p.h * sc / 2;
                const rad = (p.rot || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
                const bx = sx(p.cx), by = sy(p.cy);
                const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
                const startIdx = out.length;
                corners.forEach(([x, y], i) => {
                    const X = bx + x * cos - y * sin, Y = by + x * sin + y * cos;
                    out.push(i === 0 ? { cmd: 'M', x: X, y: Y } : { cmd: 'L', x: X, y: Y });
                });
                out.push({ cmd: 'L', x: out[startIdx].x, y: out[startIdx].y });
            } else if (p.kind === 'line') {
                const rad = (p.rot || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
                const rot = (x, y) => [x * cos - y * sin, x * sin + y * cos];
                const [ax, ay] = rot(p.x1, p.y1), [bx2, by2] = rot(p.x2, p.y2);
                const dx = bx2 - ax, dy = by2 - ay, len = Math.sqrt(dx * dx + dy * dy);
                if (!(len > 0)) return;
                const hw = Math.abs(p.w) * sc / 2;
                const nx = -dy / len * hw, ny = dx / len * hw;
                const startIdx = out.length;
                [[ax, ay], [bx2, by2]].forEach(([x, y]) => {
                    out.push({ cmd: 'M', x: sx(x) + nx, y: sy(y) + ny });
                    out.push({ cmd: 'L', x: sx(x) - nx, y: sy(y) - ny });
                });
                out.push({ cmd: 'L', x: out[startIdx].x, y: out[startIdx].y });
            }
        });
        return out;
    }

    // --- 宏基元的布尔运算（暗基元并集、清基元差集）---
    // 缓存：同一光圈（类型 + 参数 + 倍率）会被闪绘成百上千次，环只需算一次。
    const _macroRingCache = new Map();

    /** 圆 → 折线环（相对坐标，mm） */
    function macroCircleRing(cx, cy, r) {
        const tol = Math.max(r * 0.01, 0.0005);
        const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
        const n = Math.max(12, Math.min(72, Math.ceil(2 * Math.PI / Math.max(step, 0.05))));
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = 2 * Math.PI * i / n;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
    }

    /** 单个宏基元 → 折线环（相对坐标，已乘 scale），无法构成面时返回 null */
    function macroPrimRing(p, sc) {
        if (!p) return null;
        if (p.kind === 'circle') {
            const r = Math.abs(p.dia) * sc / 2;
            if (!(r > 0)) return null;
            return macroCircleRing(p.cx * sc, p.cy * sc, r);
        }
        if (p.kind === 'poly') {
            if (!Array.isArray(p.points) || p.points.length < 3) return null;
            return p.points.map(pt => [pt.x * sc, pt.y * sc]);
        }
        if (p.kind === 'rect') {
            const hw = p.w * sc / 2, hh = p.h * sc / 2;
            const rad = (p.rot || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
            const bx = p.cx * sc, by = p.cy * sc;
            return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) =>
                [bx + x * cos - y * sin, by + x * sin + y * cos]);
        }
        if (p.kind === 'line') {
            const rad = (p.rot || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
            const rot = (x, y) => [x * cos - y * sin, x * sin + y * cos];
            const [ax, ay] = rot(p.x1, p.y1), [bx2, by2] = rot(p.x2, p.y2);
            const dx = bx2 - ax, dy = by2 - ay, len = Math.sqrt(dx * dx + dy * dy);
            if (!(len > 0)) return null;
            const hw = Math.abs(p.w) * sc / 2;
            const nx = -dy / len * hw, ny = dx / len * hw;
            return [[ax + nx, ay + ny], [bx2 + nx, by2 + ny], [bx2 - nx, by2 - ny], [ax - nx, ay - ny]]
                .map(([x, y]) => [x * sc, y * sc]);
        }
        return null;
    }

    /**
     * 宏基元 → 轮廓环数组（**已按 Gerber 语义做布尔运算**：暗基元并集 − 清基元）。
     * @returns {Array<Array<[number,number]>>|null} 相对中心、已乘 sc 的 mm 环；无法计算返回 null
     */
    function macroBuildRings(shape, sc) {
        const dark = [], clear = [];
        // Clipper 约定：同一批 subject 里**方向相反**的多边形会被当成孔洞做减法。
        // 而宏基元的方向是随机的（圆/矩形按逆时针给点，线段生成的四边形是顺时针），
        // 所以必须先统一成同一方向（这里统一为逆时针），否则圆角会被整块挖掉。
        const add = (arr, pts) => {
            if (!pts) return;
            const p = fillDropDupes(pts);
            if (p.length < 3 || Math.abs(fillRingArea(p)) <= FILL_AREA_EPS) return;
            if (fillRingArea(p) < 0) fillReverseRing(p);
            arr.push(p);
        };
        shape.prims.forEach(p => add((p.exposure === 'C') ? clear : dark, macroPrimRing(p, sc)));
        if (!dark.length) return clear.length ? [] : null;

        let rings = dark;
        try {
            const cpr = new ClipperLib.Clipper();
            cpr.AddPaths(dark.map(fillToIntPath), ClipperLib.PolyType.ptSubject, true);
            const tree = new ClipperLib.PolyTree();
            if (!cpr.Execute(ClipperLib.ClipType.ctUnion, tree,
                ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) return null;
            rings = macroTreeToRings(tree);

            if (clear.length) {
                const cpr2 = new ClipperLib.Clipper();
                cpr2.AddPaths(rings.map(fillToIntPath), ClipperLib.PolyType.ptSubject, true);
                cpr2.AddPaths(clear.map(fillToIntPath), ClipperLib.PolyType.ptClip, true);
                const tree2 = new ClipperLib.PolyTree();
                if (cpr2.Execute(ClipperLib.ClipType.ctDifference, tree2,
                    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
                    rings = macroTreeToRings(tree2);
                }
            }
        } catch (e) {
            console.warn('宏基元布尔运算异常，回退为朴素路径:', e);
            return null;
        }
        return rings;
    }

    /** Clipper PolyTree → 环数组（外环在前，孔洞在后） */
    function macroTreeToRings(tree) {
        const outers = [], holes = [];
        const walk = (node) => {
            const kids = node.Childs();
            for (let i = 0; i < kids.length; i++) {
                const c = kids[i];
                const contour = c.Contour();
                if (contour && contour.length >= 3) {
                    const pts = fillDropDupes(fillFromIntPath(contour));
                    if (pts.length >= 3 && Math.abs(fillRingArea(pts)) > FILL_AREA_EPS) {
                        if (c.IsHole()) holes.push(pts); else outers.push(pts);
                    }
                }
                walk(c);
            }
        };
        walk(tree);
        return outers.concat(holes);
    }

    /**
     * 把宏基元转成「中心在 (cx,cy)、已换算到 mm」的路径（**对外统一入口**）。
     * 优先用 Clipper 求「暗并集 − 清差集」的正确轮廓；Clipper 不可用时回退朴素路径。
     * @param {string} [cacheKey] 光圈标识（类型+参数），用于缓存布尔结果
     */
    function macroPrimsToPath(shape, cx, cy, scale, cacheKey) {
        if (!shape || !Array.isArray(shape.prims) || !shape.prims.length) return [];
        const sc = (typeof scale === 'number' && isFinite(scale)) ? scale : 1;
        if (typeof fillClipperReady === 'function' && fillClipperReady()) {
            const key = cacheKey ? (cacheKey + '|' + sc) : null;
            let rings;
            if (key && _macroRingCache.has(key)) {
                rings = _macroRingCache.get(key);
            } else {
                try { rings = macroBuildRings(shape, sc); } catch (e) { rings = null; }
                if (key && rings) _macroRingCache.set(key, rings);
            }
            if (rings && rings.length) {
                const out = [];
                rings.forEach(ring => {
                    if (!ring || ring.length < 3) return;
                    out.push({ cmd: 'M', x: cx + ring[0][0], y: cy + ring[0][1] });
                    for (let i = 1; i < ring.length; i++) out.push({ cmd: 'L', x: cx + ring[i][0], y: cy + ring[i][1] });
                    out.push({ cmd: 'L', x: cx + ring[0][0], y: cy + ring[0][1] });
                });
                if (out.length) return out;
            }
        }
        return macroPrimsToPathNaive(shape, cx, cy, scale);
    }

    // ----------------------------------------------------------------------------------
    // 飞针测试文件（FlyingProbeTesting.json）→ 引脚 / 元件索引与焊盘匹配
    // ----------------------------------------------------------------------------------
    // 该文件由嘉立创EDA导出：lengthUnit 声明坐标单位（实测为 mil），字段名写在 fields 里。
    // 经验（2026-10-16 实测）：引脚坐标 **不一定落在焊盘几何中心** —— 异形/多边形焊盘
    // 的引入点常偏在一侧（开关类焊盘实测偏 27mil）。所以匹配分两级：
    //   ① 引脚与焊盘中心重合（绝大多数规则焊盘）
    //   ② 引脚落在焊盘包围盒内（异形/大焊盘），取离中心最近的引脚
    // 画布标注（09-ui.js）与标准版导出（08-export.js）共用这套逻辑，保证「所见即所导」。

    /**
     * 飞针文件里的「占位焊盘」判定。
     * 嘉立创导出的飞针文件会把「不属于任何元件的孤立焊盘」也当成一个元件登记，
     * 名字形如 PAD / PAD1 / PAD23 —— 这类名字只表示焊盘本身，既不是元件位号、
     * 也不是有意义的引脚号，画布与导出都一律不显示。
     */
    function isFlyingPadPlaceholder(text) {
        return /^pad\d*$/i.test(String(text == null ? '' : text).trim());
    }

    /**
     * 解析飞针数据，返回：
     *   pins : [{ x, y, num, comp, name, net, isPadOnly }] —— 坐标单位 **mil**（匹配时用 PadTool.toMil 对齐）
     *   comps: [{ x, y, ref, isPadOnly }]                  —— 坐标单位 **mm**（画布上直接当世界坐标用）
     * 坐标单位由文件顶层的 lengthUnit 决定（实测为 mil），这里统一归一化，
     * 免得调用方各自记一套换算式。
     */
    function buildFlyingPinIndex(fp) {
        const out = { pins: [], comps: [] };
        if (!fp) return out;
        // 归一化倍率：文件单位 → mil / mm
        const lu = String(fp.lengthUnit || 'mil').toLowerCase();
        const kPin = (lu === 'mm' || lu === 'metric') ? (1 / 0.0254) : ((lu === 'inch' || lu === 'in') ? 1000 : 1);
        const kComp = (lu === 'mm' || lu === 'metric') ? 1 : ((lu === 'inch' || lu === 'in') ? 25.4 : 0.0254);
        try {
            const pins = fp.pins;
            if (pins && Array.isArray(pins.rows) && Array.isArray(pins.fields)) {
                const f = pins.fields;
                const iName = f.indexOf('PIN_NAME');
                const iX = f.indexOf('PIN_X');
                const iY = f.indexOf('PIN_Y');
                const iNet = f.indexOf('NET_NAME');
                if (iX >= 0 && iY >= 0) {
                    pins.rows.forEach(row => {
                        const rx = parseFloat(row[iX]);
                        const ry = parseFloat(row[iY]);
                        if (!isFinite(rx) || !isFinite(ry)) return;
                        const full = String(iName >= 0 ? (row[iName] || '') : '');
                        // PIN_NAME 形如 C1_1（元件名_引脚号），取最后一段作引脚号
                        const cut = full.lastIndexOf('_');
                        const comp = cut > 0 ? full.substring(0, cut) : '';
                        const num = cut > 0 ? full.substring(cut + 1) : full;
                        out.pins.push({
                            x: rx * kPin, y: ry * kPin,
                            num: num,
                            comp: comp,
                            name: full,
                            net: iNet >= 0 ? String(row[iNet] || '') : '',
                            // 孤立焊盘（PAD / PAD1 / PAD23…）：名字只是占位，不当作引脚号显示
                            isPadOnly: isFlyingPadPlaceholder(comp) || isFlyingPadPlaceholder(num)
                        });
                    });
                }
            }
            const comps = fp.components;
            if (comps && Array.isArray(comps.rows) && Array.isArray(comps.fields)) {
                const f = comps.fields;
                const iName = f.indexOf('COMPONENT_NAME');
                const iX = f.indexOf('X_COORDINATE');
                const iY = f.indexOf('Y_COORDINATE');
                if (iName >= 0 && iX >= 0 && iY >= 0) {
                    comps.rows.forEach(row => {
                        const rx = parseFloat(row[iX]);
                        const ry = parseFloat(row[iY]);
                        const ref = String(row[iName] || '');
                        if (!isFinite(rx) || !isFinite(ry) || !ref) return;
                        out.comps.push({
                            x: rx * kComp, y: ry * kComp, ref: ref,
                            isPadOnly: isFlyingPadPlaceholder(ref)
                        });
                    });
                }
            }
        } catch (e) { console.error('飞针数据解析失败:', e); }
        return out;
    }

    /**
     * 焊盘用于匹配的包围盒（mm）。
     * 多边形焊盘（宏光圈 / G36 区域）的 w/h 恒为 0，尺寸只在 path 包围盒里。
     */
    function padMatchBoxMM(prim) {
        if (!prim) return null;
        if (prim.shape === 'POLYGON' && Array.isArray(prim.path) && prim.path.length) {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            prim.path.forEach(pt => {
                if (typeof pt.x !== 'number' || !isFinite(pt.x)) return;
                if (pt.x < x0) x0 = pt.x;
                if (pt.x > x1) x1 = pt.x;
                if (pt.y < y0) y0 = pt.y;
                if (pt.y > y1) y1 = pt.y;
            });
            if (isFinite(x0) && x1 > x0 && y1 > y0) return { x0: x0, x1: x1, y0: y0, y1: y1 };
        }
        if (prim.w > 0 && prim.h > 0) {
            const hw = prim.w / 2, hh = prim.h / 2;
            return { x0: prim.x - hw, x1: prim.x + hw, y0: prim.y - hh, y1: prim.y + hh };
        }
        return null;
    }

    /**
     * 按坐标给焊盘匹配飞针引脚。
     * @param index  buildFlyingPinIndex() 的返回值
     * @param xMM/yMM 焊盘中心（mm）
     * @param boxMM  焊盘包围盒（mm，可空）
     * @returns 命中的引脚对象，或 null
     */
    function flyingPinAt(index, xMM, yMM, boxMM) {
        if (!index || !index.pins || !index.pins.length) return null;
        const px = PadTool.toMil(xMM), py = PadTool.toMil(yMM);
        const tol = 2.5;   // mil，与既有专业版图元生成保持一致
        const near = index.pins.find(pt => Math.abs(pt.x - px) < tol && Math.abs(pt.y - py) < tol);
        if (near) return near;
        if (boxMM) {
            const x0 = PadTool.toMil(boxMM.x0), x1 = PadTool.toMil(boxMM.x1);
            const y0 = PadTool.toMil(boxMM.y0), y1 = PadTool.toMil(boxMM.y1);
            let best = null;
            index.pins.forEach(pt => {
                if (pt.x < x0 - tol || pt.x > x1 + tol || pt.y < y0 - tol || pt.y > y1 + tol) return;
                const dd = Math.hypot(pt.x - px, pt.y - py);
                if (!best || dd < best.d) best = { d: dd, pin: pt };
            });
            if (best) return best.pin;
        }
        return null;
    }

    // 判断是否为 Gerber 文件（name 必填，content 可选；给了 content 会做内容探测）
    function isGerberText(name, content) {
        const fileName = String(name || '');
        const lower = fileName.toLowerCase();
        const dot = lower.lastIndexOf('.');
        const ext = dot >= 0 ? lower.slice(dot + 1) : '';

        if (NON_GERBER_EXT[ext]) return false;

        // 说明文件 / 报告文件的文件名特征
        if (/(readme|必读|说明|下单|注意事项|license|changelog)/i.test(lower)) return false;

        // 未提供内容时按扩展名放行（保持旧行为，供无法读取内容的调用点使用）
        if (typeof content !== 'string') return ext !== 'json' && ext !== 'png' && ext !== 'jpg' && ext !== 'pdf' && ext !== 'doc';

        return looksLikeGerberContent(content);
    }

    // ----------------------------------------------------------------------------------
    // 格式声明解析：从 %FS / G04 注释 / 钻孔文件头读取单位与整数·小数位数
    // ----------------------------------------------------------------------------------
    // Gerber 家族里，单位和坐标格式有三种声明位置：
    //   1. 扩展指令  %FSLAX36Y36*%   %MOIN*%
    //   2. G04 注释  「3 integers and 6 decimals」「Dimensions in inches」「Numeric Format: 4.4」
    //   3. 钻孔文件头 METRIC,LZ,000.00000 / ;FILE_FORMAT=2:4 / ; Format: 2.4 (00.0000)
    // 之前只认第 1 种且还要求复数「integers/decimals」，导致大量文件退回默认精度。
    function detectGerberDeclarations(content) {
        const out = {
            gInt: null, gDec: null, gDeclared: false, gUnits: null,
            dInt: null, dDec: null, dDeclared: false, dUnits: null,
            legacy274d: false, x2: false, x3: false
        };
        if (typeof content !== 'string' || !content) return out;
        const head = content.slice(0, 65536);

        // ---------- 代际特征（供处理模式识别复用）----------
        if (/%TF\.|%TA\.|%TO\./.test(head)) out.x2 = true;
        if (/%TO\.C[,.]|%TO\.N[,.]|%TO\.P[,.]/.test(head)) out.x3 = true;

        // ---------- 1. 扩展指令 ----------
        const fs = head.match(/%FS[LTAI]*X(\d)(\d)Y(\d)(\d)/i);
        if (fs) {
            out.gInt = parseInt(fs[1], 10); out.gDec = parseInt(fs[2], 10); out.gDeclared = true;
        }
        if (/%MOIN/i.test(head)) out.gUnits = 'in';
        else if (/%MOMM/i.test(head)) out.gUnits = 'mm';

        // ---------- 2. G04 注释 ----------
        // 「3 integers and 6 decimals」/「3 integer and 6 decimal」/「2 Integers 4 Decimals」
        const g04Fmt = head.match(/(\d+)\s*integers?\s*(?:and\s*)?(\d+)\s*decimals?/i);
        if (g04Fmt && !out.gDeclared) {
            out.gInt = parseInt(g04Fmt[1], 10); out.gDec = parseInt(g04Fmt[2], 10); out.gDeclared = true;
        }
        // P-CAD：「Numeric Format: 4.4 (XXXX.XXXX)」
        const numFmt = head.match(/numeric\s*format\s*[:=]?\s*(\d+)\s*[.:x,]\s*(\d+)/i);
        if (numFmt && !out.gDeclared) {
            out.gInt = parseInt(numFmt[1], 10); out.gDec = parseInt(numFmt[2], 10); out.gDeclared = true;
        }
        // 单位（注释形式）
        if (!out.gUnits) {
            if (/dimensions?\s+in\s+inch|inch\s+units|units?\s*[:=]?\s*inch/i.test(head)) out.gUnits = 'in';
            else if (/dimensions?\s+in\s+millimet|millimet|metric\s+units/i.test(head)) out.gUnits = 'mm';
        }
        if (!out.gUnits) {
            if (/(?:^|[\r\n])\s*G70\b/.test(head)) out.gUnits = 'in';
            else if (/(?:^|[\r\n])\s*G71\b/.test(head)) out.gUnits = 'mm';
        }

        // ---------- 3. 钻孔文件头 ----------
        const isDrillHead = /M48/.test(head) || /(?:^|[\r\n])\s*T\d+\s*C[\d.]+/i.test(head);
        // 没有 %FS 又不是钻孔头 —— 典型的老式 RS-274-D（P-CAD / Protel 早期输出）
        if (!isDrillHead && !/%FS/i.test(head)) out.legacy274d = true;
        if (isDrillHead) {
            // 单位
            if (/\bMETRIC\b/i.test(head)) out.dUnits = 'mm';
            else if (/\bINCH\b/i.test(head)) out.dUnits = 'in';
            // METRIC,LZ,000.00000 —— 第三段是「整数位.小数位」的模板
            const tpl = head.match(/(?:METRIC|INCH)\s*,\s*[A-Z]*\s*,\s*(\d+)\.(\d+)/i);
            if (tpl) {
                out.dInt = tpl[1].length; out.dDec = tpl[2].length; out.dDeclared = true;
            }
            if (!out.dDeclared) {
                const ff = head.match(/FILE_FORMAT\s*[:=]\s*(\d+)\s*[:.]\s*(\d+)/i);
                if (ff) { out.dInt = parseInt(ff[1], 10); out.dDec = parseInt(ff[2], 10); out.dDeclared = true; }
            }
            if (!out.dDeclared) {
                // ; Format: 2.4 (00.0000)  /  Format: 3.3
                const fm = head.match(/format\s*[:=]\s*(\d+)\s*[.:]\s*(\d+)/i);
                if (fm) { out.dInt = parseInt(fm[1], 10); out.dDec = parseInt(fm[2], 10); out.dDeclared = true; }
            }
        }

        return out;
    }

    // 计算最大 ID 
    function calculateMaxId(source, version) {
        // 安全检查
        // if (!source) return { ticket: 10000, id: 10000 };

        let maxTicket = 0;
        let maxIdNum = 0;

        // 统一判断版本逻辑 (兼容传入 'pro_v3' / 'pro_v4' / 'V3专业版' 等情况)
        // V4 的图元行格式与 V3 完全一致（同样 "ticket" / "id":"eN"），所以解析规则共用。
        const isV3 = version && (version.includes('V3') || version.includes('V4') ||
            version === 'pro_v3' || version === 'pro_v4');

        if (isV3) {
            // =========================
            // V3 源码处理逻辑
            // =========================

            // 1. 获取最大 ticket
            // 正则匹配: "ticket":167 或 "ticket": 167
            const ticketRegex = /"ticket"\s*:\s*(\d+)/g;
            let tMatch;
            while ((tMatch = ticketRegex.exec(source)) !== null) {
                const val = parseInt(tMatch[1], 10);
                if (!isNaN(val) && val > maxTicket) {
                    maxTicket = val;
                }
            }

            // 2. 获取最大 id (仅限 e+数值 格式)
            // 正则匹配: "id":"e27"
            const idRegex = /"id"\s*:\s*"e(\d+)"/g;
            let iMatch;
            while ((iMatch = idRegex.exec(source)) !== null) {
                const val = parseInt(iMatch[1], 10);
                if (!isNaN(val) && val > maxIdNum) {
                    maxIdNum = val;
                }
            }

            return {
                ticket: maxTicket + 100,
                id: maxIdNum + 100
            };

        } else {
            // =========================
            // V2 源码处理逻辑
            // =========================
            
            // V2 格式通常为数组 ["STRING","e41",...]
            // 我们全局搜索带引号的 "e+数字" 格式即可覆盖
            const idRegex = /"e(\d+)"/g;
            let match;
            while ((match = idRegex.exec(source)) !== null) {
                const val = parseInt(match[1], 10);
                if (!isNaN(val) && val > maxIdNum) {
                    maxIdNum = val;
                }
            }

            return {
                ticket: null,
                id: maxIdNum + 100
            };
        }
    }

    // 文件选择 input 回调
    function handleFileSelect(e) { handleFiles(e.target.files); }

    // 浏览器下载文件
    function downloadStringAsFile(content, fileName) {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // 复制功能  ---
    function copyDebugSource() {
        const area = document.getElementById('debug-source-area');
        if (!area) return;
        
        area.select();
        document.execCommand('copy'); 
        
        // [修复] 通过 ID 精准获取“复制”按钮，而不是获取第一个按钮
        const btn = document.getElementById('btn-debug-copy');
        if (btn) {
            const oldText = btn.textContent;
            btn.textContent = "已复制";
            
            // 1秒后恢复文字
            setTimeout(() => {
                btn.textContent = oldText;
            }, 1000);
        }
    }


    // ====================================================================================
    // 负片 → 正片：把「外环 − 挖空环」拆成多个**无孔洞**的填充区域
    // ------------------------------------------------------------------------------------
    // 为什么需要：嘉立创EDA专业版 pcb_MathPolygon.createComplexPolygon() 的语义是「多块互相
    //   独立的多边形」（官方示例：矩形 + 圆形两块），**并不做布尔差**。把覆铜的挖空环一起塞
    //   进去，等于把该挖掉的地方也变成实体铜 —— 导入后看到的就是「一整块矩形铜」（负片平面）。
    // 做法：
    //   ① 真正的布尔差：region = 外环 −（所有挖空环的**并集**）。
    //      这里必须用「并集」而不是奇偶规则：负片里的间隙本来就互相重叠（实测 0802-2 顶层有
    //      5912 对重叠挖空、重叠面积 2568 mm²），奇偶规则会把重叠处又变回铜 → 短路。
    //      同一个 reason 也要求能处理「挖空环越出外环」的情况（越出的部分自然被裁掉）。
    //   ② 差集结果里可能仍有闭合孔洞（被铜环整圈围出来的洞）。对每个残留孔洞开一条
    //      0.01mm 宽的窄缝把它连到区域外部（keyhole 开缝）—— 孔洞于是变成开口凹槽，
    //      得到的每块填充都是「无孔洞的简单多边形」，可以逐个 createPolygon 导入。
    //   ③ 输出所有外边界路径，每个作为一块独立填充。
    // 依赖：ClipperLib（js/clipper.js，Boost Software License，整数坐标布尔运算，与 CAD/CAM
    //       工具同源）；未加载时退化为「不拆分」并在日志里告警。
    // ====================================================================================

    const FILL_ARC_TOL = 0.01;        // 圆弧离散化弦高容差 (mm)
    const FILL_SCALE = 1e5;           // mm → 整数（分辨率 0.00001 mm）
    const FILL_SLIT_HALF = 0.005;     // 开缝半宽 (mm)，即缝宽 0.01mm
    const FILL_AREA_EPS = 1e-9;       // 环面积有效阈值 (mm²)

    /** 环的有向面积（>0 = 逆时针），结果缓存在环对象上（reverse 时必须调 fillReverseRing 作废） */
    function fillRingArea(ring) {
        if (typeof ring._fa === 'number') return ring._fa;
        let s = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            s += a[0] * b[1] - b[0] * a[1];
        }
        ring._fa = s / 2;
        return ring._fa;
    }

    /** 原地翻转环方向；必须同时作废面积缓存（否则「孔洞」会被当成外环） */
    function fillReverseRing(ring) {
        ring.reverse();
        delete ring._fa;
        return ring;
    }

    /** 去掉末点与首点重合（闭合环在算法里不重复存首点） */
    function fillDropClosingDup(pts) {
        while (pts.length > 1) {
            const a = pts[0], b = pts[pts.length - 1];
            if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
            else break;
        }
    }

    /** 去掉连续重复点 + 首尾重复点 */
    function fillDropDupes(pts) {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = out.length ? out[out.length - 1] : null;
            if (q && Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) continue;
            out.push(p);
        }
        fillDropClosingDup(out);
        return out;
    }

    /** 圆弧 → 折线采样点（不含起点，也**不含末点**；末点由调用方用弧的声明端点补精确值）。
     *  这样能避免「采样末点 ≠ 声明末点」造成的 0.xµm 退化短边（EDA 会判多边形不合法）。 */
    function fillArcPoints(cx, cy, r, a0, sweep, tol) {
        const out = [];
        const safeR = Math.max(r, 1e-6);
        // 弦高容差取「绝对容差」与「半径的 1%」中的小者，保证小圆孔也够圆
        const tolUse = Math.min(tol, Math.max(safeR * 0.01, 0.0008));
        const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolUse / safeR)));
        const n = Math.max(3, Math.ceil(Math.abs(sweep) / Math.max(step, 0.02)));
        for (let i = 1; i < n; i++) {
            const a = a0 + sweep * (i / n);
            out.push([cx + safeR * Math.cos(a), cy + safeR * Math.sin(a)]);
        }
        return out;
    }

    /**
     * 路径操作数组 → 折线点列（mm）。
     * 操作形状与 05-pad-tool.js 的 regionPathOf / clearFlashRing / clearStrokeRing 一致：
     *   { cmd: 'M'|'L', x, y } 与 { cmd: 'ARC', x, y, sweep(度), cx, cy }
     */
    function fillRingPoints(ops) {
        const pts = [];
        let cur = null;
        (ops || []).forEach(op => {
            if (!op || typeof op.x !== 'number' || typeof op.y !== 'number') return;
            if (op.cmd === 'A' || op.cmd === 'ARC') {
                const sweepDeg = (typeof op.sweep === 'number') ? op.sweep
                    : (typeof op.angle === 'number' ? op.angle : 0);
                const cx = (typeof op.cx === 'number') ? op.cx : (cur ? cur[0] : op.x);
                const cy = (typeof op.cy === 'number') ? op.cy : (cur ? cur[1] : op.y);
                const r = cur ? Math.hypot(cur[0] - cx, cur[1] - cy) : 0;
                if (r > 1e-9 && Math.abs(sweepDeg) > 1e-6) {
                    const a0 = Math.atan2(cur[1] - cy, cur[0] - cx);
                    fillArcPoints(cx, cy, r, a0, sweepDeg * Math.PI / 180, FILL_ARC_TOL)
                        .forEach(p => pts.push(p));
                } else {
                    pts.push([op.x, op.y]);
                }
                cur = [op.x, op.y];
                return;
            }
            const p = [op.x, op.y];
            if (!cur || Math.abs(cur[0] - p[0]) > 1e-9 || Math.abs(cur[1] - p[1]) > 1e-9) pts.push(p);
            cur = p;
        });
        fillDropClosingDup(pts);
        return pts;
    }

    /** 点列 → 路径操作数组（只含 M / L，圆弧在离散化时已展平）。
     *  closeIt !== false 时**显式补回首点**：与源 Gerber 区域路径 / 标准版 SOLIDREGION 一致，
     *  避免「路径未闭合」被 EDA 端的多边形校验判为不合法。 */
    function fillPointsToOps(pts, closeIt) {
        const ops = [{ cmd: 'M', x: pts[0][0], y: pts[0][1] }];
        for (let i = 1; i < pts.length; i++) ops.push({ cmd: 'L', x: pts[i][0], y: pts[i][1] });
        if (closeIt !== false) ops.push({ cmd: 'L', x: pts[0][0], y: pts[0][1] });
        return ops;
    }

    /**
     * 输出前的多边形清理：合并过近顶点 + 去掉共线点。
     * 目的：消除退化短边（< 0.5µm）、并把切割线/圆弧离散化产生的大量冗余顶点压掉，
     * 让交给 EDA 的多边形「干净」（退化短边会让 EDA 的多边形校验/归一化出问题）。
     */
    function fillCleanRing(pts, minDist) {
        const md = (typeof minDist === 'number') ? minDist : 5e-4;   // 0.5µm
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const p = [Math.round(pts[i][0] * 1e4) / 1e4, Math.round(pts[i][1] * 1e4) / 1e4];
            const q = out.length ? out[out.length - 1] : null;
            if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < md) continue;
            out.push(p);
        }
        fillDropClosingDup(out);
        if (out.length < 3) return out;
        // 共线点消除（点到相邻两点连线的距离 < md 视为共线）
        const res = [];
        const n = out.length;
        for (let i = 0; i < n; i++) {
            const a = out[(i - 1 + n) % n], b = out[i], c = out[(i + 1) % n];
            const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
            const base = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
            if (cross / base < md) continue;
            res.push(b);
        }
        return res.length >= 3 ? res : out;
    }

    /**
     * 规整「填充环」的平铺源数组（即 05-pad-tool.js 里 generatePathStr 的输出格式：
     * `[x0,y0,'L',x1,y1,'L',…]`，圆弧段为 `'ARC',角度,x,y`）。
     *
     * 为什么需要：**嘉立创EDA 标准版**（EasyEDA v6.x）导出的 Gerber 区域，路径常写成
     * 「M 起点 → L 起点」这种**零长首段**，且**不闭合**（实测样本 1153 块填充里
     * 879 块带零长首段、仅 24% 闭合）。EDA 端对多边形源数组做几何校验，退化边 /
     * 未闭合会让整块填充创建失败 —— 用户看到的就是「渲染正常、导入 EDA 后填充区域丢失」。
     * 专业版（EasyEDA Pro）导出的区域本来就是干净闭合的，所以不受影响。
     *
     * 处理：① 删除零长线段（相邻两点重合）；② 末点未回到首点时显式补一段闭合。
     * 已经是干净闭合的环会**原样返回**（不做任何改动）。
     *
     * @param {Array} flat 平铺源数组；形如 ['CIRCLE',cx,cy,r] 的图元形式原样返回
     * @param {number} [tolMil] 判定「重合」的容差（mil），默认 1e-3（≈0.025µm）
     * @returns {Array|null} 规整后的数组；无法构成多边形（顶点 < 3）时返回 null
     */
    function fillNormalizeFlatRing(flat, tolMil) {
        if (!Array.isArray(flat) || flat.length < 4) return flat;
        // 只处理「坐标打头」的路径形式；['CIRCLE', …] / ['R', …] 等图元形式不碰
        if (typeof flat[0] !== 'number' || typeof flat[1] !== 'number') return flat;
        const tol = (typeof tolMil === 'number') ? tolMil : 1e-3;
        const sx = flat[0], sy = flat[1];

        // 解析为线段序列
        const segs = [];
        let i = 2;
        while (i < flat.length) {
            const op = flat[i];
            if (op === 'L' && i + 2 < flat.length) {
                segs.push({ op: 'L', x: flat[i + 1], y: flat[i + 2] }); i += 3;
            } else if (op === 'ARC' && i + 3 < flat.length) {
                segs.push({ op: 'ARC', a: flat[i + 1], x: flat[i + 2], y: flat[i + 3] }); i += 4;
            } else { i++; } // 未知记号，跳过（防御）
        }

        // ① 去零长线段（ARC 不参与：零长圆弧可能是整圆）
        const kept = [];
        let px = sx, py = sy;
        for (const s of segs) {
            if (s.op === 'L' && Math.abs(s.x - px) <= tol && Math.abs(s.y - py) <= tol) continue;
            kept.push(s); px = s.x; py = s.y;
        }
        if (!kept.length) return null;

        // 顶点数：起点 + 各线段终点；末点回到起点时该点不重复计
        const last = kept[kept.length - 1];
        const lastIsStart = Math.abs(last.x - sx) <= tol && Math.abs(last.y - sy) <= tol;
        if ((lastIsStart ? kept.length : kept.length + 1) < 3) return null;

        // ② 重建，并按需补一段闭合
        const out = [sx, sy];
        for (const s of kept) {
            if (s.op === 'ARC') out.push('ARC', s.a, s.x, s.y);
            else out.push('L', s.x, s.y);
        }
        if (!lastIsStart) out.push('L', sx, sy);
        return out;
    }

    /** Clipper 是否就绪 */
    function fillClipperReady() {
        return (typeof ClipperLib !== 'undefined') && !!ClipperLib
            && !!ClipperLib.Clipper && !!ClipperLib.PolyTree && !!ClipperLib.IntPoint;
    }

    /** 点列(mm) → Clipper 整数路径（去重相邻点与首尾重复点） */
    function fillToIntPath(pts) {
        const path = [];
        for (let i = 0; i < pts.length; i++) {
            const X = Math.round(pts[i][0] * FILL_SCALE);
            const Y = Math.round(pts[i][1] * FILL_SCALE);
            const prev = path.length ? path[path.length - 1] : null;
            if (prev && prev.X === X && prev.Y === Y) continue;
            path.push({ X: X, Y: Y });
        }
        if (path.length > 1) {
            const a = path[0], b = path[path.length - 1];
            if (a.X === b.X && a.Y === b.Y) path.pop();
        }
        return path;
    }

    /** Clipper 整数路径 → 点列(mm) */
    function fillFromIntPath(path) {
        const pts = [];
        for (let i = 0; i < path.length; i++) pts.push([path[i].X / FILL_SCALE, path[i].Y / FILL_SCALE]);
        fillDropClosingDup(pts);
        return pts;
    }

    /** 按需要统一 Clipper 路径的方向（wantCCW = 需要逆时针） */
    function fillForceOrientation(path, wantCCW) {
        const isCCW = ClipperLib.Clipper.Orientation(path);
        if (isCCW !== wantCCW) path.reverse();
        return path;
    }

    /**
     * 给一条孔洞路径生成一条「开缝」窄矩形：左端落在孔洞内部，右端伸到区域外。
     * 从区域里减掉它之后，这个孔洞就与外边界连通 → 不再是闭合孔洞（变成开口凹槽）。
     * 代价是割掉一条 0.01mm 宽的铜 —— 这就是 keyhole 开缝的标准做法。
     */
    function fillHoleSlitRect(holePath, beyondX) {
        const n = holePath.length;
        if (n < 3) return null;
        let y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < n; i++) {
            if (holePath[i].Y < y0) y0 = holePath[i].Y;
            if (holePath[i].Y > y1) y1 = holePath[i].Y;
        }
        if (!(y1 - y0 >= 2)) return null;
        // 在几条水平线上找孔洞内部区间，取最宽一段的中点作为缝的起点
        const cands = [0.5, 0.37, 0.63, 0.22, 0.78];
        const half = Math.max(1, Math.round(FILL_SLIT_HALF * FILL_SCALE));
        for (let k = 0; k < cands.length; k++) {
            const y = Math.round(y0 + (y1 - y0) * cands[k]);
            const xs = [];
            for (let i = 0; i < n; i++) {
                const p = holePath[i], q = holePath[(i + 1) % n];
                const a = p.Y > y, b = q.Y > y;
                if (a === b) continue;
                xs.push(p.X + (q.X - p.X) * (y - p.Y) / (q.Y - p.Y));
            }
            if (xs.length < 2) continue;
            xs.sort((u, v) => u - v);
            let bestA = null, bestB = null;
            for (let i = 0; i + 1 < xs.length; i += 2) {
                if (bestA === null || xs[i + 1] - xs[i] > bestB - bestA) { bestA = xs[i]; bestB = xs[i + 1]; }
            }
            if (bestA === null) continue;
            const xIn = Math.round((bestA + bestB) / 2);
            return [
                { X: xIn, Y: y - half },
                { X: beyondX, Y: y - half },
                { X: beyondX, Y: y + half },
                { X: xIn, Y: y + half }
            ];
        }
        return null;
    }

    /**
     * 负片区域 → 多个无孔洞填充区域（“负片转正片 + 拆分”的唯一入口）。
     * @param {Array}  outerOps     外环（路径操作数组，mm）
     * @param {Array}  holeOpsList  挖空环（路径操作数组的数组，mm）
     * @returns {Array|null}        每项是一块填充区域的路径操作数组；null = 外环不合法
     */
    function fillSplitNegativeRegion(outerOps, holeOpsList) {
        const outer = fillDropDupes(fillRingPoints(outerOps));
        if (outer.length < 3) return null;

        const holes = [];
        (holeOpsList || []).forEach(ops => {
            const h = fillDropDupes(fillRingPoints(ops));
            if (h.length >= 3 && Math.abs(fillRingArea(h)) > FILL_AREA_EPS) holes.push(h);
        });
        if (!holes.length) return [fillPointsToOps(outer)];
        if (!fillClipperReady()) {
            console.warn('未加载 ClipperLib：负片挖空无法拆分，本块按整块填充输出');
            return [fillPointsToOps(outer)];
        }

        // ---- ① 布尔差：外环 −（挖空环并集）----
        const subjPaths = [fillToIntPath(outer)];
        // 挖空统一方向：配合 pftNonZero，重叠的挖空才按「并集」处理（反向的会被抵消）
        const clipPaths = holes.map(h => fillToIntPath(
            fillRingArea(h) > 0 ? fillReverseRing(h.slice()) : h
        ));
        let maxX = -Infinity;
        subjPaths[0].forEach(p => { if (p.X > maxX) maxX = p.X; });
        clipPaths.forEach(pp => pp.forEach(p => { if (p.X > maxX) maxX = p.X; }));
        const beyondX = maxX + FILL_SCALE;          // 开缝方向：向右伸出 1mm（足够到区域外）

        const outers = [], holesOfResult = [];
        try {
            const cpr = new ClipperLib.Clipper();
            cpr.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
            if (clipPaths.length) cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
            const tree = new ClipperLib.PolyTree();
            const ok = cpr.Execute(ClipperLib.ClipType.ctDifference, tree,
                ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
            if (!ok) {
                console.warn('负片布尔差失败，本块按整块填充输出');
                return [fillPointsToOps(outer)];
            }
            const walk = (node) => {
                const kids = node.Childs();
                for (let i = 0; i < kids.length; i++) {
                    const c = kids[i];
                    const contour = c.Contour();
                    if (contour && contour.length >= 3) {
                        if (c.IsHole()) holesOfResult.push(contour);
                        else outers.push(contour);
                    }
                    walk(c);
                }
            };
            walk(tree);
        } catch (e) {
            console.warn('负片布尔差异常:', e);
            return [fillPointsToOps(outer)];
        }
        if (!outers.length) return [];

        // ---- ② 残留孔洞开缝（keyhole）----
        let finalPaths = null;
        if (holesOfResult.length) {
            const regionPaths = outers.map(p => fillForceOrientation(p.slice(), true))
                .concat(holesOfResult.map(p => fillForceOrientation(p.slice(), false)));
            const slits = [];
            holesOfResult.forEach(hp => {
                const rect = fillHoleSlitRect(hp, beyondX);
                if (rect) slits.push(rect);
            });
            if (slits.length) {
                try {
                    const cpr2 = new ClipperLib.Clipper();
                    cpr2.AddPaths(regionPaths, ClipperLib.PolyType.ptSubject, true);
                    cpr2.AddPaths(slits, ClipperLib.PolyType.ptClip, true);
                    const sol2 = [];
                    const ok2 = cpr2.Execute(ClipperLib.ClipType.ctDifference, sol2,
                        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
                    if (ok2) finalPaths = sol2;
                } catch (e) { console.warn('负片开缝异常:', e); }
            }
        }

        // ---- ③ 输出外边界（清理顶点后显式闭合）----
        const out = [];
        const srcPaths = finalPaths || outers.concat(holesOfResult);
        let leftover = 0;
        srcPaths.forEach(p => {
            if (!p || p.length < 3) return;
            if (!ClipperLib.Clipper.Orientation(p)) { leftover++; return; }   // 只取外环
            const pts = fillCleanRing(fillFromIntPath(p));
            if (pts.length >= 3 && Math.abs(fillRingArea(pts)) > FILL_AREA_EPS) out.push(fillPointsToOps(pts));
        });
        if (leftover) console.warn(`负片拆分：开缝后仍有 ${leftover} 个孔洞未消化`);
        // 正常情况：out 每项都是一块无孔洞填充（整块被挖空时 out 为空数组 → 该块整块丢弃）。
        // 只有「有外环但全被过滤掉」这种异常才退回到未开缝的外环（至少保住铜的形状）。
        if (out.length) return out;
        return outers.map(p => fillPointsToOps(fillCleanRing(fillFromIntPath(p))));
    }

    // --- 辅助：获取当前环境信息 ---
    function getEnvInfo() {
        let clientVer = 'browser';
        let isEdaEnv = false;

        if (typeof eda !== 'undefined') {
            isEdaEnv = true;
            const verStr = eda.sys_Environment.getEditorCurrentVersion(); // "2.2.45.5" / "3.2.149..." / "4.1.78"
            // 主版本号决定文档源码格式：
            //   2.x → V2 数组行（["PAD",...]）
            //   3.x → V3 行格式（{"type":"..."}||{...}|）
            //   4.x → V4 行格式（图元行与 V3 相同，仅头部多了 LAYER_PHYS / D3_ATTRIBUTE / 一批显示配置）
            if (verStr.startsWith('2')) clientVer = 'pro_v2';
            else if (verStr.startsWith('3')) clientVer = 'pro_v3';
            else if (verStr.startsWith('4')) clientVer = 'pro_v4';
        }
        return { clientVer, isEdaEnv };
    }

    // ----------------------------------------------------------------------------------
    // PCB 画布上下文检测
    // ------------------------------------------------------------------------------------
    // 「通过源码导入 / 通过图元导入」写的是**当前打开的 PCB 文档**。如果本工具是从
    // 开始页 / 原理图 / 符号库等非 PCB 页签打开的，这两个入口点了也不会有结果，
    // 所以先在打开时检测一次，非 PCB 画布就把它们禁用掉。
    //
    // 判据（按需求）：**读得到 PCB 源码 → 在画布上；读不到 → 不在**。
    //   ① `sys_FileManager.getDocumentSource()` 返回 undefined = 当前未打开文档 / 读取失败；
    //   ② 源码能读到，但文档类型不是 PCB（原理图、符号等同样能读到源码）→ 也不算；
    //   ③ 源码读不到时，再用 `dmt_SelectControl.getCurrentDocumentInfo()` 的 documentType
    //      交叉确认一次（全新的空白 PCB 文档源码可能为空，这时不能误判为「不在」）。
    // ----------------------------------------------------------------------------------

    /** PCB 文档类型枚举值（EDMT_EditorDocumentType.PCB = 3） */
    const PCB_DOCUMENT_TYPE = 3;

    /**
     * 判断一段文档源码是不是 PCB 文档。
     * 专业版 V2 头：`["DOCTYPE","PCB","1.8"]`
     * 专业版 V3 头：`{"type":"DOCHEAD"}||{"docType":"PCB",...}`
     */
    function isPcbDocumentSource(source) {
        if (typeof source !== 'string' || !source) return false;
        const head = source.slice(0, 4096);
        // V2：["DOCTYPE","PCB",...
        if (/\[\s*"DOCTYPE"\s*,\s*"PCB"/i.test(head)) return true;
        // V3：{"type":"DOCHEAD"}||{"docType":"PCB",...
        if (/"docType"\s*:\s*"PCB"/i.test(head)) return true;
        return false;
    }

    /**
     * 检测当前是否处于 PCB 画布。
     * @returns {Promise<{onPcbCanvas:boolean, reason:string, sourceLen:number}>}
     *          reason 仅用于运行日志，说明判定依据
     */
    async function detectPcbCanvasContext() {
        const env = getEnvInfo();
        if (!env.isEdaEnv) {
            return { onPcbCanvas: false, reason: '未运行在嘉立创EDA 环境中', sourceLen: 0 };
        }

        // ① 读当前文档源码（需求判据）
        let source = undefined;
        try {
            if (eda.sys_FileManager && typeof eda.sys_FileManager.getDocumentSource === 'function') {
                source = await eda.sys_FileManager.getDocumentSource();
            }
        } catch (e) {
            source = undefined;
        }

        // ② 源码不是 PCB → 直接判不在（原理图/符号也能读到源码，必须排除）
        if (typeof source === 'string' && source) {
            return isPcbDocumentSource(source)
                ? { onPcbCanvas: true, reason: '已读取到 PCB 文档源码', sourceLen: source.length }
                : { onPcbCanvas: false, reason: '当前文档不是 PCB（读取到的源码非 PCB 文档）', sourceLen: source.length };
        }

        // ③ 源码读不到 → 用文档类型接口交叉确认（空白 PCB 文档可能没有源码）
        try {
            if (eda.dmt_SelectControl && typeof eda.dmt_SelectControl.getCurrentDocumentInfo === 'function') {
                const info = await eda.dmt_SelectControl.getCurrentDocumentInfo();
                if (info && info.documentType === PCB_DOCUMENT_TYPE) {
                    return { onPcbCanvas: true, reason: '源码为空，按当前文档类型判定为 PCB', sourceLen: 0 };
                }
            }
        } catch (e) { /* 忽略：接口不可用时按「不在」处理 */ }

        return { onPcbCanvas: false, reason: '未读取到 PCB 文档源码', sourceLen: 0 };
    }

    // --- 辅助：从 Gerber 头部注释识别「导出来源软件」与「导出时间」---
    /** 两位补零 */
    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    /**
     * Date → 'YYYY-MM-DD HH:MM:SS'。
     * useUTC=true 用 UTC 字段读取：JSZip 的 entry.date 是按「DOS 时间 → Date.UTC」构造的，
     * 只有用 UTC 字段读出来才是压缩包里记录的本地时间（用本地字段会整体偏移一个时区）。
     */
    function formatStamp(d, useUTC) {
        if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
        const g = useUTC
            ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
            : [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
        return `${g[0]}-${pad2(g[1] + 1)}-${pad2(g[2])} ${pad2(g[3])}:${pad2(g[4])}:${pad2(g[5])}`;
    }

    /** 压缩包条目 → 时间串（按 UTC 字段还原，见 formatStamp 说明） */
    function zipEntryStamp(entry) {
        return entry && entry.date ? formatStamp(entry.date, true) : null;
    }

    /** File.lastModified（真实时间戳，ms）→ 本地时间串 */
    function fileTimeStamp(ms) {
        return (typeof ms === 'number' && isFinite(ms)) ? formatStamp(new Date(ms), false) : null;
    }

    /**
     * 扫描已导入文件的原文，识别产生该 Gerber 的软件与导出时间。
     * 实测两种写法：
     *   G04 EasyEDA Pro v2.2.32.3, 2024-11-18 13:44:47*
     *   ;EasyEDA Pro Client v2.1.40.832e02bb.70b181, 2023-12-06 22:07:52
     * 约定：EasyEDA = 标准版；EasyEDA Pro（含 Pro Client）= 专业版。
     * 兜底：注释里读不到导出时间时，用「压缩包内各 Gerber 文件时间的最小值」；
     *       软件名称读不到就保持 null（由 UI 隐藏该行，不做臆测）。
     * @returns {{software:string|null, time:string|null, raw:string}|null} 两者都没有时返回 null
     */
    function detectEasyEdaSource() {
        // 允许 G04 / ; 前缀，名称里可有 Pro / Client，版本号后可跟哈希段
        const re = /(?:G04|;)\s*(EasyEDA(?:\s+Pro)?(?:\s+Client)?)\s+v([0-9][^\s,]*)\s*,\s*(\d{4}-\d{2}-\d{2}[ T][\d:]+)/i;
        const files = (typeof rawFilesCache !== 'undefined' && Array.isArray(rawFilesCache)) ? rawFilesCache : [];
        let software = null, time = null, raw = '';
        for (const f of files) {
            if (!f || !f.content) continue;
            const m = re.exec(f.content);
            if (!m) continue;
            const isPro = /pro/i.test(m[1]);
            software = `${isPro ? '嘉立创EDA专业版' : '嘉立创EDA标准版'} v${trimVersionTail(m[2])}`;
            time = m[3];
            raw = m[0].trim();
            break;
        }
        // 标记里没有导出时间 → 取压缩包内 Gerber 文件时间的最小值
        if (!time) {
            let min = null;
            for (const f of files) {
                if (!f || !f.mtime) continue;
                if (min === null || f.mtime < min) min = f.mtime;
            }
            time = min;
        }
        if (!software && !time) return null;
        return { software, time, raw };
    }

    /** 版本号去掉尾部的哈希段：2.1.40.832e02bb.70b181 → 2.1.40；纯数字段全部保留 */
    function trimVersionTail(v) {
        const parts = String(v).split('.');
        const keep = [];
        for (const p of parts) {
            if (/^\d+$/.test(p)) keep.push(p);
            else break;
        }
        return keep.length ? keep.join('.') : String(v);
    }

    // ====================================================================================
    // 物理网络生成（连通分量分析）
    // ------------------------------------------------------------------------------------
    // 移植自「狼黑工具 · 物理网络生成」（Temp/生成网络/GenerateNet.html）的逻辑：
    //   ① 取铜层图元（焊盘 / 过孔 / 导线 / 圆弧 / 折线 / 填充），建空间网格加速求候选对；
    //   ② 逐对做几何连通判定（折线用「边相交 + 相互包含」；非异形焊盘按最短边内切圆保守处理）；
    //   ③ 并查集求连通分量；每个分量定一个网络名：
    //        · 分量内已有网络名（**优先来自飞针文件的 NET_NAME**）→ 沿用（飞针名 > 真实名 > 通用 NET\d+）
    //        · 一个都没有 → 分配未被占用的 "NET{n}"
    //   ④ 把网络名回填到该分量内的每个图元。
    // 与参考实现的差异：本工具坐标单位是 mm（参考实现是 mil），故网格尺寸/容差按 mm 取值。
    // ====================================================================================

    /** 铜层判定：顶层(1) / 底层(2) / 多层(12) / 内层(15~46) */
    function netIsCopperLayer(id) {
        return id === 1 || id === 2 || id === 12 || (id >= 15 && id <= 46);
    }

    /** 叠层顺序：顶层(1) + 内层(升序) + 底层(2) */
    function netStackIds(innerLayerIds) {
        const uniq = [...new Set((innerLayerIds || []).filter(n => n >= 15 && n <= 46))].sort((a, b) => a - b);
        return [1, ...uniq, 2];
    }

    /** 把埋盲孔的物理层序号区间（如 1-3）换算成真实层 ID 数组 */
    function netRangeLayers(startIdx, endIdx, stackIds) {
        let s = parseInt(startIdx, 10);
        let e = parseInt(endIdx, 10);
        if (!isFinite(s) || !isFinite(e)) return null;
        if (s < 1) s = 1;
        if (e > stackIds.length) e = stackIds.length;
        const out = [];
        for (let i = s; i <= e; i++) {
            const id = stackIds[i - 1];
            if (id !== undefined) out.push(id);
        }
        return out.length ? out : null;
    }

    /** 路径操作数组 → 顶点数组（去重相邻点，并丢掉与首点重合的收尾点） */
    function netPathToVertices(path) {
        const pts = [];
        const push = (x, y) => {
            if (!isFinite(x) || !isFinite(y)) return;
            const q = pts[pts.length - 1];
            if (q && Math.abs(q.x - x) < 1e-9 && Math.abs(q.y - y) < 1e-9) return;
            pts.push({ x, y });
        };
        let cur = null;
        (path || []).forEach(op => {
            if (!op || typeof op.x !== 'number' || !isFinite(op.x)) return;
            if (typeof op.y !== 'number' || !isFinite(op.y)) return;
            // ⚠️ 圆弧必须离散，不能只取终点。
            // 嘉立创的覆铜轮廓把「焊盘周围的隔离缺口」画成圆弧，只取弧的端点等于把缺口
            // 用弦代替 —— 弦向弧心内缩（矢高），包围盒/多边形都变小，于是缺口处的焊盘
            // 被判成「压在覆铜上」→ 不同网络的焊盘通过覆铜连成一片 → 整块改名 NET1。
            // 实测 Gerber_PCB1_2025-01-11：某个过孔中心到覆铜边只剩 0.199mm（真实隔离应 ≥0.5），
            // 就是因为缺口圆弧被弦抹平了。
            if (op.cmd === 'A' || op.cmd === 'ARC') {
                const sweepDeg = (typeof op.sweep === 'number') ? op.sweep
                    : (typeof op.angle === 'number' ? op.angle : 0);
                const cx = (typeof op.cx === 'number') ? op.cx : (cur ? cur.x : op.x);
                const cy = (typeof op.cy === 'number') ? op.cy : (cur ? cur.y : op.y);
                const r = cur ? Math.hypot(cur.x - cx, cur.y - cy) : 0;
                if (r > 1e-9 && Math.abs(sweepDeg) > 1e-6) {
                    const a0 = Math.atan2(cur.y - cy, cur.x - cx);
                    const sweep = sweepDeg * Math.PI / 180;
                    // ≤22.5° 一段：半径 0.6mm 的缺口圆，弦高误差 < 0.012mm，远小于隔离间距
                    const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
                    for (let k = 1; k < N; k++) {
                        const a = a0 + sweep * (k / N);
                        push(cx + r * Math.cos(a), cy + r * Math.sin(a));
                    }
                }
                push(op.x, op.y);
                cur = { x: op.x, y: op.y };
                return;
            }
            push(op.x, op.y);
            cur = { x: op.x, y: op.y };
        });
        while (pts.length > 1) {
            const a = pts[0], b = pts[pts.length - 1];
            if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop();
            else break;
        }
        return pts;
    }

    /**
     * 连通判定用的多边形简化（Douglas-Peucker，单位 mm）。
     * 只用于「连通图」，不影响导出的几何。
     * 为什么要简化：圆弧展平后，一块覆铜能有 3000~5000 个顶点，两块这样的多边形做一次
     * 「边 × 边」求交就是千万级运算（实测单对 113ms，191 对吃掉 21 秒）。
     * 0.05mm 的容差远小于常见隔离间距（≥0.1mm），不会把「本来分离」判成相接。
     */
    function netSimplifyRing(pts, tol) {
        const n = (pts || []).length;
        if (n <= 8) return pts;
        const t2 = (tol || 0.05) * (tol || 0.05);
        const keep = new Uint8Array(n);
        keep[0] = 1; keep[n - 1] = 1;
        const stack = [[0, n - 1]];
        while (stack.length) {
            const seg = stack.pop();
            const i0 = seg[0], i1 = seg[1];
            if (i1 - i0 < 2) continue;
            const a = pts[i0], b = pts[i1];
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            let best = -1, bestD = t2;
            for (let i = i0 + 1; i < i1; i++) {
                const p0 = pts[i];
                let d2;
                if (len2 < 1e-12) {
                    d2 = (p0.x - a.x) ** 2 + (p0.y - a.y) ** 2;
                } else {
                    let t = ((p0.x - a.x) * dx + (p0.y - a.y) * dy) / len2;
                    t = t < 0 ? 0 : (t > 1 ? 1 : t);
                    d2 = (p0.x - (a.x + t * dx)) ** 2 + (p0.y - (a.y + t * dy)) ** 2;
                }
                if (d2 > bestD) { bestD = d2; best = i; }
            }
            if (best > 0) {
                keep[best] = 1;
                stack.push([i0, best], [best, i1]);
            }
        }
        const out = [];
        for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
        return out.length >= 3 ? out : pts;
    }

    /**
     * 焊盘的真实外形轮廓（mm）。圆形不在这里（由 shape:'ROUND' 走精确距离判定）。
     * 矩形按旋转角取四角；长圆（Oval）按胶囊采样；异形（Polygon）取原路径。
     * @returns {Array<{x,y}>|null} 顶点数组（首尾不重复）
     */
    function netPadOutline(prim) {
        if (!prim) return null;
        if (prim.shape === 'POLYGON' && Array.isArray(prim.path)) {
            const v = netPathToVertices(prim.path);
            return v.length >= 3 ? v : null;
        }
        const w = prim.w, h = prim.h;
        if (!(w > 0) || !(h > 0)) return null;
        const rot = (prim.rotation || 0) * Math.PI / 180;
        const ux = Math.cos(rot), uy = Math.sin(rot);   // w 的朝向
        const vx = -uy, vy = ux;                        // h 的朝向
        const at = (a, b) => ({ x: prim.x + a * ux + b * vx, y: prim.y + a * uy + b * vy });
        if (prim.shape === 'RECT') {
            const hw = w / 2, hh = h / 2;
            return [at(hw, hh), at(-hw, hh), at(-hw, -hh), at(hw, -hh)];
        }
        // OVAL 等：胶囊（长边 = max(w,h)，两端半圆半径 = min(w,h)/2）
        const long = Math.max(w, h), short = Math.min(w, h);
        const r = short / 2, d = (long - short) / 2;
        const e1x = (w >= h) ? ux : vx, e1y = (w >= h) ? uy : vy;   // 长轴单位向量
        const e2x = -e1y, e2y = e1x;
        const pts = [];
        const N = 8;
        for (let i = 0; i <= N; i++) {
            const t = -Math.PI / 2 + Math.PI * (i / N);
            pts.push({ x: prim.x + e1x * d + r * (Math.cos(t) * e1x + Math.sin(t) * e2x), y: prim.y + e1y * d + r * (Math.cos(t) * e1y + Math.sin(t) * e2y) });
        }
        for (let i = 1; i < N; i++) {
            const t = Math.PI / 2 + Math.PI * (i / N);
            pts.push({ x: prim.x - e1x * d + r * (Math.cos(t) * e1x + Math.sin(t) * e2x), y: prim.y - e1y * d + r * (Math.cos(t) * e1y + Math.sin(t) * e2y) });
        }
        return pts;
    }

    // --- 几何基元 ---
    function netDistPointSeg2(px, py, x1, y1, x2, y2) {
        const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2;
    }

    function netSegmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const cross = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
        const d1 = cross(ax, ay, bx, by, cx, cy);
        const d2 = cross(ax, ay, bx, by, dx, dy);
        const d3 = cross(cx, cy, dx, dy, ax, ay);
        const d4 = cross(cx, cy, dx, dy, bx, by);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    }

    /**
     * 两条线段之间的最近距离平方（相交返回 0）。
     * 用于「导线端点正好搭在焊盘边界上」的判定：严格相交对这种情况返回 false，
     * 单查顶点距离又太远（半个焊盘尺寸），必须比较「线段到线段」的距离。
     */
    function netSegSegDist2(ax, ay, bx, by, cx, cy, dx, dy) {
        if (netSegmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
        return Math.min(
            netDistPointSeg2(ax, ay, cx, cy, dx, dy),
            netDistPointSeg2(bx, by, cx, cy, dx, dy),
            netDistPointSeg2(cx, cy, ax, ay, bx, by),
            netDistPointSeg2(dx, dy, ax, ay, bx, by)
        );
    }

    function netPointInPoly(px, py, vertices) {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    function netPointInRect(x, y, r) {
        return Math.abs(x - r.x) <= r.w / 2 && Math.abs(y - r.y) <= r.h / 2;
    }

    function netLineHitRect(x1, y1, x2, y2, r) {
        const l = r.x - r.w / 2, rr = r.x + r.w / 2, t = r.y - r.h / 2, b = r.y + r.h / 2;
        if (netPointInRect(x1, y1, r) || netPointInRect(x2, y2, r)) return true;
        return netSegmentsIntersect(x1, y1, x2, y2, l, t, rr, t) ||
            netSegmentsIntersect(x1, y1, x2, y2, l, b, rr, b) ||
            netSegmentsIntersect(x1, y1, x2, y2, l, t, l, b) ||
            netSegmentsIntersect(x1, y1, x2, y2, rr, t, rr, b);
    }

    /** 图元的边列表（折线取相邻顶点，线段取自身，圆取内接正十二边形，矩形取包围盒四边） */
    function netShapeEdges(p) {
        if (p._edges) return p._edges;
        const out = [];
        if (p.shape === 'POLY' && p.vertices && p.vertices.length) {
            const v = p.vertices;
            for (let i = 0; i < v.length; i++) {
                const a = v[i], b = v[(i + 1) % v.length];
                out.push([a.x, a.y, b.x, b.y]);
            }
        } else if (p.shape === 'line') {
            out.push([p.x1, p.y1, p.x2, p.y2]);
        } else if (p.shape === 'ROUND') {
            // ⚠️ 圆形**不能**用「包围盒四边」近似：方角在对角方向比真实半径远 √2 倍，
            // 会把「圆心距区域边界 1.27mm、半径仅 0.955mm」的焊盘判成与覆铜相接
            // （实测：GND 覆铜因此被"焊"到 GPIO0 的大焊盘上，整板被并成一个网络，
            //   最后按"最短名优先"被命名成 DP）。改成内接正十二边形，顶点严格落在圆周上。
            const r = p.r || 0;
            const N = 12;
            for (let i = 0; i < N; i++) {
                const a1 = (i / N) * Math.PI * 2;
                const a2 = ((i + 1) / N) * Math.PI * 2;
                out.push([
                    p.x + r * Math.cos(a1), p.y + r * Math.sin(a1),
                    p.x + r * Math.cos(a2), p.y + r * Math.sin(a2)
                ]);
            }
        } else {
            const hw = (p.w || 0) / 2, hh = (p.h || 0) / 2;
            const l = p.x - hw, r = p.x + hw, t = p.y - hh, b = p.y + hh;
            out.push([l, t, r, t], [r, t, r, b], [r, b, l, b], [l, b, l, t]);
        }
        p._edges = out;
        return out;
    }

    function netBBox(p) {
        if (p._bbox) return p._bbox;
        let bb;
        if (p.shape === 'line') {
            const r = (p.w || 0) / 2;
            bb = {
                x0: Math.min(p.x1, p.x2) - r, x1: Math.max(p.x1, p.x2) + r,
                y0: Math.min(p.y1, p.y2) - r, y1: Math.max(p.y1, p.y2) + r
            };
        } else if (p.shape === 'POLY' && p.vertices && p.vertices.length) {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            p.vertices.forEach(v => {
                if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
                if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
            });
            bb = { x0, x1, y0, y1 };
        } else {
            const hw = (p.w || 0) / 2, hh = (p.h || 0) / 2;
            bb = { x0: p.x - hw, x1: p.x + hw, y0: p.y - hh, y1: p.y + hh };
        }
        p._bbox = bb;
        return bb;
    }

    /** 两层是否有公共铜层（'ALL' = 多层/通孔，与任意铜层相连） */
    function netLayersConnected(a, b) {
        const A = a.layers, B = b.layers;
        if (A === 'ALL' || B === 'ALL') return true;
        // 快速路径：绝大多数图元只落在一层（单层导线/焊盘），直接比一个数，
        // 避免数组 indexOf（每次调用都要走一遍 C++/JS 边界，几十万次累积很可观）
        if (A.length === 1) return B.length === 1 ? A[0] === B[0] : B.indexOf(A[0]) !== -1;
        if (B.length === 1) return A.indexOf(B[0]) !== -1;
        for (let i = 0; i < A.length; i++) {
            if (B.indexOf(A[i]) !== -1) return true;
        }
        return false;
    }

    function netLinesTouching(a, b) {
        const lim = ((a.w || 0) + (b.w || 0)) / 2;
        const lim2 = lim * lim;
        if (netDistPointSeg2(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2) <= lim2) return true;
        if (netDistPointSeg2(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) <= lim2) return true;
        if (netDistPointSeg2(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2) <= lim2) return true;
        if (netDistPointSeg2(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2) <= lim2) return true;
        return netSegmentsIntersect(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
    }

    // ---------------- 多边形边索引（性能） ----------------
    // 一块内层平面常常有 2000~4000 条边，而落在它范围内的焊盘/导线有上千个。
    // 朴素实现每对图元都要「自己的边 × 对方的边」全量求交（4000 × 4 = 1.6 万次/对），
    // 实测 1.6MB 的板子光是连通判定就要 78 秒。
    // 这里给顶点数较多的多边形建一个 2mm 的边网格 + y 分带索引：
    //   · 求交：只取对方包围盒覆盖到的格子里的边（通常个位数）
    //   · 点在多边形内：只用「y 所在分带」里的边做射线法（O(V/分带数)）
    // 索引按图元缓存（`_pi`），每个多边形只建一次；判据与朴素实现完全等价。
    const NET_POLY_INDEX_MIN = 24;      // 顶点数 ≥ 此值才建索引（小多边形直接暴力更快）
    const NET_POLY_CELL = 2;            // 边索引导出格边长（mm）
    const netPolyCellKey = (ix, iy) => ix * 100003 + iy;

    function netPolyEdgeIndex(poly) {
        if (poly._pi) return poly._pi;
        const vs = poly.vertices || [];
        const edges = [];
        const cells = new Map();        // 2D 格子 → 边下标
        const bands = new Map();        // y 分带 → 边下标（射线法用）
        for (let i = 0; i < vs.length; i++) {
            const p0 = vs[i], p1 = vs[(i + 1) % vs.length];
            const id = edges.push([p0.x, p0.y, p1.x, p1.y]) - 1;
            const ex0 = Math.min(p0.x, p1.x), ex1 = Math.max(p0.x, p1.x);
            const ey0 = Math.min(p0.y, p1.y), ey1 = Math.max(p0.y, p1.y);
            const ix0 = Math.floor(ex0 / NET_POLY_CELL), ix1 = Math.floor(ex1 / NET_POLY_CELL);
            const iy0 = Math.floor(ey0 / NET_POLY_CELL), iy1 = Math.floor(ey1 / NET_POLY_CELL);
            for (let ix = ix0; ix <= ix1; ix++) {
                for (let iy = iy0; iy <= iy1; iy++) {
                    const k = netPolyCellKey(ix, iy);
                    let arr = cells.get(k);
                    if (!arr) cells.set(k, arr = []);
                    arr.push(id);
                }
            }
            for (let iy = iy0; iy <= iy1; iy++) {
                let arr = bands.get(iy);
                if (!arr) bands.set(iy, arr = []);
                arr.push(id);
            }
        }
        poly._pi = { edges, cells, bands };
        return poly._pi;
    }

    /** 取「与给定矩形可能相交」的多边形边（候选，可能重复，去重无意义） */
    function netPolyEdgesNear(poly, x0, y0, x1, y1) {
        if (!poly._pi && (poly.vertices || []).length < NET_POLY_INDEX_MIN) return netShapeEdges(poly);
        const pi = netPolyEdgeIndex(poly);
        const out = [];
        const ix0 = Math.floor(x0 / NET_POLY_CELL), ix1 = Math.floor(x1 / NET_POLY_CELL);
        const iy0 = Math.floor(y0 / NET_POLY_CELL), iy1 = Math.floor(y1 / NET_POLY_CELL);
        for (let ix = ix0; ix <= ix1; ix++) {
            for (let iy = iy0; iy <= iy1; iy++) {
                const arr = pi.cells.get(netPolyCellKey(ix, iy));
                if (arr) for (let k = 0; k < arr.length; k++) out.push(pi.edges[arr[k]]);
            }
        }
        return out;
    }

    /** 点是否在多边形内（大多边形走 y 分带索引，与 netPointInPoly 结果一致） */
    function netPolyHasPoint(poly, px, py) {
        if (!poly._pi && (poly.vertices || []).length < NET_POLY_INDEX_MIN) {
            return netPointInPoly(px, py, poly.vertices);
        }
        const pi = netPolyEdgeIndex(poly);
        const arr = pi.bands.get(Math.floor(py / NET_POLY_CELL));
        if (!arr) return false;
        let inside = false;
        for (let k = 0; k < arr.length; k++) {
            const e = pi.edges[arr[k]];
            if (((e[1] > py) !== (e[3] > py)) &&
                (px < (e[2] - e[0]) * (py - e[1]) / (e[3] - e[1]) + e[0])) inside = !inside;
        }
        return inside;
    }

    /**
     * 两块「巨型多边形」是否有面积重叠（用 Clipper 求交，O((n+m)log) 级）。
     * 为什么要单独处理：覆铜/内层平面展平后有 1 万~2 万多顶点，两块之间做「边 × 边」
     * 求交是千万级运算（实测单对 437ms，55 对吃掉 24 秒）。而判断两块铜是否相连，
     * 用布尔求交一次就够，而且 Clipper 是 asm.js 编译过的，比手写 JS 循环快两个数量级。
     * @returns {boolean|null} null = Clipper 不可用（调用方回退到边求交）
     */
    function netPolysOverlapByClipper(polyA, polyB) {
        if (typeof fillClipperReady !== 'function' || !fillClipperReady()
            || typeof fillToIntPath !== 'function') return null;
        // 结果按「图元对象」缓存（不能用 id 做键：每次重新生成图元，id 会从头编号，
        // 跨次复用同一份缓存会拿到上一次的结论）
        if (!polyA._ovl) polyA._ovl = new Map();
        if (polyA._ovl.has(polyB)) return polyA._ovl.get(polyB);
        const aVerts = polyA.vertices, bVerts = polyB.vertices;
        let out = null;
        try {
            const A = fillToIntPath(aVerts.map(v => [v.x, v.y]));
            const B = fillToIntPath(bVerts.map(v => [v.x, v.y]));
            if (A.length >= 3 && B.length >= 3) {
                const cpr = new ClipperLib.Clipper();
                cpr.AddPath(A, ClipperLib.PolyType.ptSubject, true);
                cpr.AddPath(B, ClipperLib.PolyType.ptClip, true);
                const sol = new ClipperLib.Paths();
                cpr.Execute(ClipperLib.ClipType.ctIntersection, sol,
                    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
                // 面积阈值 1e6（FILL_SCALE=1e5 → 1e-4 mm²）：小于这个量的「擦边」不算相连
                let hit = false;
                for (let i = 0; i < sol.length; i++) {
                    if (Math.abs(ClipperLib.Clipper.Area(sol[i])) > 1e6) { hit = true; break; }
                }
                out = hit;
            }
        } catch (e) {
            out = null;
        }
        polyA._ovl.set(polyB, out);
        return out;
    }

    /** 两个图元是否电气连通（对应参考实现的 checkConnectivityHighPrecision） */
    function netConnected(a, b) {
        // 同一个源图元派生出来的图元必定属于同一块铜 —— 直接算连通，不做几何判定。
        // 两个来源：
        //   · 负片覆铜拆分成多块无孔洞填充（同一 src）
        //   · 一条描边折线拆成多段线段参与判定（同一 src）
        // 这两类数量大（一块 52mm 平面能拆出上百块、一条轮廓几十段），而几何判定极贵
        // （两块 3000+ 顶点的多边形做全量边求交，实测单对 76ms）。
        if (a.src && a.src === b.src) return true;
        if (!netLayersConnected(a, b)) return false;
        // 先做包围盒粗筛（便宜且绝不会漏判：真正相接的图元包围盒必然相交）
        const ba = netBBox(a), bb = netBBox(b);
        if (ba.x1 < bb.x0 || bb.x1 < ba.x0 || ba.y1 < bb.y0 || bb.y1 < ba.y0) return false;

        const aPoly = a.shape === 'POLY' && a.vertices && a.vertices.length >= 3;
        const bPoly = b.shape === 'POLY' && b.vertices && b.vertices.length >= 3;
        if (aPoly || bPoly) {
            // 两边都是多边形时，**取顶点多的那个当「被索引的多边形」**。
            // 反过来（拿 4 顶点焊盘当 poly、5000 顶点覆铜当 other）会让 eB = 覆铜的全部边，
            // 每对都要做 4×5000 次求交 —— 实测 6 万对焊盘×覆铜因此吃掉 5 秒。
            const poly = (aPoly && bPoly)
                ? (a.vertices.length >= b.vertices.length ? a : b)
                : (aPoly ? a : b);
            const other = poly === a ? b : a;
            // ① 边相交（其它图元一律用包围盒四边 / 线段近似）
            //    大多边形（覆铜/平面）走边索引：只取对方包围盒覆盖到的边，
            //    而不是把 2000+ 条边全量比一遍（见 netPolyEdgeIndex 注释）。
            const obb = netBBox(other);
            const pbb = netBBox(poly);
            // ① 边相交只可能在**两者包围盒的交集**里发生 —— 把候选边限制在这个矩形内。
            //    这一步对「覆铜 × 覆铜」尤其关键：两块相邻覆铜的包围盒各自覆盖整板，
            //    但交集常常只是中间一条窄带；按整板取边会退化成几千 × 几千次求交。
            const ix0 = Math.max(pbb.x0, obb.x0), iy0 = Math.max(pbb.y0, obb.y0);
            const ix1 = Math.min(pbb.x1, obb.x1), iy1 = Math.min(pbb.y1, obb.y1);
            // 两块巨型多边形（覆铜 / 内层平面）走 Clipper 布尔求交，避免千万级边求交
            if (poly.vertices.length >= 800 && other.vertices && other.vertices.length >= 800) {
                const ov = netPolysOverlapByClipper(poly, other);
                if (ov !== null) return ov;
            }
            const bothPoly = !!(other.vertices && other.vertices.length >= NET_POLY_INDEX_MIN);
            const eA = netPolyEdgesNear(poly, ix0, iy0, ix1, iy1);
            const eB = bothPoly
                ? netPolyEdgesNear(other, ix0, iy0, ix1, iy1)
                : netShapeEdges(other);
            if (eA && eB) {
                for (let i = 0; i < eA.length; i++) {
                    for (let j = 0; j < eB.length; j++) {
                        const la = eA[i], lb = eB[j];
                        if (netSegmentsIntersect(la[0], la[1], la[2], la[3], lb[0], lb[1], lb[2], lb[3])) return true;
                    }
                }
            }
            // ② 对方落在本多边形内（折线判各顶点；线段判两端点；其它形状只看中心点）
            if (other.vertices && other.vertices.length) {
                for (const v of other.vertices) if (netPolyHasPoint(poly, v.x, v.y)) return true;
            } else if (other.shape === 'line') {
                if (netPolyHasPoint(poly, other.x1, other.y1)) return true;
                if (netPolyHasPoint(poly, other.x2, other.y2)) return true;
                // 线段端点「停在多边形边界上」也要算相接：严格相交判定对共线/相切返回 false，
                // 会让导线连不上焊盘（同一网络被拆成孤岛 → 导入后出现飞线）。
                // 「顶点到线段距离」由下面的「边到线段距离」覆盖（边距离取的是四个端点到对边
                // 的最小值，本身包含顶点），不必再单跑一遍全量顶点 → 省掉 22%~45% 的判定时间。
                const lim2 = (((other.w || 0) / 2) ** 2);
                // 线段到多边形**边**的距离 ≤ 线宽/2。
                // 这条专门补「矩形/异形焊盘 + 导线端点正好搭在焊盘边界上」：
                //   ① 严格相交对「端点落在边上」返回 false；
                //   ② 端点是否在内部（ray casting）对边界点也不可靠；
                //   ③ 多边形顶点到线段的距离 ≈ 半个焊盘尺寸，远大于 w/2。
                // 三条都判不出来 → 导线与焊盘各成孤岛 → 同一网络分裂成两个名字（用户看到的
                // 「焊盘A=NET1、焊盘B=NET2、导线=NET2」就是这条路）。圆形焊盘走的是
                // 「圆心到线段距离 ≤ r + w/2」，本来就没有这个问题，所以只有矩形/异形盘暴露。
                const pad = (other.w || 0) / 2;
                const near = netPolyEdgesNear(poly,
                    Math.min(other.x1, other.x2) - pad, Math.min(other.y1, other.y2) - pad,
                    Math.max(other.x1, other.x2) + pad, Math.max(other.y1, other.y2) + pad);
                for (let i = 0; i < near.length; i++) {
                    const e = near[i];
                    if (netSegSegDist2(e[0], e[1], e[2], e[3], other.x1, other.y1, other.x2, other.y2) <= lim2) return true;
                }
            } else if (netPolyHasPoint(poly, other.x, other.y)) return true;
            // ③ 反向包含（只有 both 都是多边形、且本多边形更小才可能）
            //    旧实现无条件遍历本多边形的全部顶点 → 大覆铜对焊盘多边形时会跑 2000+×4 次；
            //    这里先用包围盒判「本多边形是否被对方包住」，不满足直接跳过（结论不变）。
            if (other.vertices && other.vertices.length) {
                const pb = netBBox(poly);
                if (pb.x0 >= obb.x0 - 1e-6 && pb.x1 <= obb.x1 + 1e-6
                    && pb.y0 >= obb.y0 - 1e-6 && pb.y1 <= obb.y1 + 1e-6) {
                    for (const v of poly.vertices) if (netPointInPoly(v.x, v.y, other.vertices)) return true;
                }
            } else if (other.shape === 'RECT') {
                for (const v of poly.vertices) if (netPointInRect(v.x, v.y, other)) return true;
            }
            return false;
        }
        if (a.shape === 'line' && b.shape === 'line') return netLinesTouching(a, b);
        let n = null, r = null;
        if (a.shape === 'line') { n = a; r = b; } else if (b.shape === 'line') { n = b; r = a; }
        if (n && r) {
            if (r.shape === 'ROUND') {
                const lim = (r.r || 0) + (n.w || 0) / 2;
                return netDistPointSeg2(r.x, r.y, n.x1, n.y1, n.x2, n.y2) <= lim * lim;
            }
            if (r.shape === 'RECT') {
                const e = (n.w || 0) / 2 + 0.1;
                return netLineHitRect(n.x1, n.y1, n.x2, n.y2, { x: r.x, y: r.y, w: (r.w || 0) + 2 * e, h: (r.h || 0) + 2 * e });
            }
        }
        if (a.shape === 'ROUND' && b.shape === 'ROUND') {
            const dx = a.x - b.x, dy = a.y - b.y, lim = (a.r || 0) + (b.r || 0);
            return dx * dx + dy * dy < lim * lim;
        }
        return Math.abs(a.x - b.x) < ((a.w || 0) + (b.w || 0)) / 2 && Math.abs(a.y - b.y) < ((a.h || 0) + (b.h || 0)) / 2;
    }

    /**
     * 把 consolidate 的统一数据拍平成「连通性图元」列表（只保留铜层图元）。
     * @param {object} data { unifiedPads, remainingVias, tracks, polys, fills }
     * @param {object} opts { padNet:Map<pad,string>, innerCopperLayers:number[] }
     */
    function netBuildPrims(data, opts) {
        const o = opts || {};
        const d = data || {};
        const stackIds = netStackIds(o.innerCopperLayers);
        const prims = [];

        (d.unifiedPads || []).forEach((pad, i) => {
            const prims0 = [pad.top, pad.bottom, pad.innerRep].filter(Boolean).concat(pad.inners || []);
            if (!prims0.length) return;
            let layers;
            if (pad.drill) {
                // 通孔 → 连接所有铜层；埋盲孔 → 只连层对区间
                layers = (pad.drill.pairStart && pad.drill.pairEnd)
                    ? (netRangeLayers(pad.drill.pairStart, pad.drill.pairEnd, stackIds) || 'ALL') : 'ALL';
            } else {
                layers = [...new Set(prims0.map(x => x.layerId).filter(netIsCopperLayer))];
                if (!layers.length) return;
            }
            // 焊盘外形：圆形 → 精确圆判定；矩形 / 长圆 / 异形 → **真实轮廓多边形**。
            // ⚠️ 参考实现「一律按最短边内切圆」会把矩形焊盘算小，导致「导线明明连在焊盘上
            // 却判为不相接」→ 同一网络被拆成多个孤岛 → 导入 EDA 后出现飞线。
            const prim0 = pad.top || pad.bottom || pad.innerRep || (pad.inners && pad.inners[0]);
            const seed = (o.padNet && o.padNet.get(pad)) || '';
            const isCircle = !prim0 || /ELLIPSE|CIRCLE/i.test(String(prim0.shape || ''));
            if (isCircle) {
                let w = Infinity, h = Infinity;
                prims0.forEach(x => {
                    if (x.w > 0) w = Math.min(w, x.w);
                    if (x.h > 0) h = Math.min(h, x.h);
                });
                if (!isFinite(w) || !isFinite(h)) return;
                prims.push({
                    id: 'P' + i, src: pad, layers, shape: 'ROUND',
                    x: pad.x, y: pad.y, w, h, r: Math.min(w, h) / 2, net: seed, isFlying: !!seed
                });
                return;
            }
            const verts = netPadOutline(prim0);
            if (!verts || verts.length < 3) return;
            prims.push({ id: 'P' + i, src: pad, layers, shape: 'POLY', vertices: verts, net: seed, isFlying: !!seed });
        });

        (d.remainingVias || []).forEach((v, i) => {
            const dia = (v.padDia > 0) ? v.padDia : v.dia;
            if (!(dia > 0)) return;
            const layers = (v.pairStart && v.pairEnd)
                ? (netRangeLayers(v.pairStart, v.pairEnd, stackIds) || 'ALL') : 'ALL';
            prims.push({
                id: 'V' + i, src: v, layers, shape: 'ROUND',
                x: v.x, y: v.y, w: dia, h: dia, r: dia / 2, net: '', isFlying: false
            });
        });

        (d.tracks || []).forEach((t, i) => {
            if (!netIsCopperLayer(t.layerId)) return;
            if (!isFinite(t.x1) || !isFinite(t.y1) || !isFinite(t.x2) || !isFinite(t.y2)) return;
            const w = (t.width > 0) ? t.width : 0.15;
            const layers = [t.layerId];
            // 圆弧**不能**只取弦：弦离真实弧最远可差一个矢高（90° 弧 ≈ 0.29r），
            // 会造成「明明相邻却判不相接 / 明明隔开却判相接」。这里按 ≤22.5° 折线离散，
            // 多个子段共用同一个 src，回填网络时仍映射回原导线对象。
            if (t.type === 'ARC' && isFinite(t.angle) && Math.abs(t.angle) > 1e-6) {
                const ch = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
                let th = Math.min(Math.abs(t.angle) * Math.PI / 180, Math.PI * 2);
                if (ch < 1e-9 || th < 1e-9) {
                    prims.push({ id: 'T' + i, src: t, layers, shape: 'line', x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, w, net: '', isFlying: false });
                    return;
                }
                const r = ch / (2 * Math.sin(th / 2));
                const mx = (t.x1 + t.x2) / 2, my = (t.y1 + t.y2) / 2;
                const nx = -(t.y2 - t.y1) / ch, ny = (t.x2 - t.x1) / ch;
                const h = Math.sqrt(Math.max(0, r * r - (ch / 2) * (ch / 2)));
                const sign = (t.angle >= 0) ? 1 : -1;      // 正角 = 逆时针，圆心在弦左侧
                const cx = mx + nx * h * sign, cy = my + ny * h * sign;
                const a0 = Math.atan2(t.y1 - cy, t.x1 - cx);
                const sweep = sign * th;
                const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
                let px = t.x1, py = t.y1;
                for (let k = 1; k <= N; k++) {
                    const a = a0 + sweep * (k / N);
                    const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
                    prims.push({ id: 'T' + i + '_' + k, src: t, layers, shape: 'line', x1: px, y1: py, x2: qx, y2: qy, w, net: '', isFlying: false });
                    px = qx; py = qy;
                }
                return;
            }
            prims.push({
                id: 'T' + i, src: t, layers, shape: 'line',
                x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, w, net: '', isFlying: false
            });
        });

        /**
         * 铜层「描边折线」（G04 Copper 段里 G36 区域之外的 D01/弧，导出为带线宽的 POLY）
         * 按**线段**参与连通判定，而不是按多边形顶点。
         * 原因：
         *   ① 开口折线（例如只有 2 个点的一段 0.2mm 直铜）顶点不足 3 个，走多边形分支会被
         *      直接跳过 → 整条线拿不到网络名；
         *   ② netPathToVertices 只取顶点，弧会被当弦（差一个矢高），与真实铜形不符。
         * 这里按 ≤22.5° 离散后逐段入图，多个子段共用同一个 src（POLY 本体），
         * 回填网络时仍映射回整条 POLY —— 与导线圆弧离散的处理方式完全一致。
         */
        const pushStrokePoly = (p, i) => {
            const w = (p.width > 0) ? p.width : 0.15;
            const layers = [p.layerId];
            const path = p.path || [];
            const STEP = Math.PI / 8;   // 22.5°
            let prev = null, si = 0;
            path.forEach(op => {
                if (!op || typeof op.x !== 'number' || !isFinite(op.x) ||
                    typeof op.y !== 'number' || !isFinite(op.y)) return;
                if (op.cmd === 'M' || prev === null) { prev = op; return; }
                if (op.cmd === 'L') {
                    prims.push({
                        id: `Y${i}_${si++}`, src: p, layers, shape: 'line',
                        x1: prev.x, y1: prev.y, x2: op.x, y2: op.y, w, net: '', isFlying: false
                    });
                    prev = op;
                    return;
                }
                if (op.cmd !== 'A' && op.cmd !== 'ARC') { prev = op; return; }
                const angle = (op.sweep !== undefined) ? op.sweep : op.angle;
                const ch = Math.hypot(op.x - prev.x, op.y - prev.y);
                const th = Math.min(Math.abs(angle || 0) * Math.PI / 180, Math.PI * 2);
                if (ch < 1e-9 || th < 1e-9) { prev = op; return; }
                const r = ch / (2 * Math.sin(th / 2));
                const mx = (prev.x + op.x) / 2, my = (prev.y + op.y) / 2;
                const nx = -(op.y - prev.y) / ch, ny = (op.x - prev.x) / ch;
                const hh = Math.sqrt(Math.max(0, r * r - (ch / 2) * (ch / 2)));
                const sign = (angle >= 0) ? 1 : -1;
                const cx = mx + nx * hh * sign, cy = my + ny * hh * sign;
                const a0 = Math.atan2(prev.y - cy, prev.x - cx);
                const sweep = sign * th;
                const N = Math.max(2, Math.min(12, Math.ceil(Math.abs(sweep) / STEP)));
                let ax = prev.x, ay = prev.y;
                for (let k = 1; k <= N; k++) {
                    const a = a0 + sweep * (k / N);
                    const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
                    prims.push({
                        id: `Y${i}_${si++}`, src: p, layers, shape: 'line',
                        x1: ax, y1: ay, x2: qx, y2: qy, w, net: '', isFlying: false
                    });
                    ax = qx; ay = qy;
                }
                prev = op;
            });
        };

        const addPolygon = (arr, prefix, key) => {
            (arr || []).forEach((p, i) => {
                if (!netIsCopperLayer(p.layerId)) return;
                if (p.isStroke) { pushStrokePoly(p, i); return; }   // 描边折线：按线段入图
                const v = netPathToVertices(p.path);
                if (v.length < 3) return;
                // 只给连通判定用「简化点集」：圆弧展平后 3000~5000 顶点会让两两求交爆炸
                const vs = (typeof netSimplifyRing === 'function') ? netSimplifyRing(v, 0.05) : v;
                prims.push({
                    id: prefix + i, src: p, layers: [p.layerId], shape: 'POLY',
                    vertices: vs, net: '', isFlying: false
                });
            });
        };
        addPolygon(d.polys, 'Y');
        addPolygon(d.fills, 'F');

        return prims;
    }

    /** 简单并查集（按网络字符串 id 合并） */
    function netUnionFind() {
        const parent = {};
        const find = (id) => {
            if (parent[id] === undefined) parent[id] = id;
            if (parent[id] !== id) parent[id] = find(parent[id]);
            return parent[id];
        };
        return { find, union(a, b) { const x = find(a), y = find(b); if (x !== y) parent[x] = y; } };
    }

    /**
     * 生成网络分配表。
     * @param {object} data { unifiedPads, remainingVias, tracks, polys, fills }
     * @param {object} opts { padNet:Map<pad,string>, innerCopperLayers:number[] }
     * @returns {{netOf:Map<object,string>, renamed:Set<object>, stats:object}}
     *   · netOf   以「原始图元对象」为键的网络名表
     *   · renamed 因「两个不同网络名被连在一起」而**整块改名**的图元集合。
     *     焊盘在图元生成时默认优先沿用飞针文件的 NET_NAME（飞针才是名字来源），
     *     只有这些图元必须反过来以 netOf 为准，否则会出现
     *     「焊盘 NET_4 / 焊盘 NET_2 / 中间导线 NET1」—— 同一个网络三个名字。
     */
    function buildNetAssignments(data, opts) {
        const prims = netBuildPrims(data, opts || {});
        const stats = { prims: prims.length, clusters: 0, named: 0, generated: 0, reused: 0, mixedClusters: 0, ambiguousClusters: 0, rejectedMerges: 0, renamedMerges: 0, renamedClusters: 0 };
        const netOf = new Map();
        const renamed = new Set();
        if (!prims.length) return { netOf, renamed, stats };

        // ① 空间网格求候选对（坐标单位 mm）
        //    格子边长直接决定候选对数量：一块 52×52 的板子按 5mm 分格，每格平均 500+ 图元，
        //    C(500,2)=12 万对/格 → 全板 800 万对（实测 1.6MB 的板子光是配对就 5 秒）。
        //    改 1.5mm 后每格约 45 个图元，候选对降到 1/10 量级；插入时图元跨的格子更多，
        //    但那只是数组 push，成本远低于几何判定。
        const GRID = 1.0, PAD = 0.5;
        const grid = {};
        prims.forEach(p => {
            const bb = netBBox(p);
            const x0 = Math.floor((bb.x0 - PAD) / GRID), x1 = Math.floor((bb.x1 + PAD) / GRID);
            const y0 = Math.floor((bb.y0 - PAD) / GRID), y1 = Math.floor((bb.y1 + PAD) / GRID);
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    const k = x + ',' + y;
                    (grid[k] || (grid[k] = [])).push(p);
                }
            }
        });

        // ② 并查集
        const uf = netUnionFind();

        // 「已知网络」来自飞针文件的 NET_NAME。两个分量各自带着**不同**的已知网络却被几何判定
        // 相连，说明两者必有一个名字是错的（或几何判定有假象）。
        //
        // 【2026-10-17 变更】以前是**拒绝合并**（保留两个网络）—— 实测某板 GND 走线与 GPIO7
        // 走线中心线只差 0.0877mm 时会被判成相接，拒绝合并能挡住那一次误连，但也会把真正
        // 相连的同名网络拆成孤岛（飞线）。
        // 现在改为：**允许合并，但整块改名为一个未被占用的 NET***（见下方定名阶段），
        // 既不产生"同一网络两个名字"的错乱，也不会让两个网络名静默地各占一半。
        const labelsOf = {};
        prims.forEach(p => {
            const r = uf.find(p.id);
            if (p.net) (labelsOf[r] || (labelsOf[r] = new Set())).add(p.net);
        });
        // 发生过冲突合并的分量根：定名时必须丢弃原有名字，改用新的 NET*
        const conflictRoots = new Set();
        const tryUnion = (a, b) => {
            const ra = uf.find(a.id), rb = uf.find(b.id);
            if (ra === rb) return false;
            const la = labelsOf[ra], lb = labelsOf[rb];
            let conflict = false;
            if (la && lb) {
                let same = false;
                for (const n of la) { if (lb.has(n)) { same = true; break; } }
                if (!same) { conflict = true; stats.renamedMerges++; }
            }
            uf.union(a.id, b.id);
            const nr = uf.find(ra);
            const merged = new Set();
            if (la) la.forEach(n => merged.add(n));
            if (lb) lb.forEach(n => merged.add(n));
            delete labelsOf[ra];
            delete labelsOf[rb];
            if (merged.size) labelsOf[nr] = merged;
            // 冲突标记要向合并后的新根传播（旧根可能已失效）
            if (conflict || conflictRoots.has(ra) || conflictRoots.has(rb)) conflictRoots.add(nr);
            return true;
        };

        let _statPairs = 0, _statConn = 0, _statConnT = 0;
        const _prof = (typeof DEBUG !== 'undefined') && DEBUG;
        const _profT0 = _prof ? performance.now() : 0;
        for (const k in grid) {
            const cell = grid[k];
            if (cell.length < 2) continue;
            const cut = k.indexOf(',');
            const cx = Number(k.substring(0, cut)), cy = Number(k.substring(cut + 1));
            for (let i = 0; i < cell.length; i++) {
                const a = cell[i], ba = netBBox(a);
                for (let j = i + 1; j < cell.length; j++) {
                    const b = cell[j], bb = netBBox(b);
                    // 包围盒不相交 → 绝不可能相连（而且能顺手去掉「同一个图元被塞进多个格子」的重复）
                    const ox0 = ba.x0 > bb.x0 ? ba.x0 : bb.x0;
                    const oy0 = ba.y0 > bb.y0 ? ba.y0 : bb.y0;
                    if (ox0 > (ba.x1 < bb.x1 ? ba.x1 : bb.x1)) continue;
                    if (oy0 > (ba.y1 < bb.y1 ? ba.y1 : bb.y1)) continue;
                    // 去重：只在该对「重叠区最小角」所在的格子里判一次。
                    // 旧实现用 `a.id+'|'+b.id` 字符串做全局 seen（8 百万对 → 几秒 + 数百 MB）；
                    // 重叠区最小角必然落在两者共有的格子里，且只落在一个格子 → 天然不重不漏。
                    if (Math.floor((ox0 - PAD) / GRID) !== cx) continue;
                    if (Math.floor((oy0 - PAD) / GRID) !== cy) continue;
                    _statPairs++;
                    const _t = _prof ? performance.now() : 0;
                    const _ok = netConnected(a, b);
                    if (_prof) { _statConnT += performance.now() - _t; }
                    _statConn++;
                    if (_ok) tryUnion(a, b);
                }
            }
        }
        if (_prof) console.log(`[net-prof] 候选对 ${_statPairs} / 连通判定 ${_statConn} 次，耗时 ${_statConnT.toFixed(0)}ms（总 ${(performance.now()-_profT0).toFixed(0)}ms）`);

        // ③ 分量 → 网络名
        const clusters = {};
        prims.forEach(p => { const root = uf.find(p.id); (clusters[root] || (clusters[root] = [])).push(p); });

        const used = new Set();
        prims.forEach(p => { if (p.net) used.add(p.net); });
        const isGenericNet = (n) => /^NET\d+$/i.test(n);
        let counter = 1;

        for (const root in clusters) {
            const group = clusters[root];
            const votes = new Map();   // 网络名 → 票数（该分量内携带此名的图元数）
            const flying = new Set();  // 该网络名是否来自飞针文件
            group.forEach(p => {
                if (!p.net || p.net === 'null' || p.net === 'undefined') return;
                votes.set(p.net, (votes.get(p.net) || 0) + 1);
                if (p.isFlying) flying.add(p.net);
            });
            // 与参考实现一致：单图元分量不分配网络；但**带飞针网络名**的单个图元要保留
            if (group.length < 2 && !votes.size) continue;
            stats.clusters++;

            let target;
            let isRenamed = false;
            // 需要改名的两种情况：
            //   ① 该分量发生过「两个不同已知网络被直接连上」的冲突合并（conflictRoots）；
            //   ② 分量内**本来就混着**多个不同的已知网络名 —— 两个网络的焊盘通过一段
            //      无名导线/覆铜连到一起时，union 阶段不会触发冲突检测（中间图元没有网络名），
            //      只有到这里看 votes 才能发现。这种情况同样是「两个不同网络连在一起」，
            //      必须改名，否则会按票数静默沿用其中一个。
            if (conflictRoots.has(root) || votes.size > 1) {
                // 两个名字里必有一个是错的，沿用任何一个都会误导，所以**整块换成一个未使用的新名**：
                // 新名一眼可见「这块需要人工核对」，而两个原网络名都从这张表里消失，
                // 不会出现「同一个网络落在两个互不相连的分量上」的飞线。
                while (used.has('NET' + counter)) counter++;
                target = 'NET' + counter;
                used.add(target);
                counter++;
                stats.renamedClusters++;
                if (votes.size > 1) stats.mixedClusters++;
                stats.generated++;
                isRenamed = true;
            } else if (votes.size) {
                if (votes.size > 1) stats.mixedClusters++;
                // ⚠️ 必须按「票数」定名，**不能按名字长短**：分量里常混进少量被误连的异物
                // （实测：GND 覆铜被误连了 1 个 DP 焊盘，按"最短名优先"整块被报成 DP）。
                // 参考实现用的 `a.length - b.length` 就是这条错误规则。
                // 排序：① 票数多者优先（物理证据最强）② 飞针提供的名字优先
                //       ③ 真实名优先于通用 NET* ④ 名字短 ⑤ 字典序（保证结果稳定）
                target = [...votes.keys()].sort((x, y) => {
                    if (votes.get(x) !== votes.get(y)) return votes.get(y) - votes.get(x);
                    const gx = (flying.has(x) ? 0 : 1) * 2 + (isGenericNet(x) ? 1 : 0);
                    const gy = (flying.has(y) ? 0 : 1) * 2 + (isGenericNet(y) ? 1 : 0);
                    if (gx !== gy) return gx - gy;
                    if (x.length !== y.length) return x.length - y.length;
                    return x < y ? -1 : (x > y ? 1 : 0);
                })[0];
                const top = votes.get(target);
                if (top * 2 < group.filter(p => p.net).length) stats.ambiguousClusters++;
                stats.reused++;
            } else {
                while (used.has('NET' + counter)) counter++;
                target = 'NET' + counter;
                used.add(target);
                counter++;
                stats.generated++;
            }
            stats.named++;
            group.forEach(p => {
                netOf.set(p.src, target);
                if (isRenamed) renamed.add(p.src);
            });
        }
        return { netOf, renamed, stats };
    }



