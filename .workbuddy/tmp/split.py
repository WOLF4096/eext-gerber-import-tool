# -*- coding: utf-8 -*-
"""一次性脚本：把 iframe/ImportGerber.html 拆分为 css/ + js/ 多模块，并重写 HTML 壳。
核心原则：所有原有代码按【字节范围】搬运，不改一个字符；只额外前置模块说明注释。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "iframe", "ImportGerber.html")
BACKUP = os.path.join(ROOT, ".workbuddy", "tmp", "ImportGerber.html.orig")
if not os.path.exists(BACKUP):          # 首次运行：先备份原始单文件
    import shutil
    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    shutil.copy2(SRC, BACKUP)
SRC_READ = BACKUP                        # 始终以原始单文件为切分来源，保证可重复执行
OUT_HTML = SRC
OUT_CSS = os.path.join(ROOT, "iframe", "css", "style.css")
JS_DIR = os.path.join(ROOT, "iframe", "js")

s = open(SRC_READ, encoding="utf-8").read()

# ---------- 1. 定位三大区段 ----------
ST_STYLE = s.find("<style>")
EN_STYLE = s.find("</style>")
assert ST_STYLE > 0 and EN_STYLE > ST_STYLE
SC_TAG = s.find("<script>", EN_STYLE)          # 主脚本起始标签
SC = SC_TAG + len("<script>")                  # 主脚本内容起点
SC_END = s.rfind("</script>")                  # 主脚本结束标签
assert 0 < SC < SC_END

# ---------- 2. 子切点 ----------
P_A = s.find("    // 标准版头文件")                 # 模板区起点
P_B = s.find("    // 原始图层数据定义")             # 图层数据区起点
i_pdf = s.find("--- 6. PDF 导出功能模块")
P_C = s.rfind("    /**", 0, i_pdf)               # 文件IO / 导出 分界
SEC = [28728, 77931, 79655, 94414, 177831, 183569, 239534, 282764]
SCRIPT_BODY_START = 28728        # 跳过脚本内容开头两个空行
for p in (P_A, P_B, P_C):
    assert SC < p < SC_END, (p, SC, SC_END)
assert SCRIPT_BODY_START < P_A < P_B < SEC[1], (P_A, P_B, SEC[1])
assert SEC[5] < P_C < SEC[6], (P_C, SEC[5], SEC[6])
print("切点: P_A=%d P_B=%d P_C=%d" % (P_A, P_B, P_C))

# ---------- 3. 有序切片（按原文顺序，用于等价性断言）----------
ordered = [
    (SCRIPT_BODY_START, P_A),      # 调试开关 + 全局变量  -> 02
    (P_A, P_B),                    # 工程模板常量        -> 01
    (P_B, SEC[1]),                 # 图层定义数据        -> 02
    (SEC[1], SEC[2]),              # 全局状态            -> 03
    (SEC[2], SEC[3]),              # 解析器              -> 04
    (SEC[3], SEC[4]),              # 逆向还原引擎        -> 05
    (SEC[4], SEC[5]),              # 辅助工具            -> 06
    (SEC[5], P_C),                 # 文件导入与解析调度  -> 07
    (P_C, SEC[6]),                 # 导出控制器          -> 08
    (SEC[6], SEC[7]),              # UI 渲染与交互       -> 09
    (SEC[7], SC_END),              # 初始化入口          -> 10
]
joined = "".join(s[a:b] for a, b in ordered)
assert joined == s[SCRIPT_BODY_START:SC_END], "切片未能无缝覆盖原脚本！"
print("[OK] 有序切片拼接 == 原脚本内容 (%d chars)" % len(joined))

# ---------- 4. 模块定义（文件名 -> (说明头, 组成切片列表)）----------
HEAD = {}
HEAD["01-templates.js"] = """// ====================================================================================
// 01-templates.js  —  工程文件头模板常量
// ------------------------------------------------------------------------------------
// 职责：存放导出「嘉立创 EDA 工程文件」时使用的源码头模板（纯数据，无逻辑）。
//   · LCEDA_STD_Head_Source —— 标准版头文件（当前为空串，预留）
//   · LCEDA_V2_Head_Source  —— 专业版 V2 头（["DOCTYPE","PCB","1.8"] 行格式）
//   · LCEDA_V3_Head_Source  —— 专业版 V3 头（{"type":"DOCHEAD"}||{...} 行格式）
// 依赖：无。被 08-export.js 的 configureHeader() / exportForEasyEDA_Pro() 运行时读取。
// 注意：本文件是「由 EDA 导出的模板文本」，请勿手工格式化或调整缩进 ——
//       模板内容会被逐行解析，改动空白可能导致导出文件解析失败。
// 加载顺序：第 1 个
// ====================================================================================
"""

HEAD["02-config.js"] = """// ====================================================================================
// 02-config.js  —  运行配置与图层定义数据
// ------------------------------------------------------------------------------------
// 职责：调试开关、全局变量，以及 Gerber 图层识别与展示所需的全部静态数据。
//   · DEBUG / currentZipName / flyingProbeData        —— 调试开关与全局变量
//   · rawLayerData / cnNames / layerDefs / layerIdMap —— 图层定义与中文名映射
//   · uiGroups / allGroupedIds                        —— 侧栏图层分组
//   · fileNameRules / easyEdaRules / customPatternRules / extensionRules —— 文件名识别规则
// 依赖：无（本文件内自执行若干 for/forEach 完成初始化）。
// 说明：工程文件头模板常量已拆分至 01-templates.js。
// 加载顺序：第 2 个
// ====================================================================================
"""

HEAD["03-state.js"] = """// ====================================================================================
// 03-state.js  —  运行时状态、画布上下文与协议弹窗
// ------------------------------------------------------------------------------------
// 职责：
//   · 全局可变状态：rawFilesCache / loadedFiles / viewState
//   · 主画布与标尺的 2D 上下文、离屏缓冲画布
//   · 「免责声明 / 二次确认」弹窗控制（confirmAction / handleDisclaimer）
// 依赖：本文件在【加载时即访问 DOM】（#main-canvas / #ruler-h / #ruler-v），
//       因此所有脚本必须放在 </body> 之前，且本文件早于 09-ui.js。
// 加载顺序：第 3 个
// ====================================================================================
"""

HEAD["04-gerber-parser.js"] = """// ====================================================================================
// 04-gerber-parser.js  —  RS-274X 解析器
// ------------------------------------------------------------------------------------
// 职责：class GerberParser（parse / handleExt / handleStd / updateBounds / record）。
//       把 Gerber 图形文件与钻孔文件文本解析为统一的指令数组 commands 与光圈表 apertures。
//       支持 %FS %MO %ADD %AM、G36/G37 区域填充、G85 槽孔、LPD/LPC 极性、
//       M48 钻孔刀具表、G01/G02/G03 直线与圆弧插补。
// 依赖：无。产出由 05-pad-tool.js 消费。
// 加载顺序：第 4 个
// ====================================================================================
"""

HEAD["05-pad-tool.js"] = """// ====================================================================================
// 05-pad-tool.js  —  逆向还原引擎（Reverse Engineering Tool）
// ------------------------------------------------------------------------------------
// 职责：const PadTool —— 本项目技术核心，将 Gerber 矢量图形「智能聚合」为 EDA 逻辑图元。
//   · extractRawData      从各图层提取 焊盘/过孔/导线/多边形/填充/钻孔/图片/文字
//   · consolidate         聚合归并，把零散矢量图元还原为逻辑图元
//   · generatePrimitives  生成 V2 数组格式 或 V3 "元信息||内容" 图元字符串
//   · toMil / calcRadiusRatio  单位与圆角换算工具
// 依赖：rawFilesCache（03-state.js）在运行时读取；被 08-export.js 调用。
// 加载顺序：第 5 个
// ====================================================================================
"""

HEAD["06-utils.js"] = """// ====================================================================================
// 06-utils.js  —  通用工具函数
// ------------------------------------------------------------------------------------
// 职责：与业务无关、可被任意模块复用的基础函数。
//   mapNameToId / generateUUID / downloadBlobAsFile / downloadStringAsFile /
//   appLog / isGerberText / calculateMaxId / copyDebugSource / getEnvInfo
// 依赖：无（appLog 运行时访问 #debug-source-area，getEnvInfo 运行时访问 eda 全局对象）。
// 加载顺序：第 6 个
// ====================================================================================
"""

HEAD["07-file-io.js"] = """// ====================================================================================
// 07-file-io.js  —  文件导入与解析调度
// ------------------------------------------------------------------------------------
// 职责：
//   · handleFiles            读取 Gerber 压缩包 / 散装文件并解析
//   · processRawFiles        按配置重新解析缓存原文（切换单位/精度时调用）
//   · autoDetectSettings     自动识别板层数量、板子类型、坐标精度与单位
//   · importCurrentGerber    通过 API 获取「当前板子」的 Gerber 数据
// 依赖：03-state.js、04-gerber-parser.js、05-pad-tool.js、06-utils.js，
//       以及 09-ui.js 中的渲染函数（均为运行时调用）。
// 加载顺序：第 7 个
// ====================================================================================
"""

HEAD["08-export.js"] = """// ====================================================================================
// 08-export.js  —  导出控制器
// ------------------------------------------------------------------------------------
// 职责：全部导出入口与实现。
//   · window.exportPDF            位图 PDF 导出（DPI 300/600/900/1200）
//   · window.handleExportToCanvas 注入当前 PCB 画布（源码注入 / 图元注入）
//   · window.handleExportProV2 / handleExportProV3   导出工程文件（.epcb / .epro2）
//   · window.handleExportStandard 导出标准版（尚未实现，仅提示）
//   · configureHeader / configureBlindViasAPI        按板层与埋盲孔规则给模板头打补丁
//   · exportForEasyEDA_Pro / exportForOther_Pro / importPrimitivesAPI / exportForStandard
//   · window.generateDebugSource  生成调试源码（输出到文本框）
// 依赖：01-templates.js（模板常量）、05-pad-tool.js（图元生成）、
//       06-utils.js、03-state.js。
// 加载顺序：第 8 个
// ====================================================================================
"""

HEAD["09-ui.js"] = """// ====================================================================================
// 09-ui.js  —  UI 渲染与交互
// ------------------------------------------------------------------------------------
// 职责：
//   · 图层表格渲染 renderLayerTable，分组与图层类型下拉初始化渲染
//   · 画布绘制 drawCanvas / resizeCanvas / requestDraw / drawRulers / autoFitView
//   · Tab 切换、单位切换、DPI 选择、板层数与板子类型等交互
//   · 缩放 / 平移 / 框选，以及挂到 window 上供 HTML 内联 onclick 调用的处理函数
// 依赖：03-state.js（画布上下文）、02-config.js（图层数据）。
// 注意：本文件在【加载时】即为画布注册 wheel / mousedown / contextmenu 等监听。
// 加载顺序：第 9 个
// ====================================================================================
"""

HEAD["10-init.js"] = """// ====================================================================================
// 10-init.js  —  初始化与全局事件
// ------------------------------------------------------------------------------------
// 职责：
//   · initLayerSelect     图层类型下拉初始化
//   · 拖拽导入：dragenter / dragleave / dragover / drop（含全屏遮罩层）
//   · window.resetConfig / window.reparseFiles  恢复默认设置 / 应用参数并重载
//   · DOMContentLoaded 初始化、窗口 resize 监听、首屏尺寸与绘制
// 依赖：必须最后加载 —— 加载时会立即调用 09-ui.js 的 resizeCanvas() 与 drawCanvas()。
// 加载顺序：第 10 个（最后）
// ====================================================================================
"""

MODULES = [
    ("01-templates.js", [1]),
    ("02-config.js", [0, 2]),
    ("03-state.js", [3]),
    ("04-gerber-parser.js", [4]),
    ("05-pad-tool.js", [5]),
    ("06-utils.js", [6]),
    ("07-file-io.js", [7]),
    ("08-export.js", [8]),
    ("09-ui.js", [9]),
    ("10-init.js", [10]),
]

BOM = b"\xef\xbb\xbf"


def write_text(path, text, bom=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = text.encode("utf-8")
    if bom:
        data = BOM + data
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


# ---------- 5. 写出 CSS ----------
css = s[ST_STYLE + len("<style>"):EN_STYLE]
css_out = ("/* ====================================================================================\n"
           "   style.css  —  界面样式表\n"
           "   ------------------------------------------------------------------------------------\n"
           "   来源：由原 iframe/ImportGerber.html 的内联 <style> 块原样拆出，样式内容未做任何修改。\n"
           "   分区：CSS 变量与重置 → 画布与标尺 → 侧边栏框架与 Tab → 通用控件 →\n"
           "         图层表格 → 导出面板 → 弹窗与遮罩 → 调试面板。\n"
           "   ==================================================================================== */\n") + css
n_css = write_text(OUT_CSS, css_out, bom=True)
print("[OK] css/style.css  %d bytes" % n_css)

# ---------- 6. 写出 JS 模块 ----------
written = []
for fname, idxs in MODULES:
    parts = "".join(s[ordered[i][0]:ordered[i][1]] for i in idxs)
    text = HEAD[fname] + "\n" + parts
    n = write_text(os.path.join(JS_DIR, fname), text, bom=True)
    written.append((fname, n, len(parts)))
    print("[OK] js/%-22s %6d bytes (原码 %6d)" % (fname, n, len(parts)))

# ---------- 7. 重写 HTML 壳 ----------
link = '<link rel="stylesheet" href="/iframe/css/style.css">'
# head 前半段完全保留（含原有空行），仅把 <style>...</style> 整块替换为外链
head = s[:ST_STYLE] + link + "\n"
mid = s[EN_STYLE + len("</style>"):SC_TAG].lstrip("\n").rstrip() + "\n"
app_scripts = [
    "01-templates.js", "02-config.js", "03-state.js", "04-gerber-parser.js",
    "05-pad-tool.js", "06-utils.js", "07-file-io.js", "08-export.js",
    "09-ui.js", "10-init.js",
]
banner = (
    "    <!-- ==========================================================================\n"
    "         应用脚本：以下顺序不可调整 —— 后置模块依赖前置模块的全局定义。\n"
    "           jszip / jspdf 已在上方 <head> 中加载。\n"
    "         EDA 环境使用绝对路径 /iframe/...；若需直接用浏览器打开本文件，\n"
    "         请把 /iframe/css/ 与 /iframe/js/ 前缀改为相对路径 css/ 与 js/。\n"
    "         ========================================================================== -->\n"
)
tags = "\n".join('    <script src="/iframe/js/%s"></script>' % n for n in app_scripts)
tail = s[SC_END + len("</script>"):]
new_html = head + mid + banner + tags + tail
write_text(OUT_HTML, new_html, bom=False)
print("[OK] ImportGerber.html   %d bytes (原 %d)" % (len(new_html.encode("utf-8")), len(s.encode("utf-8"))))

# ---------- 8. 结论 ----------
print("\n=== 校验 ===")
print("原脚本内容长度 :", len(s[SCRIPT_BODY_START:SC_END]))
print("模块原码总长度 :", sum(x[2] for x in written))
assert sum(x[2] for x in written) == len(s[SCRIPT_BODY_START:SC_END])
print("[OK] 全部原码字节数吻合，无丢失无重复")
