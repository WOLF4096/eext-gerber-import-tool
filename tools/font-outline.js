#!/usr/bin/env node
/**
 * 字体轮廓提取工具 —— 把 TTF/OTF 的字形轮廓抽出来，生成扩展内置的字体数据文件。
 *
 * 用途：嘉立创EDA「标准版」的 TEXT 图元必须自带文本轮廓（`TEXT~L~x~y~…~文本~M…Z~…`），
 *      而浏览器 / EDA iframe 里拿不到字体的矢量路径（canvas 只能画、不能导出 path）。
 *      所以必须**离线**把字形轮廓提取成数据，随扩展一起打包，运行时按字符查表拼 path。
 *
 * 用法：
 *   node tools/font-outline.js                              # 默认 ASCII 0x20-0x7E
 *   node tools/font-outline.js --extra "从电源地"            # 追加指定字符
 *   node tools/font-outline.js --range 0x4E00-0x9FA5        # 追加一段码位（GB2312 一级字约 0x4E00-0x9FA5）
 *   node tools/font-outline.js --font "C:/x/Font.ttf" --out iframe/js/11-font-outline.js
 *
 * 依赖 opentype.js（仅本工具需要，不进扩展包）：
 *   npm i opentype.js --prefix Temp/fonttest --no-save
 *   NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js
 */

const fs = require('fs');
const path = require('path');

