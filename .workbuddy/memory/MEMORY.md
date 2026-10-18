# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

> 2026-10-18 三次精简（超限会被截断）。细节历史见 CHANGELOG.md 与 `.workbuddy/memory/YYYY-MM-DD.md`。

## 1. 结构与铁律
嘉立创EDA**专业版**扩展；产品是 `iframe/` 单页应用，`src/index.ts` 只是壳。改功能只改 `iframe/`。
- `iframe/js/` 数字前缀=加载顺序（不可调，**经典 script，禁止 type=module**）：01-templates 02-config
  03-state 04-gerber-parser 05-pad-tool 06-utils 07-file-io 08-export 09-ui 10-init 11-font-outline
  + clipper.js(6.4.2) + jszip/jspdf。`processors/`：registry + industry-common + industry-rs274x + jlc-internal。
- 脚本放 `</body>` 前；引用绝对路径 `/iframe/...`；`.js/.css` 带 **UTF-8 BOM**；不要反缩进（模板字面量敏感空白）。
- 版本以 `extension.json` 为准（`package.json` 同步）→ `npm run build` → `build/dist/*.eext`。
- 临时文件放 `Temp/`，分析文档放 `docs/`（不进包）。
- 顶层 `const` 在经典 script 里是**全局词法作用域**：裸名可访问，但 `window.xxx` 读不到；
  测试里 `window.rawFilesCache=` 会静默测错版本。

## 2. 处理模式（仅两项）
`#cfg-source-type`：`easyedapro` / `rs274x`。新增要同步 HTML option、script、resetConfig 三处。

## 3. 单位 / 坐标（混用必错 25.4 倍）
- 坐标 `mmOf()`（解析后已是 mm），光圈/宏参数 `toMM()`（文件单位→mm）。
- 标准版：1 单位 = 10 mil = 0.254mm；`X=4020+mmX/0.254`，`Y=3560.5-mmY/0.254`。
- ⚠️ `stdX/stdY` **返回字符串**，算术前 `parseFloat`。

## 4. Gerber 解析
- `extractRawData` 依赖嘉立创私有 `G04` 段标记；无标记走 `hasSectionMarkers` 分支 (层+指令推断)。
  白名单：Pad/Via/Track/PolygonModel/Rect/Circle/Image/Text/Copper/Dimension/Drill Drawing。
- 无 D 码坐标行沿用模态 `state.dCode`；位置未定义的裸 `D2*` 不写包围盒。
- 跨文件配点必须容差（0.05mm 栅格归并）；`toFixed(3)` 精确键会让过孔/钻孔大面积配不上。
- 焊盘去重必须带 `layerId`（`rawPads` 是所有层公共数组）。
- 过孔 vs 插件盘：钻孔≥0.6mm 且铜环≥0.25mm → 插件焊盘。
- 宏基元 6/7 未绘制；`%SR` 未处理；真彩图片离线无解。

## 5. 图元生成（05-pad-tool / Clipper）
- LPC 不能整体丢：负片覆铜 = 暗区 + 清区（区域/闪绘/线段都收集）。
- **负片带孔覆铜的拆分（V3.9.18 重写）**：单环图元不能带孔 → 必须开 keyhole 缝拆成无孔多边形。
  · 孔之间用 **Prim 最小生成树**搭缝，整棵树只开 **1 条**出口缝，且朝「最近边界」切
    （旧实现每孔各切一条到最右侧 beyondX → 227 孔切成 688 块，长缝还把铜劈成两半）。
  · `FILL_SLIT_HALF = 0.0001`（缝宽 0.0002mm = 0.008mil）；`FILL_PIECE_MIN_AREA = 1e-3` 丢碎屑。
  · ⚠️ **禁止用「拆完每块向外膨胀」合缝**：膨胀把缝合拢后孔洞变成多边形内部洞 → 被当铜填死
    （实测 227 孔 340mm² 全丢）。要么留极窄缝，要么换带孔图元。
  · 覆铜 FILL 的 **width 必须 0**（V3 `"width"` / V2 第 5 位）：写 0.2 会让 EDA 内缩 →
    相邻填充之间多出 0.2mil 缝（内层焊盘那处早是 0，覆铜这处 V3.9.18 才补上）。
  · **拆分完必须把弦还原成 ARC（V3.9.19）**：Clipper 只吃折线，圆弧离散是**内接**的，
    填充边界比真圆内缩 ≤`FILL_ARC_TOL`(0.01mm=0.39mil)，与保留真圆弧的走线/描边铜之间
    裂发丝缝（Gerber 里没有）。`fillArcDefs/fillArcIndex/fillArcContaining/fillRingToOpsWithArcs`
    把「两端同弧」的连续弦段合并回 ARC（并校验弦中点、端点吸附回圆）。指令数 −70%。
    ⚠️ 别靠压小 `FILL_ARC_TOL` 换精度：0.0005 时顶点涨 3.3 倍（4805→15873）。
  · `fillRingPoints` 的圆弧**必须自己补声明端点**：`fillArcPoints` 只给中间采样点；
    旧版只在退化分支补，弧接弧时漏交点 → 层 15 少算 24mm²（V3.9.19 修）。
