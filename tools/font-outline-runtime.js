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
        const r = Math.round(v * 100) / 100;
        return Object.is(r, -0) ? '0' : String(r);
    };
    // 把字形路径的每一对坐标 (x,y) 缩放后平移到笔位
    const place = (d, dx) => d.replace(
        /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
        (m, a, b) => round2(parseFloat(a) * s + dx) + ' ' + round2(parseFloat(b) * s + baseY)
    );

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
        if (g[1]) parts.push(place(g[1], baseX + pen * s));
        pen += g[0];
    }
    return { d: parts.join(' '), width: pen * s, missing: missing };
}

/**
 * 以 capHeight = targetMil 反算 em 尺寸（mil）。
 * PCB 说的「字高」一般指字符实高（cap height），而 TEXT 图元的字号参数是 em。
 */
function fontEmForCapHeight(capMil) {
    const ratio = FONT_OUTLINE_META.capHeight / FONT_OUTLINE_META.unitsPerEm;
    return ratio > 0 ? capMil / ratio : capMil / 0.72;
}
