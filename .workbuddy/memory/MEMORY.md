# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

## 项目本质
嘉立创EDA专业版扩展。真正产品是 `iframe/` 下的单页应用；`src/index.ts` 只是壳
（`eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', …)`）。改功能只改 `iframe/`，
`npm run build` 只负责打包（`.edaignore` 排除 src/ build/ config/ .workbuddy/ Temp/）。

## iframe 结构（数字前缀=加载顺序，不可调；用经典 <script>，禁止 type=module）
`ImportGerber.html` 骨架 / `css/style.css` / `js/`：
01-templates(模板) 02-config(DEBUG/图层定义) 03-state(状态+画布+协议弹窗) 04-gerber-parser(GerberParser)
05-pad-tool(PadTool 逆向还原) 06-utils(工具) 07-file-io(导入调度) 08-export(导出)
09-ui(渲染交互) 10-init(初始化) + clipper.js(6.4.2 布尔运算) + jszip/jspdf
`processors/`：registry + industry-common + industry-rs274x + jlc-internal。

铁律：脚本放 `</body>` 前；引用用绝对路径 `/iframe/...`；`.js`/`.css` 带 UTF-8 BOM；
不要反缩进（模板字面量对空白敏感）；新功能别内联回 HTML。

## 版本与打包
版本以 `extension.json` 为准（`package.json` 同步），打包 `npm run build` → `build/dist/*.eext`。
临时文件一律放 `Temp/`（gitignore + edaignore）。

## 处理模式（仅两项）
下拉 `#cfg-source-type`：`easyedapro`（嘉立创内部）/ `rs274x`（通用）。
X2 / X3 / RS-274D / 兼容 / 保底 已删。新增处理器要同步改三处（HTML option+script、resetConfig）。

## 业务铁律（踩过的坑）
- 坐标 vs 光圈参数单位不同：坐标用 `mmOf()`，光圈/宏参数用 `toMM()`；混用英寸文件偏 25.4 倍。
- `extractRawData` 依赖嘉立创私有 `G04` 段标记；无标记来源靠 `hasSectionMarkers` 分支按层+指令推断。
- 无 D 码坐标行沿用模态操作码 `state.dCode`；位置未定义的裸 `D2*` 不写包围盒。
- 跨文件配点必须容差（0.05mm 栅格归并）；`toFixed(3)` 精确键会让过孔/钻孔大面积配不上。
- 焊盘去重必须带 `layerId` 限定（`rawPads` 是所有层公共数组）。
- 过孔 vs 插件盘：钻孔≥0.6mm 且铜环≥0.25mm → 插件焊盘（THT_DRILL_MIN/THT_RING_MIN）。
- LPC（清除极性）不能整体丢：负片覆铜 = 暗区 + 清区（区域/闪绘/线段都要收集）。
- 负片转正片：Clipper 差集 → 对残留孔洞开 0.01mm keyhole 缝 → 只输出外边界，每块一个 FILL。
  （`createComplexPolygon` 是「多块独立多边形」，不做布尔差。）
- FILL 创建 API：单环用平铺 `createPolygon(平铺)`；`createComplexPolygon` 入参是「多块数组」，
  单元素嵌套 `[[ring]]` 会被当平铺解析 → 返回 undefined → 填充静默消失。用「平铺优先+多重兜底」。
- 整圆：CIRCLE 导出成起点=终点 360° 弧；画布先 moveTo 再画 0~2π，导出拆两段 180° 半圆。
- 宏光圈焊盘 w=h=0，`calcExp` 用 path 包围盒算阻焊扩展。

## 嘉立创标准版导出格式（08-export.js）
1 单位 = 10 mil = 0.254 mm；`X=4020+mmX/0.254`，`Y=3560.5-mmY/0.254`。
字段：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10。
区域类一律 SOLIDREGION（不要 COPPERAREA）。槽孔必须同时给 `holeLength` + `slotPointArr`。
图层 ID 与内部编号顺序不同（阻焊/锡膏/装配需换算）。
标准版**不导出**文字、元件位号、埋盲孔；矢量图片轮廓以 SOLIDREGION 导出，钻孔层默认不勾选。

## 飞针标注层
虚拟层 id 2001 引脚编号 / 2002 网络名称 / 2003 元件位号（有 `FlyingProbeTesting.json` 才出现）。
匹配统一在 06-utils（`buildFlyingPinIndex`/`padMatchBoxMM`/`flyingPinAt`），画布与导出共用。
单位 mil。引脚编号/网络名称仅显示不导出；位号勾选后写装配层文字（24mil）。