- 负片转正片：Clipper 差集 → 残留孔洞开 keyhole 缝（现 0.0002mm）→ 只输出外边界，每块一个 FILL。
  `createComplexPolygon` 是「多块独立多边形」，不做布尔差。
- FILL 创建：单环用 `createPolygon(平铺)`；`createComplexPolygon` 入参是**多块数组**，单元素嵌套 `[[ring]]`
  会被当平铺 → undefined → 填充消失。「平铺优先 + 多重兜底」。
- 整圆：CIRCLE 导出起点=终点 360° 弧；画布 moveTo 后 0~2π，导出拆两段 180°；折线通道按对径点 `2c-起点` 拆。
- 宏光圈焊盘 w=h=0，`calcExp` 用 path 包围盒算阻焊扩展。
- **宏基元必须布尔并集**：`macroBuildRings()`（Clipper 暗并集 − 清差集）+ `macroPrimRing/macroCircleRing/
  macroTreeToRings`，入口 `macroPrimsToPath()`（无 Clipper 回退 naive），按光圈缓存 `_macroRingCache`。
  ⚠️ 同批 subject 方向相反会被当孔洞 → `fillRingArea<0` 就 reverse。
- **Copper 段描边铜**（G36 之外的 D01/弧，0.2mm 描轮廓）：`tempPolySegments → flushPoly → mergeSegments
  → rawPolys`，标 `isStroke=true`；Track 段仍是真走线。标准版 `isStroke` 的 POLY → 带线宽多点 TRACK。
- **标准版区域环「零长首段 + 未闭合」**：`fillNormalizeFlatRing` 去零长边+补闭合，`singlePath` 和每个
  `holes` 环都过一遍；`stdFlattenPath` 出口去相邻重复点。

## 6. 标准版导出（08-export `buildStandardSource`）
- 字段数：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10 / TEXT 17，**没有 POLY**。
- 区域类一律 SOLIDREGION；槽孔同时给 `holeLength` + `slotPointArr`。
- 图层 ID 与内部编号不是一套（5 锡膏/7 阻焊/10 板框/11 Multi/12 Document/15-46 Inner1-32），阻焊/锡膏/装配按**语义**映射。
- 折线全转 TRACK；相邻 TRACK 链式合并：同层+同线宽+同网络+端点 0.001mm 相接 → 多点 TRACK，
  度1/度>2 断开，纯环输出闭合点列，**ARC 不参与合并**。
- 不支持 FPC：polys/fills/images 跳过 58/59；不导出埋盲孔。
- **板层数由 `layers` 表决定**：内层行（21…52）的 visible/config 为 false 就只按 2 层板打开，
  shape 里写 21/22 也白写。`buildStdLayers(innerCount)` 按 `stdInnerLayerCount(config)`
  （UI `#cfg-copper-layers`−2 与 Gerber 内层文件 15…46 取大值）启用前 N 层，
  启用行写 `true~false~true~0~Signal`（Signal=正片，别留空，留空若是内电层会把铜变挖空）。
- **Text 段按 PolygonModel**：`extractRawData(files, {textAsPoly:true})` **只有标准版**传
  （`buildStandardSource`）；TEXT 段的 G01 线段落 `rawPolys`（`isStroke/fromText`）→ TRACK，
  否则保持 `rawTextLines`（画布 / 专业版）。标准版没有文字笔画图元，不这么做丝印文字整片丢。
