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

    // --- [新增] UUID 生成辅助函数 (无连字符格式) ---
    function generateUUID() {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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

    // --- [新增] 全局日志工具函数 ---
    function appLog(msg) {
        const area = document.getElementById('debug-source-area');
        if (!area) return;
        
        const now = new Date();
        // const yyyy = now.getFullYear();
        // const mm = String(now.getMonth() + 1).padStart(2, '0');
        // const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        
        // const timeStr = `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
        const timeStr = `${hh}:${min}:${ss}`;
        area.value += `${timeStr} ${msg}\n`;
        
        // 自动滚动到底部
        area.scrollTop = area.scrollHeight;
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

    // 把宏基元转成「中心在 (cx,cy)、已换算到 mm」的路径。
    // 清除基元（exposure === 'C'）也要放进路径：配合 fill('evenodd') 正好形成孔洞。
    function macroPrimsToPath(shape, cx, cy, scale) {
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

        // 统一判断版本逻辑 (兼容传入 'pro_v3', 'V3专业版' 等情况)
        const isV3 = version && (version.includes('V3') || version === 'pro_v3');

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


    // --- 辅助：获取当前环境信息 ---
    function getEnvInfo() {
        let clientVer = 'browser';
        let isEdaEnv = false;

        if (typeof eda !== 'undefined') {
            isEdaEnv = true;
            const verStr = eda.sys_Environment.getEditorCurrentVersion(); // "2.2.45.5"
            if (verStr.startsWith('2')) clientVer = 'pro_v2';
            else if (verStr.startsWith('3')) clientVer = 'pro_v3';
        }
        return { clientVer, isEdaEnv };
    }



