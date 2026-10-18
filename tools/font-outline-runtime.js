// ---------------------------------------------------------------------------
// 运行时：按字符查表拼路径（本段由 tools/font-outline.js 原样拼接，可直接编辑）
// ---------------------------------------------------------------------------
// 坐标约定：字形数据是「字体单位、y 向下」（基线 0，字形在基线上方为负），
// 与嘉立创EDA标准版画布的 y 方向一致 —— 直接缩放 + 平移到基线点即可，无需翻转。
// 输出路径统一为 `M x y L x y C x1 y1 x2 y2 x y Z`，坐标对之间用空格分隔。

const FONT_OUTLINE_META = FONT_OUTLINE_DATA.meta;

/** 该字符是否有内置轮廓 */
function fontOutlineHas(ch) {
    return !!FONT_OUTLINE_DATA.glyphs[ch];
}

/** 取字符宽度（em 的倍数），用于排版与居中；缺字按 0.5em 占位 */
function fontAdvanceOf(ch, emUnits) {
    const g = FONT_OUTLINE_DATA.glyphs[ch];
    const upem = FONT_OUTLINE_META.unitsPerEm;
    const adv = g ? g[0] : upem * 0.5;
    return adv / upem * emUnits;
}

/**
 * 把一段文本转成一条轮廓路径。
 *
 * 输出格式 = 标准版 PCB 源码里 `TEXT` 图元的 pathStr（见 docs 的官方样例），
 * 必须与官方导出器**逐字符同构**，否则贴进标准版会整条 TEXT 解析失败：
 *   · 只出现 `M / L / C / Z` 四种命令，命令字母后**不留空格**（`M4037.82 3552L…`），
 *     坐标与坐标之间用一个空格；
 *   · 二次贝塞尔 `Q`（TrueType 字形用的就是 Q）一律转成三次贝塞尔 `C` ——
 *     官方字形轮廓里只有 C，标准版对 Q 的支持不可靠；
 *   · 零长度线段（TrueType 里常见的 `M x y L x y`）直接去掉；
 *   · 每条子路径以 `Z` 闭合，坐标保留 2 位小数。
 *
 * @param {string} text 文本
 * @param {number} emUnits 字号（em 大小，单位与输出坐标一致）
 * @param {object} [opts] { x, y } 基线锚点；缺省从 (0,0) 开始
 * @returns {{ d: string, width: number, missing: string }} d=路径串，width=总宽，missing=缺字
 */
function fontTextToPath(text, emUnits, opts) {
    const upem = FONT_OUTLINE_META.unitsPerEm;
    const s = emUnits / upem;
    const baseX = (opts && typeof opts.x === 'number') ? opts.x : 0;
    const baseY = (opts && typeof opts.y === 'number') ? opts.y : 0;
    const round2 = (v) => {
        let r = Math.round(v * 100) / 100;
        if (Object.is(r, -0)) r = 0;
        return String(r);
    };

    /**
     * 单条字形轮廓 → 标准版 path 片段（缩放 s、平移 dx/dy 后输出）。
     * 只处理字形数据里真实出现的 M/L/Q/Z，顺带兼容 C 与相对命令。
     */
    const emitGlyph = (d, dx, dy) => {
        const toks = String(d).match(/[A-Za-z]|-?\d+(?:\.\d+)?/g);
        if (!toks) return '';
        const out = [];
        const X = (v) => v * s + dx;
        const Y = (v) => v * s + dy;
        let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
        let lastKey = '';   // 上一个已输出点的坐标串（用于去零长线段）
        const ptKey = (x, y) => round2(x) + ' ' + round2(y);
        while (i < toks.length) {
            const raw = toks[i++];
            const u = raw.toUpperCase();
            const rel = raw !== u;
            if (u === 'M') {
                let x = X(parseFloat(toks[i++])), y = Y(parseFloat(toks[i++]));
                if (rel) { x += cx; y += cy; }
                out.push('M' + round2(x) + ' ' + round2(y));
                cx = x; cy = y; sx = x; sy = y;
                lastKey = ptKey(x, y);
            } else if (u === 'L') {
                let x = X(parseFloat(toks[i++])), y = Y(parseFloat(toks[i++]));
                if (rel) { x += cx; y += cy; }
                const key = ptKey(x, y);
                if (key === lastKey) { cx = x; cy = y; continue; }
                out.push('L' + key);
                cx = x; cy = y; lastKey = key;
            } else if (u === 'Q') {
                let qx = X(parseFloat(toks[i++])), qy = Y(parseFloat(toks[i++]));
                let x = X(parseFloat(toks[i++])), y = Y(parseFloat(toks[i++]));
                if (rel) { qx += cx; qy += cy; x += cx; y += cy; }
                // 二次 → 三次：控制点 = 端点 + 2/3（Q 控制点 − 端点），曲线形状完全等价
                const c1x = cx + (qx - cx) * 2 / 3, c1y = cy + (qy - cy) * 2 / 3;
                const c2x = x + (qx - x) * 2 / 3, c2y = y + (qy - y) * 2 / 3;
                out.push('C' + round2(c1x) + ' ' + round2(c1y)
                    + ' ' + round2(c2x) + ' ' + round2(c2y) + ' ' + round2(x) + ' ' + round2(y));
                cx = x; cy = y; lastKey = ptKey(x, y);
            } else if (u === 'C') {
                let c1x = X(parseFloat(toks[i++])), c1y = Y(parseFloat(toks[i++]));
                let c2x = X(parseFloat(toks[i++])), c2y = Y(parseFloat(toks[i++]));
                let x = X(parseFloat(toks[i++])), y = Y(parseFloat(toks[i++]));
                if (rel) { c1x += cx; c1y += cy; c2x += cx; c2y += cy; x += cx; y += cy; }
                out.push('C' + round2(c1x) + ' ' + round2(c1y)
                    + ' ' + round2(c2x) + ' ' + round2(c2y) + ' ' + round2(x) + ' ' + round2(y));
                cx = x; cy = y; lastKey = ptKey(x, y);
            } else if (u === 'Z') {
                out.push('Z');
                cx = sx; cy = sy; lastKey = ptKey(cx, cy);
            } else {
                // 未知命令：不往外抛，宁少画一个字形也不要整条 TEXT 报废
                break;
            }
        }
        return out.join('');
    };

    let pen = 0;
    let missing = '';
    const parts = [];
    for (const ch of String(text === null || text === undefined ? '' : text)) {
        const g = FONT_OUTLINE_DATA.glyphs[ch];
        if (!g) {
            missing += ch;
            pen += upem * 0.5;   // 缺字留半角空位，避免后面的字挤在一起
            continue;
        }
        if (g[1]) {
            const seg = emitGlyph(g[1], baseX + pen * s, baseY);
            if (seg) parts.push(seg);
        }
        pen += g[0];
    }
    return { d: parts.join(''), width: pen * s, missing: missing };
}

/**
 * 以 capHeight = targetMil 反算 em 尺寸（mil）。
 * PCB 说的「字高」一般指字符实高（cap height），而 TEXT 图元的字号参数是 em。
 */
function fontEmForCapHeight(capMil) {
    const ratio = FONT_OUTLINE_META.capHeight / FONT_OUTLINE_META.unitsPerEm;
    return ratio > 0 ? capMil / ratio : capMil / 0.72;
}