- **TEXT 位号两个坑**：① path 只允许 M/L/C/Z，命令字母后**不留空格**，Q（TrueType 二次曲线）
  必须按 −2/3 控制点转 C，零长线段要删 —— 由 `fontTextToPath` 统一产出；② 坐标必须过
  `flyingLengthScaleMM()` 归一化（见 §9），否则位号飞到板外、BBox 被撑爆。

## 7. 内置字体轮廓
`iframe/js/11-font-outline.js`：`FONT_OUTLINE_DATA` + `fontTextToPath`/`fontEmForCapHeight`，ASCII 0x20-0x7E。
工具 `tools/font-outline.js`（不进包）：`NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js --font <ttf>`。
`NotoSansSC-VF.ttf` 是可变字体（默认 wght=100）→ 先 `python -m fontTools.varLib.instancer … wght=350`（cap/em=0.732）。
PCB「字高」= cap height：`em = capMil/(capHeight/upem)`。缺字跳过并记日志，绝不近似替换。

## 8. 物理网络（06-utils `buildNetAssignments`）
开关 `config.tryNetlist`（`#cfg-netlist`，默认勾选）→ `generatePrimitives` 与 `buildStandardSource` 各自调用。
铜层图元 → 空间网格候选对 → `netConnected()` → 并查集 → 分量命名 → 回填。
- 字段位置：`TRACK[3]/ARC[3]/CIRCLE[8]/SOLIDREGION[2]/PAD[7]/VIA[4]`；HOLE、板框、非铜层留空。
- 定名：① 票数多 ② 真实名>NET* ③ 短名 ④ 字典序。
- 判定：圆用内接正十二边形；矩形/长圆/异形用真实轮廓 `netPadOutline`；圆弧 ≤22.5° 离散；
  导线端点搭焊盘边界补 `netSegSegDist2`（到多边形**边**距离 ≤ 线宽/2）。
- 两个已知网络落同一连通块 → 整块改名未占用 `NET*`（`tryUnion` 无交集 / 定名阶段 `votes.size>1`），
  并**必须同时改焊盘**（`renamed` Set + `isNetRenamed`）；正常分量飞针名优先。
- 性能改造（别改回去）：2mm 边索引+y 分带、≥800 顶点用 Clipper `ctIntersection`（缓存挂**图元对象**，
  不能用 id 做键）、配对去重按「包围盒交集最小角所在格」、`a.src===b.src` 直连、DP 简化 0.05mm、网格 1mm。
- 已知坑：`Gerber_PCB1_2025-06-10.zip` 内层平面是一整块正向区域（0 LPC / 15289 顶点）→ 82 网络并成 NET1，待重做判定。

## 9. 飞针标注 / 位号 / 补强标注
- 虚拟层（按面拆分，并入「自定义/特殊」组、默认全勾选）：2001 顶位号 / 2002 顶焊盘名 / 2003 底位号 /
  2004 底焊盘名 / **2005 补强名称**。面来自飞针 JSON 的 `LAYER`(T/B)，`buildFlyingPinIndex` 的 pin/comp 带 `side`。
  `flyingPinAt(index,x,y,box,side)` 按面过滤，内部 `ensurePinGrid`（40mil 栅格）+ `forEachPinInRect`；
  715 通孔坐标 T/B 各一条 → 绘制按「文字+屏幕坐标」去重。
  ⚠️ 匹配必须**先按焊盘铜层限定面**（`pad.top`→T、`pad.bottom`→B；内层盘才退回飞针面），否则框内误配。
  组联动 `FLYING_GROUP_LINK`（TOP→2001/2002、BOTTOM→2003/2004）在 `toggleGroup()`。
- 匹配顺序：① 中心 2.5mil 内 ② 落在焊盘包围盒内离中心最近的引脚。
- **坐标单位**：飞针文件 `lengthUnit` 实测是 **mil**（也有 mm/inch）。任何读原始坐标的地方都不能当 mm 用
  （差 39.37 倍）→ 统一走 `06-utils.js flyingLengthScaleMM(fp)`（文件单位→mm 倍率）；
  标准版 mm 直接用，专业版 mil = `raw*scale/0.0254`。
- **「尝试生成网络」只控网络名**：`flyIndex` 必须无条件构建（`useFlyingNet = config.tryNetlist`），
  否则一关开关焊盘编号退化 "1"、groupId 全丢、位号一条不导（V3.9.18 修）。
