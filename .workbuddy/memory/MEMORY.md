# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

> 2026-10-17 二次精简（原文件超限被截断）。细节历史见 CHANGELOG.md 与 `.workbuddy/memory/YYYY-MM-DD.md`。

## 1. 结构与铁律
嘉立创EDA**专业版**扩展；真正产品是 `iframe/` 下的单页应用，`src/index.ts` 只是壳
（`sys_IFrame.openIFrame('/iframe/ImportGerber.html')`）。改功能只改 `iframe/`。
- `iframe/js/` 数字前缀 = 加载顺序（不可调，**经典 script，禁止 type=module**）：
  01-templates 02-config 03-state 04-gerber-parser 05-pad-tool 06-utils 07-file-io
  08-export 09-ui 10-init 11-font-outline + clipper.js(6.4.2) + jszip/jspdf。
  `processors/`：registry + industry-common + industry-rs274x + jlc-internal。
- 脚本放 `</body>` 前；引用用绝对路径 `/iframe/...`；`.js`/`.css` 带 **UTF-8 BOM**；
  不要反缩进（模板字面量对空白敏感）；新功能别内联回 HTML。
- 版本以 `extension.json` 为准（`package.json` 同步）→ `npm run build` → `build/dist/*.eext`。当前 **V3.9.11**。
- 临时文件一律放 `Temp/`（gitignore + edaignore），分类见 `Temp/README.md`；分析文档放项目根 `docs/`（不进包）。
- 顶层 `const` 在经典 script 里是**全局词法作用域**（不是 window 属性）：别处裸名可访问，
  但 `window.xxx` 读不到，测试里也不能靠 `window.rawFilesCache=` 赋值（会静默测错版本）。

## 2. 处理模式（仅两项）
下拉 `#cfg-source-type`：`easyedapro` / `rs274x`。新增处理器要同步改三处（HTML option、script、resetConfig）。

## 3. 单位 / 坐标（混用必错 25.4 倍）
- 坐标用 `mmOf()`（解析后已是 mm），光圈/宏参数用 `toMM()`（文件单位 → mm）。
- 标准版导出：1 单位 = 10 mil = 0.254mm；`X=4020+mmX/0.254`，`Y=3560.5-mmY/0.254`。
- ⚠️ `stdX`/`stdY` **返回字符串**，算术前必须 `parseFloat`。

## 4. Gerber 解析铁律
- `extractRawData` 依赖嘉立创私有 `G04` 段标记；无标记走 `hasSectionMarkers` 分支按层+指令推断
  （段标记白名单含 Pad/Via/Track/PolygonModel/Rect/Circle/Image/Text/Copper/Dimension/Drill Drawing）。
- 无 D 码坐标行沿用模态 `state.dCode`；位置未定义的裸 `D2*` 不写包围盒。
- 跨文件配点必须容差（0.05mm 栅格归并），`toFixed(3)` 精确键会让过孔/钻孔大面积配不上。
- 焊盘去重必须带 `layerId`（`rawPads` 是所有层公共数组）。
- 过孔 vs 插件盘：钻孔≥0.6mm 且铜环≥0.25mm → 插件焊盘（THT_DRILL_MIN / THT_RING_MIN）。
- 宏基元 6/7 未绘制；`%SR` 未处理；真彩图片离线无解（`docs/FCTS_解析报告.md`）。

## 5. 图元生成（05-pad-tool / Clipper）
- LPC（清除）不能整体丢：负片覆铜 = 暗区 + 清区（区域/闪绘/线段都要收集）。
- 负片转正片：Clipper 差集 → 残留孔洞开 0.01mm keyhole 缝 → 只输出外边界，每块一个 FILL。
  `createComplexPolygon` 是「多块独立多边形」，不做布尔差。
- FILL 创建：单环用 `createPolygon(平铺)`；`createComplexPolygon` 入参是**多块数组**，
  单元素嵌套 `[[ring]]` 会被当平铺解析 → 返回 undefined → 填充消失。用「平铺优先 + 多重兜底」。
- 整圆：CIRCLE 导出成起点=终点 360° 弧；画布 moveTo 后画 0~2π，导出拆两段 180° 半圆；
  折线通道的整圆按对径点（`2c-起点`）拆。
- 宏光圈焊盘 w=h=0，`calcExp` 用 path 包围盒算阻焊扩展。
- **宏基元必须布尔并集**：`macroBuildRings()`（Clipper 暗并集 − 清差集）+ `macroPrimRing/macroCircleRing/
  macroTreeToRings`，入口 `macroPrimsToPath()`（无 Clipper 回退 `macroPrimsToPathNaive`），按光圈缓存
  `_macroRingCache`。⚠️ 同批 subject 里方向相反会被当孔洞 → 先 `fillRingArea<0` 就 reverse。
