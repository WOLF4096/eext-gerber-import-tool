# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

> 精简版（只留铁律与坑）。完整细节见 `DEV.md`（结构/构建/调试）、`docs/开发日志.md`（逐版本实现）、`CHANGELOG.md`（用户摘要）。

## 1. 结构与铁律
- 嘉立创EDA**专业版**扩展；产品 = `iframe/` 单页应用，`src/index.ts` 是壳，改功能只改 `iframe/`。
- `iframe/js/` 数字前缀 = 加载顺序（不可调，**经典 script 禁 type=module**）；`.js/.css` 带 UTF-8 BOM；别反缩进（模板字面量敏感空白）。
- ⚠️ **HTML 资源路径靠 `<base>` 运行时定**：`ImportGerber.html`/`About.html` 的 `<head>` 最前面有内联脚本，同步 XHR 探 `js/reward.js`，先试 `/iframe/` 再试文档所在目录，命中者写成 `<base href>`；引用本身写相对路径（`js/x.js`、`css/style.css`、`../images/x.png`）。
  **不要写死 `/iframe/...`**（Pages 子路径部署全站 404）；**也别以为相对路径在 EDA 里能用** —— `openIFrame` 参数是 `htmlFileName`，EDA 按文件名取页面，文档 URL 不是 `/iframe/xxx.html`。新增资源照此办理，别再改回固定写法。
- 版本以 `extension.json` 为准（`package.json` 同步）→ `npm run build`。临时文件 `Temp/`、分析文档 `docs/`（不进包）。
- 打包排除清单 = 根目录 **`.edaignore`**（`build/packaged.ts` 读取，必须跟踪；新目录/无关文件先加这里再 build）。
  `.workbuddy/`、`.idea/`、`Temp/`、`tools/`、`docs/`、`src/`、`config/`、`build/` 均已排除；运行期图片只留 logo/reward_qrcode/wx。
- 顶层 `const` 是全局词法作用域：裸名可访问，`window.xxx` 读不到。

## 2. 处理模式
仅两项：`easyedapro` / `rs274x`。新增需同步 HTML option、script、resetConfig 三处。

## 3. 单位 / 坐标（混用必错 25.4 倍）
坐标 `mmOf()`（已 mm），光圈/宏 `toMM()`（文件单位→mm）。标准版 1 单位 = 10mil = 0.254mm。
⚠️ `stdX/stdY` 返回字符串，算术前 `parseFloat`。

## 4. Gerber 解析
`extractRawData` 靠嘉立创私有 `G04` 标记；无标记走 `hasSectionMarkers`（层 + 指令推断）。
跨文件配点必须容差（0.05mm 栅格归并；`toFixed(3)` 精确键会大面积配不上）；焊盘去重带 `layerId`。
过孔 vs 插件盘：钻孔 ≥0.6mm 且铜环 ≥0.25mm。

## 5. 图元生成（05-pad-tool / Clipper）—— 坑最多
- 负片覆铜带孔：单环不能带孔 → 必须开 **keyhole 缝**拆成无孔多边形（Prim 最小生成树搭缝，整树只开 1 条朝最近边界的出口缝）。
  ⚠️ **禁止「拆完每块向外膨胀」合缝**（孔变内部洞被填死）。FILL 的 **width 必须 0**。
- 拆分完必须把离散弦**还原成 ARC**（`fillRingToOpsWithArcs`）；⚠️ 别靠压小 `FILL_ARC_TOL` 换精度（顶点暴涨）。
- 宏基元必须**布尔并集**（`macroBuildRings` + `_macroRingCache`）；同批 subject 方向相反会被当孔 → `fillRingArea<0` 就 reverse。
- 整圆：起点 = 终点 360° 弧，导出拆两段 180°。
- `createComplexPolygon` 入参是多块数组；单元素嵌套 `[[ring]]` 会被当平铺 → undefined。「平铺优先 + 多重兜底」。

## 6. 标准版导出（buildStandardSource）
没有 POLY：折线全转 TRACK（相邻同层/同宽/同网/0.001mm 相接 → 链式合并，ARC 不合并）。
**板层数由 `layers` 表决定**（内层行 visible=false 就按 2 层板打开）。Text 段按 PolygonModel（仅标准版传 `textAsPoly:true`）。
TEXT 位号：path 只允许 M/L/C/Z，Q 转 C，坐标过 `flyingLengthScaleMM()`。