- 字高(mil)：导出 `FLYING_REFDES_HEIGHT_MIL=30`（cap height）；画布 `_CANVAS_MIL=16`、上限
  `_CANVAS_MAX_MIL=20`（`min(max(6,16*s),20*s)`，低于 4px 不画）；补强 24；引脚 12。
- 位号图层：专业版装配层（顶 9/底 10+mirror）、标准版文档层 12；按面过滤 `isRefdesLayerOn(side)`。
  引脚编号/网络名仅显示不导出。占位名（PAD/PAD1…）跳过 `isFlyingPadPlaceholder`。
- `ensureFlyingLabels()` 缓存在 `flyingLabelCache`，内部跑一次 `extractRawData + consolidate` —— 首帧成本之一。

## 10. FPC 补强
- 文件名 `Gerber_<Top|Bottom>StiffenerLayer_<材料码>_<厚度>.GTSL/.GBSL`，顶 58 / 底 59。
- 材料码：顶 `pit/fr4t/gpt/csa`，底 `pib/fr4b/gpb/ssa`；`pst_/psb_<型号>` 取大写型号，默认 0.1mm。
  未知码 → 材料不写、几何保留，**绝不猜材料名**。
- `FPC_FILL`：V2 `["FPC_FILL",id,0,layer,material,thickness,path,0]`；V3/V4 为 JSON 行。
  `path` 为路径对象数组（mil；thickness 为 mm）：矩形快捷 `[["R",x,y,w,h,0,0]]`（x/y=左上）。
- **补强只能「源码导入」**：`pcb_PrimitiveFill.create(58/59,…)` 实测无效；图元模式遇 FPC_FILL 跳过+吐司。
- 画布标注：材料上、厚度下（`0.2mm`），行距 `half=min(boxH/4, 0.72×字号)`，色 `#193366`。
  ⚠️ `renderFlyingLayerRows` 的 `hasFlying`/`hasStiff` 必须独立判断。

## 11. 专业版 V4
- `getEnvInfo()`：版本首字符 2→pro_v2 / 3→pro_v3 / 4→pro_v4。
- V4 图元行与 V3 **逐字节同构**，只有文档头不同（多 META/LAYER_PHYS/D3_ATTRIBUTE/RULE:CREEPAGE）。
  模板取自官方 4.1.78 空白 `.epru`，脚本 `Temp/scripts/tools/rebuild_v4_template.js`。
- 坑：① 模板字面量里 JSON 的 `\"` 写 `\\"`；② 末行不能以 `|` 结尾；③ 以官方导出为准别补猜字段。
- `isV3`（严格 V3）/ `isLineFormat = isV3 || isV4`；V4 的 ticket/id 起始值更大，对比先归一化。

## 12. 渲染 / 交互 / 门控
- **高 DPI**：给 `canvas.width` 赋值会重置变换 → `drawCanvas` 进入时无条件 `setTransform(dpr,0,0,dpr,0,0)`；
  `watchDprChanges()` 用 `matchMedia('(resolution: Ndppx)')` 监听并**重新挂载**。
- drawCanvas：主画布 ctx(dpr) → 每层 `bufferCanvas`（支持 LPC destination-out 与整层 alpha）→ 合成 →
  飞针标注 → 标尺 → `captureSnapshot()`。逐命令 `rectVisible` + `cullPadAp`；线按 lineWidth/极性批处理。
- 交互：缩放/平移走快照快放（`snapCanvas`+`paintFromSnapshot`+停手 150ms 补全）；导出/PDF(`forceNoDpr`)不走快照。
- PCB 画布门控 `detectPcbCanvasContext()`：`getDocumentSource()` 读不到=不在画布；`.is-off-canvas` 只灰显。
- 用户协议 `#cfg-agree`：按钮 `.agree-gated` 未勾选只灰显（不加 disabled），`confirmAction` 校验+抖动。
- `showToast(msg,type)`：`sys_Message.showToastMessage` → `.app-toast` → alert。
- 「板子属性」软件名/导出时间：`detectEasyEdaSource()` 解析 `G04|; EasyEDA[ Pro][ Client] v<ver>, <时间>`；
  读不到回退 zip entry mtime（UTC）。
- 「关于」= `iframe/About.html` + `js/about.js`；`registerFn` 必须与 `src/index.ts` 导出函数同名。