## 已知缺口
网络生成未实现（`netName=""`；「尝试生成网络」只驱动飞针编号/位号）；
标准版不导出文字/位号/埋盲孔；宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；
`setBoardType()` 空壳；`exportForOther_Pro()` 不可达；`LCEDA_STD_Head_Source` 未使用。

## 标准版 Gerber 的区域环「零长首段 + 未闭合」（2026-10-16 修复）
嘉立创EDA**标准版**（EasyEDA v6.x）导出的 Gerber，其 G36/G37 区域路径常写成
「M 起点 → L 起点」的**零长首段**，且**不闭合**（实测 stm32 板 1153 块填充里
879 块带零长首段、仅 24% 闭合；`Gerber_上.pcbdoc` 11/11 全中）。
专业版（EasyEDA Pro）导出的区域本就干净闭合 → 所以只有标准版来源会「渲染对、导入错」。
**症状：画布渲染正常，但导入 EDA 后填充区域全丢。**

- 修复①（导入通道 / PRO 图元）：`06-utils.js` 新增 `fillNormalizeFlatRing(flat, tol)`——
  去零长线段 + 末点未回首点时补一段闭合；在 `05-pad-tool.js` 的 FILL 生成处调用
  （`singlePath` 与每个 `holes` 环都要过）。已是干净闭合的环**原样返回**（空操作）。
- 修复②（标准版导出通道）：`08-export.js` 的 `stdFlattenPath()` 出口去掉相邻重复点
  （闭合交给 `stdPathStr(pts, true)` 的 `Z`）。
- 判据：填充环必须**无退化边（相邻点重合）+ 显式闭合**，否则 EDA 端多边形校验会拒绝整块图元。
- 验证：严格 mock（复刻上述两条校验）下 stm32 的 FILL 由 **280 → 1159（全部）**；
  7 个样本**丢弃 0 块**；专业版样本图元串**逐条完全一致**；标准版参考样本 ground truth
  仍 9 图元逐字段一致。校验脚本：`Temp/fill_ring_check.js`、`Temp/fill_drop_check.js`、
  `Temp/std_export_dump.js`。

## 物理网络生成（2026-10-16 新增；2026-10-17 修正确性）
复选框 `#cfg-netlist`（标签 `#generatenet`，位于「处理模式」下方，默认勾选）→ `config.tryNetlist`
→ `05-pad-tool.js generatePrimitives` 里调用 `buildNetAssignments()`。

- 算法（`06-utils.js`，移植自 `Temp/生成网络/GenerateNet.html`）：取铜层图元（焊盘 / 过孔 /
  导线 / 圆弧 / 折线 / 填充）→ 空间网格（5mm，+1mm 余量）求候选对 → `netConnected()` 几何
  连通判定 → 并查集 → 分量命名 → 回填到每个图元。
- 已接入全部通道：通过源码导入 / 通过图元导入 / 导出专业版 V2、V3 / **导出标准版**。
  标准版的网络字段位置（`08-export.js buildStandardSource`，对照官方导出实测）：
  `TRACK[3]` / `ARC[3]` / `CIRCLE[8]` / `SOLIDREGION[2]` / `PAD[7]` / `VIA[4]`；
  `HOLE` 无网络字段；板框 TRACK 与非铜层图元留空。字段总数不变
  （PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10）。
  未勾选「生成网络」时全部写空串，输出与改动前逐字段一致。

### 2026-10-17 修复「GND 覆铜被命名成 DP」（参考实现同样存在）
根因是**两条叠加缺陷**：
1. **命名按「名字长短」定名**：分量里混进 1 个异物时短名胜出（GND 覆铜误连 1 个 DP 焊盘
   → 整块报成 DP）。参考实现即 `sort((a,b)=>a.length-b.length||localeCompare)`。
   → 改为 **① 票数多者优先 ② 真实名 > 通用 `NET*` ③ 短名 ④ 字典序**。