let opentype;
try {
    opentype = require('opentype.js');
} catch (e) {
    console.error('缺少 opentype.js。先安装：');
    console.error('  npm i opentype.js --prefix Temp/fonttest --no-save');
    console.error('  NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js');
    process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argOf = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const FONT_FILE = argOf('--font', 'C:/Windows/Fonts/NotoSansSC-VF.ttf');
const OUT_FILE = argOf('--out', path.join(ROOT, 'iframe/js/11-font-outline.js'));
const FAMILY = argOf('--family', 'NotoSansCJKsc-DemiLight');   // 与 EDA 源码里写的字体名一致
const EXTRA = argOf('--extra', '');
const RANGE = argOf('--range', '');

// ---------------- 字符集 ----------------
const chars = new Set();
for (let c = 0x20; c <= 0x7e; c++) chars.add(String.fromCharCode(c));   // 可打印 ASCII
for (const ch of EXTRA) chars.add(ch);
if (RANGE) {
    const m = /^0x([0-9a-f]+)-0x([0-9a-f]+)$/i.exec(RANGE.trim());
    if (!m) { console.error('--range 格式应为 0x4E00-0x9FA5'); process.exit(1); }
    const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
    for (let cp = a; cp <= b; cp++) {
        try { chars.add(String.fromCodePoint(cp)); } catch (e) { /* 跳过孤立代理 */ }
    }
}

// ---------------- 读取字体 ----------------
if (!fs.existsSync(FONT_FILE)) {
    console.error('找不到字体文件：' + FONT_FILE);
    process.exit(1);
}
const buf = fs.readFileSync(FONT_FILE);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const upem = font.unitsPerEm || 1000;

/**
 * 序列化一条字形路径。统一成「空格分隔的坐标对」：
 *   M x y  L x y  Q cx cy x y  C c1x c1y c2x c2y x y  Z
 * 这样运行时的平移可以安全地用「成对数字」正则处理。
 *
 * ⚠️ 每条子路径**必须显式闭合**：opentype 的 getPath 不输出 Z，
 *    而标准版 TEXT 的轮廓要求闭合（官方样例都以 Z 结尾）。
 *    不闭合时 EDA 会把它当折线而非字形轮廓，填充直接失败。
 */
function serialize(p) {
    const f = (n) => {
        const v = Math.round(n * 100) / 100;
        return Object.is(v, -0) ? '0' : String(v);
    };
    const out = [];
    let open = false;
    for (const c of p.commands) {
        switch (c.type) {
            case 'M':
                if (open) out.push('Z');
                out.push('M ' + f(c.x) + ' ' + f(c.y));
                open = true;
                break;
            case 'L': out.push('L ' + f(c.x) + ' ' + f(c.y)); open = true; break;
            case 'Q': out.push('Q ' + f(c.x1) + ' ' + f(c.y1) + ' ' + f(c.x) + ' ' + f(c.y)); open = true; break;
            case 'C': out.push('C ' + f(c.x1) + ' ' + f(c.y1) + ' ' + f(c.x2) + ' ' + f(c.y2) + ' ' + f(c.x) + ' ' + f(c.y)); open = true; break;
            case 'Z': out.push('Z'); open = false; break;
            default: break;   // 忽略 opentype 内部其它命令
        }
    }
    if (open) out.push('Z');
    return out.join(' ');
}

const glyphs = {};
let missing = 0;
const missingList = [];

for (const ch of chars) {
    const g = font.charToGlyph(ch);
    // charToGlyph 对不存在的字符会返回 .notdef（index 0）
    if (!g || g.index === 0) { missing++; missingList.push(ch); continue; }
    // getPath(0,0,upem) 的输出是「屏幕坐标」：y 向下，字形位于基线之上（y 为负）。
    // 这与标准版画布的 y 方向一致，运行时直接平移到基线点即可。
    const p = g.getPath(0, 0, upem);
    const d = serialize(p);
    if (!d) continue;   // 空格等无轮廓字形
    glyphs[ch] = [Math.round(g.advanceWidth || 0), d];
}

// ---------------- 生成数据文件 ----------------
const capRaw = (font.tables.os2 && font.tables.os2.sCapHeight) || 0;
// 用实际字形的 cap 高度（取 'H' 的 bbox 更可靠，OS/2 的 sCapHeight 有字体没填）
let capHeight = capRaw;
const Hg = font.charToGlyph('H');
if (Hg && Hg.index !== 0) {
    const bb = Hg.getPath(0, 0, upem).getBoundingBox();
    const h = Math.abs(bb.y1);
    if (h > 0) capHeight = Math.round(h * 100) / 100;
}

const meta = {
    family: FAMILY,
    source: path.basename(FONT_FILE),
    unitsPerEm: upem,
    ascender: font.ascender,
    descender: font.descender,
    capHeight: capHeight
};

const header = [
    '// 由 tools/font-outline.js 自动生成，请勿手工编辑。',
    '// 字体：' + meta.family + '（源文件 ' + meta.source + '，unitsPerEm ' + upem + '）',
    '// 字形数：' + Object.keys(glyphs).length + '　生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '),
    '// 字形坐标为字体单位、y 向下（基线为 0，字形在基线上方为负），运行时按 em/unitsPerEm 缩放。',
    '// 重新生成：NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js',
    ''
].join('\n');

const body = 'const FONT_OUTLINE_DATA = ' + JSON.stringify({
    meta: meta,
    glyphs: glyphs
}, null, 0) + ';\n';

// 运行时渲染函数（与数据同文件，工具生成 → 数据/逻辑不会脱节）
const runtime = fs.readFileSync(path.join(__dirname, 'font-outline-runtime.js'), 'utf8');

const out = '\uFEFF' + header + body + '\n' + runtime;
fs.writeFileSync(OUT_FILE, out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('字体      : ' + meta.family + '（' + meta.source + '）');
console.log('unitsPerEm: ' + upem + '　capHeight: ' + capHeight + '（cap/em = ' +
    (capHeight / upem).toFixed(3) + '）');
console.log('字形      : ' + Object.keys(glyphs).length + ' 个' +
    (missing ? '，缺字 ' + missing + ' 个' + (missingList.length <= 12 ? '（' + missingList.join('') + '）' : '') : ''));
console.log('输出      : ' + path.relative(ROOT, OUT_FILE) + '（' + kb + ' KB）');