- **Copper 段描边铜**（Copper Start/End 里 G36 之外的 D01/弧，0.2mm 描轮廓）：走
  `tempPolySegments → flushPoly → mergeSegments → rawPolys`，标记 `isStroke=true`；Track 段仍是真走线。
  标准版导出 `isStroke` 的铜层 POLY → 带线宽多点 TRACK（落 SOLIDREGION 会变零宽）；网络里走 `pushStrokePoly`。
- **标准版区域环「零长首段 + 未闭合」**：`fillNormalizeFlatRing(flat, tol)` 去零长边 + 补闭合，
  生成 FILL 时对 `singlePath` 和每个 `holes` 环都过一遍；`stdFlattenPath` 出口去相邻重复点。
  判据：无退化边 + 显式闭合。

## 6. 标准版导出（08-export `buildStandardSource`）
- 字段数：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10 / TEXT 17，**没有 POLY**。
- 区域类一律 SOLIDREGION；槽孔必须同时给 `holeLength` + `slotPointArr`。
- 图层 ID 与内部编号不是一套（5 锡膏 / 7 阻焊 / 10 板框 / 11 Multi / 12 Document / 15-46 Inner1-32），
  阻焊/锡膏/装配按**语义**映射。
- 折线全转 TRACK（V3.9.6）；相邻 TRACK 链式合并（V3.9.7）：同层+同线宽+同网络+端点 0.001mm 相接
  → 多点 TRACK，度1/度>2 处断开，纯环输出闭合点列，**ARC 不参与合并**。
- 不支持 FPC：polys/fills/images 跳过 58/59；不导出埋盲孔。

## 7. 内置字体轮廓（V3.9.6）
`iframe/js/11-font-outline.js`：`FONT_OUTLINE_DATA` + `fontTextToPath` / `fontEmForCapHeight`，ASCII 0x20-0x7E。
工具 `tools/font-outline.js`（不进包）：`npm i opentype.js --prefix Temp/fonttest --no-save` →
`NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js --font <ttf>`。
`C:/Windows/Fonts/NotoSansSC-VF.ttf` 是可变字体（默认 wght=100）→ 先
`python -m fontTools.varLib.instancer <VF> wght=350 -o ...`（cap/em = 0.732）。
PCB「字高」= cap height：`em = capMil / (capHeight/upem)`。缺字跳过并记日志，绝不近似替换。

## 8. 物理网络（06-utils `buildNetAssignments`）
开关 `config.tryNetlist`（`#cfg-netlist`，默认勾选）→ `generatePrimitives` 与 `buildStandardSource` 各自调用。
铜层图元 → 空间网格求候选对 → `netConnected()` → 并查集 → 分量命名 → 回填。
- 网络字段位置：`TRACK[3] / ARC[3] / CIRCLE[8] / SOLIDREGION[2] / PAD[7] / VIA[4]`；HOLE、板框、非铜层留空。
- 定名：① 票数多 ② 真实名 > `NET*` ③ 短名 ④ 字典序。
- 几何判定：圆用内接正十二边形；矩形/长圆/异形用真实轮廓 `netPadOutline`；圆弧 ≤22.5° 离散；
  导线端点搭在焊盘边界补 `netSegSegDist2`（线段到多边形**边**距离 ≤ 线宽/2）。
- 两个已知网络落到同一连通块 → 整块改名未占用 `NET*`（`tryUnion` 无交集 / 定名阶段 `votes.size>1`），
  并**必须同时改焊盘**（V3.9.9 的 `renamed` Set + `isNetRenamed`），正常分量仍飞针名优先。
- V3.9.10 性能改造（别改回去）：2mm 边索引 + y 分带、≥800 顶点用 Clipper `ctIntersection`
  （缓存挂在图元对象上，**不能用 id 做键**）、配对去重按「包围盒交集最小角所在格」、`a.src===b.src` 直连、
  连通图 DP 简化 0.05mm、网格 1mm。1.6MB 板 78.4s→3.3s。
- 健康度：`Temp/scripts/checks/net_health.js`（`mixedClusters` + 同名多岛）。6 样本全 0/0/0。
- 已知坑：`Gerber_PCB1_2025-06-10.zip` 内层平面是一整块正向区域（0 个 LPC、15289 顶点）→ 82 网络并成 NET1，
  与 V3.9.10 改动无关，待按「轮廓凹口」重做判定。