2. **几何判定粗糙/自相矛盾**（真正的误连来源）：
   - `netShapeEdges` 对圆用**包围盒四边**，方角比真实半径远 √2 倍 → 误判焊盘与覆铜相接
     → 改为**内接正十二边形**。
   - 焊盘一律按「最短边内切圆」→ 矩形焊盘算小 → 导线连不上焊盘（同网络拆成孤岛 → 飞线）
     → 矩形 / 长圆 / 异形改用**真实轮廓**（`netPadOutline`）。
   - **圆弧只取弦**（弦与真实弧差一个矢高，90° 弧 ≈ 0.29r）→ 相邻判不相接 / 隔开判相接。
     实测这是「GND 走线与 GPIO7 走线中心线只差 0.0877mm」这类假接触的**主因**
     → 在 `netBuildPrims` 里按 ≤22.5° 离散（只影响连通图，不改生成图元）。
   - 导线端点「正好停在焊盘边界」判不出来 → 补「多边形顶点到线段距离 ≤ w/2」。
3. 安全网：**两个分量若各自带有不同的已知网络（飞针 NET_NAME）就禁止合并**
   （`stats.rejectedMerges`）。几何修好后已不再触发（6 样本实测 0 次）。

**健康度指标**（`Temp/net_health.js`）：`mixedClusters`（一个分量混入多网络 = 错乱）
与「同名多岛网络」（同一网络名落在多个互不相连分量 = 飞线）。
修复后 6 个样本全部 **mixedClusters=0 / 多岛=0 / rejectedMerges=0**，且「网络名数 = 分量数」1:1。
PCB1_2026-10-15 实测：GND 2645 图元、DP 35 图元，覆铜 22 块归 GND，132 个网络名全部来自飞针文件。

## PCB 画布门控与「关于」页面（2026-10-17）
「通过源码导入 / 通过图元导入」写的是**当前打开的 PCB 文档**，所以打开工具时先检测：
`06-utils.js detectPcbCanvasContext()` —— ① `sys_FileManager.getDocumentSource()` 读不到
→ 不在画布；② 读得到但非 PCB 源码（原理图/符号也能读到）→ 不在；③ 源码为空时用
`dmt_SelectControl.getCurrentDocumentInfo().documentType === 3` 交叉确认
（**空白 PCB 文档源码可能为空，不能误判**）。`isPcbDocumentSource()` 认
V2 `["DOCTYPE","PCB",…]` / V3 `{"docType":"PCB",…}`。
- UI：按钮加 `pcb-gated` 类 + onclick 用 `confirmPcbAction()`（顺序：不在画布 → 吐司中止；
  在画布未勾选协议 → 震动）。`.pcb-gated.is-off-canvas` 只做灰显、保留 pointer-events
  （点了要能弹提示）。`#pcb-context-hint` 显示原因；`refreshPcbContext()` 在窗口
  focus / visibilitychange 时重测（`isOnPcbCanvas === null` 表示检测中，不锁）。
- `showToast(msg, type)`（06-utils.js）：优先 `eda.sys_Message.showToastMessage`，
  退回页面内 `.app-toast`，最后 alert。
- 「关于」页 = `iframe/About.html` + `iframe/js/about.js`（**自带 style，不引 style.css**，
  后者 body 是工具布局）。版本号取 `sys_FileSystem.getExtensionFile('/extension.json')`，
  退回 `fetch('/extension.json')`。菜单：`extension.json` 五个 headerMenus 上下文各加
  `{"id":"About","title":"关于","registerFn":"About"}`；入口 `src/index.ts export About()`。
- `headerMenus` 的 `registerFn` 必须与 `src/index.ts` 的导出函数同名。

## 前端交互约定（2026-10-16）
- 用户协议确认 = 「处理模式」下方的复选框 `#cfg-agree`（容器 `#agree-row`）；点击
  《用户协议与免责声明》文本弹窗查看，弹窗底部只有「关闭」。导入 / 导出嘉立创EDA 五个按钮
  带 `agree-gated` 类，未勾选时 `is-locked` **只做灰显、不加 disabled 属性**
  （加了就点不到、无法触发震动）；`confirmAction()` 统一校验，未勾选 → `shakeAgreement()`
  让复选框左右震动（动画类 `agree-shake`，`animationend` 后移除以支持连点重放）。
- 飞针标注三层并入「自定义/特殊」分组（不建独立分组标题），行内标签用 `.col-name` 与
  「文件名」列对齐，不带「仅显示」「24mil」等后缀；颜色：引脚编号 / 网络名称 `#ffffff`、
  元件位号 `#00ffff`；**三层默认全部勾选**（`flyingOverlayVisible` 全 true，
  意味着位号默认会随导出写进装配层文字）。
