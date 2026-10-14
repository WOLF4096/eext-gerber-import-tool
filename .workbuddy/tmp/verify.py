# -*- coding: utf-8 -*-
"""校验脚本：证明拆分后「原代码零改动、零丢失、零重复」。
不依赖 split.py，独立按偏移重算并逐字节比对。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ORIG = os.path.join(ROOT, ".workbuddy", "tmp", "ImportGerber.html.orig")
NEW_HTML = os.path.join(ROOT, "iframe", "ImportGerber.html")
CSS = os.path.join(ROOT, "iframe", "css", "style.css")
JS_DIR = os.path.join(ROOT, "iframe", "js")

orig = open(ORIG, encoding="utf-8").read()
fails = []


def check(cond, msg):
    print(("  [OK]   " if cond else "  [FAIL] ") + msg)
    if not cond:
        fails.append(msg)


# ---------- 重新计算偏移（与 split.py 独立重算）----------
ST_STYLE = orig.find("<style>")
EN_STYLE = orig.find("</style>")
SC_TAG = orig.find("<script>", EN_STYLE)
SC_END = orig.rfind("</script>")
P_A = orig.find("    // 标准版头文件")
P_B = orig.find("    // 原始图层数据定义")
P_C = orig.rfind("    /**", 0, orig.find("--- 6. PDF 导出功能模块"))
K1, K2, K3, K4, K5, K6, K7, K8 = 28728, 77931, 79655, 94414, 177831, 183569, 239534, 282764
BODY = 28728

# 每个模块由哪些「原文字节区间」组成（按原文顺序）
MODULES = [
    ("01-templates.js", [(P_A, P_B)]),
    ("02-config.js", [(BODY, P_A), (P_B, K2)]),
    ("03-state.js", [(K2, K3)]),
    ("04-gerber-parser.js", [(K3, K4)]),
    ("05-pad-tool.js", [(K4, K5)]),
    ("06-utils.js", [(K5, K6)]),
    ("07-file-io.js", [(K6, P_C)]),
    ("08-export.js", [(P_C, K7)]),
    ("09-ui.js", [(K7, K8)]),
    ("10-init.js", [(K8, SC_END)]),
]

print("=== 1. BOM 与编码 ===")
for name, _ in MODULES:
    raw = open(os.path.join(JS_DIR, name), "rb").read(3)
    check(raw == b"\xef\xbb\xbf", "%s 带 UTF-8 BOM（防服务端缺少 charset 导致中文乱码）" % name)
check(open(CSS, "rb").read(3) == b"\xef\xbb\xbf", "style.css 带 UTF-8 BOM")

print("\n=== 2. 模块内容 = 纯注释头 + 原始代码切片（逐字节）===")
for name, ranges in MODULES:
    text = open(os.path.join(JS_DIR, name), encoding="utf-8-sig").read()
    expected = "".join(orig[a:b] for a, b in ranges)
    ok_tail = text.endswith(expected)
    check(ok_tail, "%-22s 结尾与原码切片逐字节一致 (%6d chars)" % (name, len(expected)))
    if ok_tail:
        prefix = text[:-len(expected)]
        bad = [l for l in prefix.split("\n") if l.strip() and not l.startswith("//")]
        check(not bad, "%-22s 前置内容仅含注释，无任何代码" % name)

print("\n=== 3. 切片按原文顺序无缝覆盖原脚本（无丢失/重复）===")
covered = []
for name, ranges in MODULES:
    covered.extend(ranges)
covered.sort()
cur, gap_ok = BODY, True
for a, b in covered:
    if a != cur:
        gap_ok = False
        print("    断点: 期望 %d 实际 %d" % (cur, a))
    cur = b
check(gap_ok and cur == SC_END, "切片有序、无缝、完整覆盖 [%d, %d) 共 %d 字符" % (BODY, SC_END, SC_END - BODY))
check(len(covered) == len(set(covered)), "无重叠区间")

print("\n=== 4. CSS 与原 <style> 块一致 ===")
style_txt = orig[ST_STYLE + 7:EN_STYLE]
css_txt = open(CSS, encoding="utf-8-sig").read()
check(css_txt.endswith(style_txt), "style.css 结尾与原内联样式逐字节一致 (%d chars)" % len(style_txt))
pfx = css_txt[:-len(style_txt)]
check(pfx.strip().startswith("/*") and pfx.strip().endswith("*/"), "CSS 前置内容为注释块")

print("\n=== 5. HTML 壳：标记结构逐字节一致 ===")
new = open(NEW_HTML, encoding="utf-8").read()
check(new[:ST_STYLE] == orig[:ST_STYLE], "head 前半段（meta/title/库引用与注释，含空行）逐字节未改动")
check('href="/iframe/css/style.css"' in new, "已外链 CSS")
mk_orig = orig[orig.find("<body>") + 6:SC_TAG].strip("\n").rstrip()
i_banner = new.find("    <!-- ==========")
mk_new = new[new.find("<body>") + 6:i_banner].strip("\n").rstrip()
check(mk_new == mk_orig, "body 标记结构逐字节一致 (%d chars)" % len(mk_orig))
check(new.endswith("</body>\n</html>\n"), "结尾结构正确")
check(new.count("cdnjs") == orig.count("cdnjs"), "CDN 注释行未被误改")
n_extra = len(MODULES)
check(new.count("<script src=") == orig.count("<script src=") + n_extra,
      "脚本引用数 = 原有 %d + 拆出 %d" % (orig.count("<script src="), n_extra))

print("\n=== 6. 引用路径存在性 ===")
for m in re.finditer(r'<script src="([^"]+)"', new):
    p = m.group(1)
    if p.startswith("/iframe/"):
        check(os.path.exists(os.path.join(ROOT, p.lstrip("/").replace("/", os.sep))), "存在: %s" % p)
for m in re.finditer(r'<link[^>]+href="([^"]+)"', new):
    p = m.group(1)
    if p.startswith("/iframe/"):
        check(os.path.exists(os.path.join(ROOT, p.lstrip("/").replace("/", os.sep))), "存在: %s" % p)

print("\n=== 7. 加载顺序 ===")
order = re.findall(r'<script src="/iframe/js/(\d[^"]+)"', new)
check(order == [n for n, _ in MODULES], "顺序: %s" % " -> ".join(order))

print("\n" + "=" * 64)
if fails:
    print("失败 %d 项：" % len(fails))
    for f in fails:
        print("   - " + f)
    raise SystemExit(1)
print("全部校验通过：拆分后原代码零改动、零丢失、零重复。")