## 9. 飞针标注 / 位号 / 补强标注
- 虚拟层 2001 引脚编号 / 2002 网络名 / 2003 位号 / 2004 补强名；并入「自定义/特殊」组、默认全勾选；
  位号色 `#00ffff`，其余 `#ffffff`。
- 匹配统一在 06-utils（`buildFlyingPinIndex` / `padMatchBoxMM` / `flyingPinAt`）：① 中心 2.5mil 内
  ② 否则取落在焊盘包围盒内离中心最近的引脚。⚠️ `flyingPinAt` 内部是 `index.pins.find()` **线性扫**，
  焊盘×引脚数会 O(n²)，大板（数万盘）是潜在热点。
- 字高（mil）：导出 `FLYING_REFDES_HEIGHT_MIL=30`（cap height）；画布 `_CANVAS_MIL=16`；
  补强 `FLYING_STIFFENER_MAX_FONT=24`；引脚 `FLYING_LABEL_MAX_FONT=12`。
- 位号图层按通道区分：专业版装配层（顶 9 / 底 10 + mirror）、标准版文档层 12。
  引脚编号/网络名仅显示不导出。占位名（PAD / PAD1 / PAD23）跳过（`isFlyingPadPlaceholder`）。
- `ensureFlyingLabels()` 结果缓存在 `flyingLabelCache`（导入/重载时置空），内部会做一次
  `extractRawData + consolidate` —— **首帧的主要成本来源之一**（见 §13）。

## 10. FPC 补强（Stiffener）
- 文件名 `Gerber_<Top|Bottom>StiffenerLayer_<材料码>_<厚度>.GTSL/.GBSL`，顶 58 / 底 59。
- 材料码：顶 `pit/fr4t/gpt/csa`，底 `pib/fr4b/gpb/ssa`；`pst_/psb_<型号>` 取型号大写，默认 0.1mm。
  未知码 → 材料不写、几何保留，**绝不猜材料名**。
- `FPC_FILL`：V2 `["FPC_FILL", id, 0, layer, material, thickness, path, 0]`；V3/V4 为 JSON 行。
  `path` 是路径对象数组（mil；thickness 为 mm）：矩形快捷 `[["R",x,y,w,h,0,0]]`（x/y = 左上）。
- **补强只能「源码导入」**：`pcb_PrimitiveFill.create(58/59,…)` 实测无效；图元模式遇到 FPC_FILL 跳过 + 吐司，
  且不再调 `setPcbType`。`autoDetectSettings` 的 `hasStiffener` 自动切 FPC；`configureHeader` 打开 58/59 的 use/show。
- 画布标注：材料在上、厚度在下（`0.2mm`），行距 `half = min(boxH/4, 0.72×字号)`，色 `#193366`。
  ⚠️ `renderFlyingLayerRows` 的 `hasFlying` / `hasStiff` 必须独立判断（否则 FPC 板不显示补强行）。

## 11. 专业版 V4
- `getEnvInfo()`：`getEditorCurrentVersion()` 首字符 2→pro_v2 / 3→pro_v3 / 4→pro_v4。
- V4 图元行与 V3 **逐字节同构**，只有文档头不同（多 META / LAYER_PHYS / D3_ATTRIBUTE / RULE:CREEPAGE 等）。
  模板取自官方 4.1.78 空白 `.epru`，生成脚本 `Temp/scripts/tools/rebuild_v4_template.js`。
- 三个坑：① 模板字面量里 JSON 的 `\"` 要写 `\\"`；② 末行不能以 `|` 结尾；③ 以官方导出为准，别补猜字段。
- `isV3`（严格 V3，仅 .epru）/ `isLineFormat = isV3 || isV4`；V4 的 ticket/id 起始值比 V3 大，对比要先归一化。

## 12. 渲染 / 交互 / 门控
- **高 DPI**：给 `canvas.width` 赋值会把变换重置成单位矩阵 → `drawCanvas` 进入时无条件
  `setTransform(dpr,0,0,dpr,0,0)`，结尾 `restore()`；`watchDprChanges()` 用
  `matchMedia('(resolution: Ndppx)')` 监听并**重新挂载**。验证口径 dpr=2 物理尺寸 = dpr=1 的 2 倍。
- drawCanvas 结构：主画布 ctx(dpr) → 每层用 `bufferCanvas` 画（支持 LPC 的 destination-out 与整层 alpha）
  → 合成到主画布 → 飞针标注 → 标尺 → `captureSnapshot()`。
  逐命令裁剪 `rectVisible` + `cullPadAp`（本层最大光圈）；线按 lineWidth/极性批处理，只在变化时 stroke。