- 「导入参数 → 板子属性」新增 **软件名称 / 导出时间**（`prop-soft` / `prop-time`，行
  `row-prop-soft` / `row-prop-time`）：由 `06-utils.js detectEasyEdaSource()` 从
  `rawFilesCache` 头部注释解析 `G04|; EasyEDA[ Pro][ Client] v<ver>, YYYY-MM-DD HH:MM:SS`；
  EasyEDA = 标准版、EasyEDA Pro = 专业版；版本尾部哈希段（`.832e02bb.70b181`）由
  `trimVersionTail()` 去掉。**返回 `{software|null, time|null, raw}`**：
  注释里读不到时间 → 回退取「压缩包内 Gerber 文件时间的最小值」（`07-file-io.js` 入队时
  记录 `mtime`；压缩包条目用 `zipEntryStamp()`，**必须按 Date 的 UTC 字段读**，
  JSZip 的 entry.date 是 `Date.UTC` 由 DOS 时间构造的，用本地字段读会偏一个时区）；
  软件名称读不到保持 null → UI 隐藏该行。刷新点在 `09-ui.js updateBoardStats()`。
- 元件位号字高拆成两个常量（`02-config.js`）：`FLYING_REFDES_HEIGHT_MIL = 24`
  （导出装配层文字）、`FLYING_REFDES_CANVAS_MIL = 16`（画布显示）。
- `.modal-box` max-height = 72vh（协议 7 节，太矮要频繁滚动）。

## 宏基元绘制必须做布尔运算（2026-10-17 修复）
EasyEDA 专业版的 `RoundRect` 宏 = 4 个圆角圆 + 4 条边线 + 1 个外框矩形，**全部是暗基元**，
语义是**并集**。旧实现把 9 个子路径塞进同一条路径 + `fill('evenodd')` → 重叠区域被 XOR 成
孔洞，**每个焊盘都带楔形/圆角缺口**（阻焊层最明显）。修复见 `06-utils.js`：
`macroBuildRings()`（Clipper「暗并集 − 清差集」）+ `macroPrimRing()` + `macroCircleRing()` +
`macroTreeToRings()`，`macroPrimsToPath()` 为对外统一入口（Clipper 不可用回退
`macroPrimsToPathNaive()`），结果按光圈缓存 `_macroRingCache`。
- ⚠️ **Clipper 方向坑**：同一批 subject 里方向相反的多边形会被当成孔洞做减法；宏基元方向
  随机（圆/矩形逆时针、线段四边形顺时针）→ 必须先统一方向（`fillRingArea(p) < 0` 就
  `fillReverseRing`），否则圆角被整块挖掉。
- 缓存键 = 光圈类型 + 参数 + 倍率；实测 48~61 条，整板 3473 flash 全量重绘 ≈ 40ms。

## Copper 段描边铜 → 合并 POLY（2026-10-17，V3.8.2）
- `G04 Copper Start/End` 段里 **G36 区域之外的 D01/弧**（EasyEDA 用 0.2mm 光圈描出的铜箔轮廓）
  不再逐段进 `rawTracks`，改走与非铜层折线相同的 `tempPolySegments → flushPoly → mergeSegments → rawPolys`。
- 标记：`rawPolys[i].isStroke = true`（由 `seg.stroke` 经 `mergeSegments` 透传）。
  `Track Start/End` 段仍是真·走线，保持 `rawTracks`（`effMode === "TRACK"` 已与 COPPER 拆开）。
- **标准版导出必须分流**：`isStroke` 的铜层 POLY → 带线宽的多点 TRACK；否则落 SOLIDREGION，
  而 SOLIDREGION 只写中心线 → 0.2mm 描边铜变成零宽轮廓（几何全丢）。
- **网络**：`netBuildPrims` 里 `isStroke` 的 POLY 走 `pushStrokePoly`，按线段（弧 ≤22.5° 离散）入图，
  `src` 仍指向 POLY 本体 → 整条折线拿同一个网络名。不能走 `netPathToVertices`：它只取顶点，
  2 点开口折线顶点数 < 3 会被跳过（没网络名），弧也被当弦。
- 折线通道的 **360° 整圆**按对径点（`2c - 起点`）拆两段 180°；不能照搬 TRACK 通道的 px/qx 拆法，
  那两段接不上路径起点，POLY 会断开。
- 实测 pcb1（GTL/GBL/G1/GKO）：顶层 1421 段 → 37 条 POLY，长度 1193.294 vs 1193.241mm（0.004%）；
  专业版图元 3592 → 1030（LINE 1529 + ARC 1607 → 462 + 0），网络名 127 个不变；标准版 3557 → 995。