## 13. 性能（实测别丢）
21MB/18 层/30.5 万指令，Chrome 无头 1400×900：V3.3.0 1849ms → V3.6.0 7689 → V3.9.10 8936 → **V3.9.11 2325ms**。
拐点在「飞针标注层」多跑一遍 extractRawData+consolidate，把 `mergeSegments` O(n²) 跑满。
- `mergeSegments` 已改「端点 0.05mm 栅格索引 + 两向生长」O(n)，`preferWhich` 对齐旧成链。**禁止改回全表扫**。
- `autoFitView` 分位数 stride 抽样 ≤6 万点；焊盘/钻孔去重索引 `polyPadIdx`(0.01mm/0.005)、`drillGrid2`(0.02mm)。
- drawCanvas 按图层内容包围盒只清/只拷那块；整层视口外直接 `return`（必须在 `bufCtx.save()` **之前**，
  否则跳过 restore 污染 save 栈）。宏轮廓按 `cmd.ap` 缓存（**不能按宏名**）。resize 120ms 防抖。
- 验证脚本 `Temp/perf/`：`bench.cjs`（VIEW/DSF）、`stage.cjs`、`cmp.cjs`、`redraw.cjs`、`stdcmp.cjs`。
- 残留差异：折线成链分组在分叉点略不同（polys/texts ±0.4%，标准版 TRACK +0.13%），几何与像素一致。

## 14. 已知缺口
宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；`LCEDA_STD_Head_Source` 空串；
`importPrimitivesAPI(primitives,isV3)` 的 `isV3` 从未使用（api 模式强制 pro_v2）；PCB/FPC 手动开关只改 UI；
标准版不导出埋盲孔；真彩图片离线无解。协议「技术局限」已与实现对齐，以后只动技术表述，责任条款一字不动。

## 15. 本地调试（tools/serve.py）
`python tools/serve.py` → `http://127.0.0.1:8456/iframe/ImportGerber.html`。必须以项目根为站点根
（引用全是 `/iframe/...`），并在 `</head>` 前注入 `eda` mock。支持 `?ver=4.1.78`、`?nomock=1`、`?reload=0`，
改 iframe 文件自动刷新（SSE）。⚠️ 本机 `http_proxy=127.0.0.1:2868`，探本机端口加 `--noproxy '*'`。
校验：`Temp/scripts/checks/devserve_check.js`。

## 16. 界面 / 日志规范
- **日志**：`appLog` 只写 `#debug-source-area`；一个阶段一行 `${label}，耗时 ${formatDuration(ms)}`。
  禁止 ▶ ✓ ⚠ ❌ ❗ 与 `-----`；不写实现细节，只写状态/数量/耗时。当前步骤只在 `#loading-overlay` 显示。
- **弹窗**：只有「关闭」与右上 ✕ 能关。按钮顺序：蜜雪 → 联系开发者 → 反馈问题 → 关闭。
  「反馈问题」是普通 `<a target="_blank">`，别回退成 JS 打开。
- **勾选行整行可点**：仅复选框行用 `<label for>`；行内含链接必须 `onAgreeRowClick(e)` 并对 `input`/`.agree-link`
  提前 return（label 激活会把"点链接"变成切换勾选）。
- 校验脚本：`Temp/scripts/checks/ui_polish_check.js`、`ui_log_check.js`。

## 17. 文档联动
- **每次改动两份更新日志都要写**（长期规则）：
  · `CHANGELOG.md`（根，**面向用户**）：**每行 40~60 字**（写完必须数字数），只写「新增/修复/优化」
    了什么，不写解决方式与实现细节，**不出现任何文件名**；一个版本可写多行；
  · `docs/开发日志.md`（**详细开发日志**）：保留完整历史 + 根因、方案、实测数据、回归结论，
    旧版本条目绝不删改；根 CHANGELOG 里 **V1.0.0~V3.3.2 的条目已冻结、保持原样**（不再整理）。
  新版本流程：先把细节写进 `docs/开发日志.md`，再在根 `CHANGELOG.md` 写摘要。
- 功能改动同步：`README.md` → `iframe/ImportGerber.html`（导出页提示+协议）→ `iframe/About.html`；
  `docs/README.md` 的索引表补链接。版本号改 `extension.json` + `package.json` → `npm run build`（HTML 也进包）。