## 7. 字体轮廓
`11-font-outline.js`：`fontTextToPath`，ASCII 0x20-0x7E。NotoSansSC-VF 是可变字体，先 instancer（wght=350）。字高 = cap height。

## 8. 物理网络（buildNetAssignments）
开关 `tryNetlist`。字段：`TRACK[3]/ARC[3]/CIRCLE[8]/SOLIDREGION[2]/PAD[7]/VIA[4]`。
两已知网络落同一连通块 → 整块改名未占用 `NET*`，**必须同时改焊盘**（`renamed` + `isNetRenamed`）。
性能改造别改回：边索引 + y 分带、Clipper 求交（缓存挂图元对象非 id）、DP 0.05mm、网格 1mm。

## 9. 飞针标注 / 位号 / 补强标注
虚拟层 2001-2005（并入「自定义/特殊」组）。匹配先按焊盘铜层限定面（pad.top→T / bottom→B）。
⚠️ 飞针坐标单位是 **mil**（统一走 `flyingLengthScaleMM`）。**「尝试生成网络」只控网络名**，`flyIndex` 必须无条件构建（否则焊盘编号退化、位号全丢）。
字高导出 30mil；画布 16、上限 20。位号专业版写装配层（9/10）、标准版文档层 12。

## 10. FPC 补强
文件名 `*StiffenerLayer_<材料码>_<厚度>.GTSL/.GBSL`，顶 58 / 底 59。未知材料码不猜（几何保留、材料不写）。
**只能「源码导入」**：`pcb_PrimitiveFill.create(58/59)` 无效，图元模式跳过 + 吐司。

## 11. 专业版 V4
图元行与 V3 逐字节同构，仅文档头不同。`getEnvInfo()` 首字符 2/3/4 → pro_v2/v3/v4。V4 不导出工程文件，只写画布。

## 12. 渲染 / 交互 / 门控
高 DPI：`drawCanvas` 进入无条件 `setTransform(dpr,...)`，`watchDprChanges()` 用 matchMedia 监听并重挂。
缩放/平移走快照（停手 150ms 补全）；导出/PDF 不走快照。PCB 门控 `detectPcbCanvasContext()`。
用户协议 `#cfg-agree`（未勾选只灰显）。「关于」= About.html + about.js，registerFn 与 index.ts 同名。

## 13. 性能（别丢）
21MB/18 层/30.5 万指令：V3.9.11 **2325ms**。拐点 = 飞针层多跑 extractRawData 把 `mergeSegments` O(n²) 跑满 → 已改栅格索引 O(n)，**禁止改回全表扫**。`autoFitView` 分位数抽样 ≤6 万点。

## 14. 已知缺口
宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；`LCEDA_STD_Head_Source` 空串；api 模式强制 pro_v2（isV3 未用）；标准版不导出埋盲孔；真彩图片离线无解。协议责任条款一字不动。

## 15. 本地调试
`python tools/serve.py` → `http://127.0.0.1:8456/iframe/ImportGerber.html`。站点根 = 项目根（页面在 `/iframe/xxx.html`，故相对路径可直接用），注入 eda mock，改文件自动刷新。⚠️ 本机探本机端口加 `--noproxy '*'`。env 里的 `http_proxy=127.0.0.1:1317` 是死的；**GitHub 唯一可用代理 = `127.0.0.1:7890`**（直连会超时）。

## 16. 界面 / 日志规范
日志 `appLog` 一阶段一行「${label}，耗时…」，禁 emoji / `-----`，不写实现细节。勾选行整行可点用 `<label for>`；含链接须 `onAgreeRowClick` 提前 return。

## 17. 文档联动（重要）
- **两份更新日志都要写**：根 `CHANGELOG.md`（面向用户，每行 40~60 字、不出现文件名）＋ `docs/开发日志.md`（完整细节，旧条目不删）。
- 功能改动同步：`README.md`（用户）→ `DEV.md`（开发者）→ `ImportGerber.html` → `About.html`；`docs/README.md` 索引补链接。