- g12（Copper 段无区外线）逐项零差异；V2/V3 输出一致；80 条描边 POLY 全部带网络名、78 条含 ARC。
- 校验脚本：`Temp/copper_stroke_check.js`（12/12）、`Temp/copper_stroke_pro_check.js`（9/9）、
  `Temp/copper_stroke_ab.js`（7/7，A/B 基线用 `git archive HEAD` 导出到 `Temp/old`）。
- ⚠️ 测试坑：`rawFilesCache` / `loadedFiles` 是 03-state.js 的顶层 `let`，在页面里必须**裸赋值**
  （`rawFilesCache = …`）；写成 `window.rawFilesCache = …` 只会加一个 window 属性，原变量仍是 `[]`，
  于是 `hasSectionMarkers` 判为 false、全走推断分支，测试会静默测错版本。

## FPC 补强 + 专业版 V4 写入（2026-10-17，V3.9.0）
### FPC 补强（Stiffener）
- 文件名：`Gerber_<Top|Bottom>StiffenerLayer_<材料码>_<厚度>.GTSL / .GBSL`。
  顶层归 58、底层归 59；`.GTSL`/`.GBSL` 也进 extensionRules 兜底（02-config.js）。
- **材料码是两套**（实测，不是简单 t→b）：顶层 `pit→Polyimide` / `fr4t→FR4` / `gpt→Stainless Steel`
  / `csa→EMI Shielding Film`；底层 `pib / fr4b / gpb / ssa` 对应同样材料；
  `pst_<型号>` / `psb_<型号>` 取型号大写为材料名（`pst_tesa8854 → TESA8854`，文件名不带厚度，默认 0.1mm）。
- 未知材料码 → `parseStiffenerMeta` 返回 null → 补强形状仍生成普通 FILL（几何保留、材料不写），
  日志统计数量。**绝不猜材料名**（写错比缺失更难发现）。
- `FPC_FILL` 三种格式（V2/V3/V4 图元完全一致）：
  V2 `["FPC_FILL", id, 0, layer, material, thickness, path, 0]`（8 字段）
  V3/V4 `{"type":"FPC_FILL"}||{layerId, material, thickness, path, locked, zIndex}`
  `path = [["R", x, y, w, h, 0, 0]]`，**单位 mil，x=左边界、y=上边界**，thickness 单位 mm。
- `FPC_FILL` 的 R 只能表达轴对齐矩形 → `fpcRectOf()` 只认 4 顶点且 x/y 各 2 个不同值；
  异形补强退回普通 FILL。
- zIndex 从 1 顺序递增（普通图元 zIndex=null 不占号）。
- 板类型自动切 FPC：`autoDetectSettings` 里已有 `hasStiffener` 判断（58/59），无需新增。

### 专业版 V4 写入（仅源码导入）
- `getEnvInfo()` 用 `eda.sys_Environment.getEditorCurrentVersion()` 首字符：2→pro_v2 / 3→pro_v3 / **4→pro_v4**。
- **V4 与 V3 的图元行逐字节同构**，只有文档头不同：
  V4 多 `META`、`LAYER_PHYS`（叠层材料/厚度/zIndex）、`D3_ATTRIBUTE`、`RULE:CREEPAGE`、
  一批显示配置 PRIMITIVE（DRC/BOARDSHAPE/CURSOR/BACKGROUND/GRID/BOLDGRID/COORDINATEAXIS/SELECTBOX/PLANE/null/D3BODY）；
  `DOCHEAD` 多 `editVersion`/`user`，`CANVAS` 多 `layerBrightness`，LAYER 的 inactiveTransparency 1→0.5。
- `LCEDA_V4_Head_Source` 直接取自 `Temp/FPC/V4空白PCB源码.epru`（4.1.78），与原文件逐字节一致；
  生成脚本 `Temp/gen_v4_template.js`（转义 `\` → `\\` 是必须的，否则 JSON 里的 `\"` 会被模板字面量吃掉）。
- `08-export.js`：`isV3`（严格 V3，仅用于 .epru 打包）+ `isLineFormat = isV3 || isV4`（源码拼接 / configureHeader / generatePrimitives 共用）。
- `calculateMaxId` 的 V3 分支扩展到 V4（同样的 ticket/id 正则）。
- ⚠️ V4 的 `ticket/id` 起始值比 V3 大（头部行更多）→ 对比 V3/V4 源码时要归一化编号再比。