- 交互：缩放/平移走快照快放（`snapCanvas` + `paintFromSnapshot` + `notifyViewInteraction` 停手 150ms 补全）；
  导出/PDF（`forceNoDpr=true`）不走快照。
- PCB 画布门控 `detectPcbCanvasContext()`：`getDocumentSource()` 读不到 = 不在画布；
  `documentType===3` 交叉确认。`.is-off-canvas` 只灰显、保留 pointer-events。
- 用户协议 `#cfg-agree`：五个按钮 `agree-gated`，未勾选只灰显不加 disabled，`confirmAction` 校验 + 抖动。
- `showToast(msg,type)`：`sys_Message.showToastMessage` → `.app-toast` → alert。
- 「板子属性」软件名/导出时间：`detectEasyEdaSource()` 解析头部
  `G04|; EasyEDA[ Pro][ Client] v<ver>, YYYY-MM-DD HH:MM:SS`；时间读不到回退 zip entry 的 mtime（按 UTC）。
- 「关于」= `iframe/About.html` + `js/about.js`；`registerFn` 必须与 `src/index.ts` 导出函数同名。

## 13. 性能（V3.9.11，实测数据别丢）
同一份 21MB/18 层/30.5 万指令的板，Chrome 无头：
V3.3.0 1849ms → 3.4.0 2725 → **3.6.0 7689** → 3.9.10 8936 → V3.9.11 **2325ms**（1400×900）。
拐点在 V3.6.0「飞针标注层」：首帧为了画标注多跑一遍 `extractRawData + consolidate`，
把 `mergeSegments` 的 O(n²) 跑满（3.2s）。
- `mergeSegments` 已改「端点 0.05mm 栅格索引 + 两向生长」O(n)，衔接优先级参数 `preferWhich`
  （前向优先 which=0、反向 which=1）以对齐旧成链结果。**禁止改回 pool+splice 全表扫**。
- `autoFitView` 分位数改 **stride 抽样 ≤6 万点**（原全量 sort 0.95s）。
- 焊盘/钻孔去重索引：`polyPadIdx`（0.01mm 格，容差 0.005）、`drillGrid2`（0.02mm 格）。
- drawCanvas：按图层**内容包围盒**只清/只拷那一块矩形，整层在视口外直接 `return`；
  宏轮廓/光圈参数按 `cmd.ap` 缓存（**不能按宏名缓存**，同名宏可被不同参数实例化）。
  ⚠️ 该 `return` 必须在 `bufCtx.save()` **之前**，否则跳过 restore 污染 save 栈 → 图层变换叠加错位。
- resize 事件 120ms 防抖（EDA 撑面板会连发几十次 resize，大板每帧 1s+）。
- 验证脚本在 `Temp/perf/`：`bench.cjs`（墙钟+CPU profile，环境变量 VIEW=WxH / DSF=n）、`stage.cjs`
  （包装全局函数记次数/自耗时）、`cmp.cjs`（几何+像素指纹 A/B）、`redraw.cjs`（全量/关标注/resize/放大
  重绘 + 三态指纹）、`stdcmp.cjs`（buildStandardSource A/B）。基准目录 `Temp/perf/before3910`。
- 已知残留差异：折线**成链分组**在分叉点略不同（polys/texts ±0.4%，标准版 TRACK +0.13%），几何与像素一致。
- 慢的下一步方向：限制 backing store 像素上限、把飞针标注延后到首帧之后、`flyingPinAt` 加空间索引。

## 14. 已知缺口
宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；`LCEDA_STD_Head_Source` 空串；
`importPrimitivesAPI(primitives, isV3)` 的 `isV3` 从未使用（api 模式强制 pro_v2）；
PCB/FPC 手动开关只改 UI；标准版不导出埋盲孔；真彩图片离线无解。
协议页「技术局限」在 V3.9.9 已与实现对齐（网络为几何推算、冲突改名、标准版不含埋盲孔、位号落层），
以后只动**技术表述**，责任/侵权/备份条款一字不动。

## 15. 文档联动
功能改动同步四处：`CHANGELOG.md` → `README.md`（能力矩阵 + 4.4 特殊功能）→
`iframe/ImportGerber.html`（导出页提示 + 协议技术局限）→ `iframe/About.html`。
版本号改 `extension.json` + `package.json` → `npm run build`（HTML 也进包，改文档必须重打包）。
