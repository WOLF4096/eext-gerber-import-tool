# 项目长期记忆 — eext-gerber-import（Gerber 转 PCB）

> 2026-10-17 整理：合并去重、删掉已被后续版本推翻的旧结论。细节变更历史见 CHANGELOG.md。

## 1. 项目本质与结构
嘉立创EDA**专业版**扩展。真正产品是 `iframe/` 下的单页应用；`src/index.ts` 只是壳
（`eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', …)`）。改功能只改 `iframe/`。

- `iframe/js/`（数字前缀 = 加载顺序，不可调；**经典 `<script>`，禁止 type=module**）：
  01-templates 02-config 03-state 04-gerber-parser 05-pad-tool 06-utils 07-file-io
  08-export 09-ui 10-init 11-font-outline + clipper.js(6.4.2) + jszip/jspdf
- `iframe/js/processors/`：registry + industry-common + industry-rs274x + jlc-internal
- 铁律：脚本放 `</body>` 前；引用用绝对路径 `/iframe/...`；`.js`/`.css` 带 **UTF-8 BOM**；
  不要反缩进（模板字面量对空白敏感）；新功能别内联回 HTML。
- 版本以 `extension.json` 为准（`package.json` 同步），`npm run build` → `build/dist/*.eext`。
  临时文件一律放 `Temp/`（gitignore + edaignore）。当前 **V3.9.9**。
**Temp 已分类（2026-10-17）**：`scripts/{checks,diag,shots,tools}`、`samples/{测试gerber,FPC,fixtures,解压}`、
`refs/{image,生成网络}`、`backup/{code,base,old,serve_before}`、`shots`、`assets`、`del`（可清空）；
`fonttest`/`rewardtest` 是依赖目录（README 引用路径，勿改名）。详见 `Temp/README.md`；
面向人的分析文档在项目根 `docs/`（已加入 edaignore，不进包）。

## 2. 处理模式（仅两项）
下拉 `#cfg-source-type`：`easyedapro`（嘉立创内部）/ `rs274x`（通用）。
X2/X3/RS-274D/兼容/保底 已删。新增处理器要同步改三处（HTML option + script、resetConfig）。

## 3. 单位 / 坐标（混用必错 25.4 倍）
- 坐标用 `mmOf()`，光圈与宏参数用 `toMM()`。
- 标准版导出：1 单位 = 10 mil = 0.254 mm；`X=4020+mmX/0.254`，`Y=3560.5-mmY/0.254`。
- ⚠️ `stdX`/`stdY` **返回字符串**，算术前必须先 `parseFloat`（`"3521.12"+1.5` → 拼串 → 坐标归零）。

## 4. Gerber 解析铁律
- `extractRawData` 依赖嘉立创私有 `G04` 段标记；无标记靠 `hasSectionMarkers` 分支按层+指令推断。
- 无 D 码坐标行沿用模态操作码 `state.dCode`；位置未定义的裸 `D2*` 不写包围盒。
- 跨文件配点必须容差（0.05mm 栅格归并）；`toFixed(3)` 精确键会让过孔/钻孔大面积配不上。
- 焊盘去重必须带 `layerId`（`rawPads` 是所有层公共数组）。
- 过孔 vs 插件盘：钻孔≥0.6mm 且铜环≥0.25mm → 插件焊盘（THT_DRILL_MIN/THT_RING_MIN）。
- 宏基元 6/7 未绘制；`%SR` 未处理；真彩图片离线无解（见 `docs/FCTS_解析报告.md`）。
- ⚠️ 测试坑：`rawFilesCache` / `loadedFiles` 是 03-state 的顶层 `let`，页面里必须**裸赋值**；
  写 `window.rawFilesCache = …` 只会加 window 属性 → `hasSectionMarkers` 判 false → 静默测错版本。

## 5. 图元生成（05-pad-tool / Clipper）
- LPC（清除极性）不能整体丢：负片覆铜 = 暗区 + 清区（区域/闪绘/线段都要收集）。
- 负片转正片：Clipper 差集 → 残留孔洞开 0.01mm keyhole 缝 → 只输出外边界，每块一个 FILL。
  `createComplexPolygon` 是「多块独立多边形」，不做布尔差。
- FILL 创建：单环用平铺 `createPolygon(平铺)`；`createComplexPolygon` 入参是**多块数组**，
  单元素嵌套 `[[ring]]` 会被当平铺解析 → 返回 undefined → 填充静默消失。用「平铺优先 + 多重兜底」。
- 整圆：CIRCLE 导出成起点=终点 360° 弧；画布 moveTo 后画 0~2π，导出拆两段 180° 半圆。
  折线通道的整圆按对径点（`2c-起点`）拆，不能照搬 TRACK 的 px/qx 拆法（路径会断）。
- 宏光圈焊盘 w=h=0，`calcExp` 用 path 包围盒算阻焊扩展。
- **宏基元必须做布尔并集**：`RoundRect` = 4 圆 + 4 边 + 1 外框，语义是并集；旧做法塞一条路径 +
  `fill('evenodd')` → 重叠区被 XOR 成孔（每个焊盘带楔形缺口）。修复：`macroBuildRings()`
  （Clipper 暗并集 − 清差集）+ `macroPrimRing/macroCircleRing/macroTreeToRings`，
  `macroPrimsToPath()` 为对外入口（无 Clipper 回退 `macroPrimsToPathNaive`），按光圈缓存 `_macroRingCache`。
  ⚠️ Clipper 方向坑：同批 subject 里方向相反会被当孔洞 → 先统一方向（`fillRingArea<0` 就 reverse）。
- **Copper 段描边铜**（`G04 Copper Start/End` 里 G36 之外的 D01/弧，0.2mm 光圈描轮廓）：
  走 `tempPolySegments → flushPoly → mergeSegments → rawPolys`，标记 `isStroke=true`；
  `Track Start/End` 仍是真走线（`rawTracks`）。标准版导出 `isStroke` 的铜层 POLY → 带线宽多点 TRACK
  （落 SOLIDREGION 会变零宽）。网络里走 `pushStrokePoly`（按线段，弧 ≤22.5° 离散，src 指向 POLY 本体）。
- **标准版 Gerber 区域环「零长首段 + 未闭合」**（只有标准版来源会「渲染对、导入错」，填充全丢）：
  `fillNormalizeFlatRing(flat, tol)`（06-utils）去零长边 + 补闭合，`05-pad-tool` 生成 FILL 时对
  `singlePath` 和每个 `holes` 环都过一遍；`08-export` 的 `stdFlattenPath` 出口去掉相邻重复点。
  判据：**无退化边 + 显式闭合**，否则 EDA 面多边形校验会拒整块。脚本：`Temp/scripts/checks/fill_*_check.js`。

## 6. 标准版导出格式（08-export.js `buildStandardSource`）
- 字段数：PAD 20 / VIA 8 / HOLE 6 / TRACK 7 / ARC 8 / CIRCLE 10 / SOLIDREGION 10 / TEXT 17。**没有 POLY**。
- 区域类一律 SOLIDREGION（不要 COPPERAREA）；槽孔必须同时给 `holeLength` + `slotPointArr`。
- 图层 ID 与内部编号不是一套（5=锡膏 / 7=阻焊 / 10=板框 / 11=Multi / 12=Document / 15-46=Inner1-32），
  阻焊/锡膏/装配需按**语义**映射，不能按 id 硬对。
- **折线全转 TRACK**（V3.9.6）：`polys` 无论铜层/非铜层一律收集成段参与合并；实心铜走 `uni.fills`。
- **相邻 TRACK 链式合并**（V3.9.7）：同层+同线宽+同网络+端点相接（0.001mm 量化）→ 一条多点 TRACK；
  链在端点（度1）与分叉（度>2）处断开，分叉拆多条；纯环输出闭合点列；**ARC 不参与合并**（并进 TRACK 会变直）。
- 标准版不支持 FPC：polys/fills/images 跳过 58/59（`STD_LAYER(58)` 兜底会落到文档层）。
- 标准版不导出埋盲孔。

## 7. 内置字体轮廓（V3.9.6）
浏览器 / EDA iframe 拿不到字体矢量路径（canvas 只能画、不能导出 path）→ 离线提取、随包内置：
- `iframe/js/11-font-outline.js`：`FONT_OUTLINE_DATA` + `fontTextToPath` / `fontEmForCapHeight`，
  默认 ASCII 0x20–0x7E 共 94 字形。字体名写 `NotoSansCJKsc-DemiLight`（与 EDA 源码一致）。
- 工具 `tools/font-outline.js`（不进包，edaignore 已排除）：
  `npm i opentype.js --prefix Temp/fonttest --no-save` →
  `NODE_PATH=Temp/fonttest/node_modules node tools/font-outline.js --font <ttf> [--extra "字符"] [--range 0x4E00-0x9FA5]`
- `C:/Windows/Fonts/NotoSansSC-VF.ttf` 是**可变字体**（默认 wght=100 Thin），opentype.js 的
  `variation.set` 不改轮廓 → 先 `python -m fontTools.varLib.instancer <VF> wght=350 -o Temp/assets/NotoSansSC-DemiLight.ttf`
  （已验证 cap/em = 0.732）。
- 字高约定：PCB 说的「字高」= **cap height**。`em = capMil / (capHeight/upem)`；30mil → em ≈ 41.0mil ≈ 4.098 标准版单位。
- 缺字跳过并记日志，绝不用近似字形顶替。

## 8. 物理网络生成（06-utils `buildNetAssignments`）
开关：`config.tryNetlist`（复选框 `#cfg-netlist`，默认勾选）→ `05-pad-tool generatePrimitives`
与 `08-export buildStandardSource` 各自调用。算法：铜层图元 → 空间网格（5mm + 1mm 余量）求候选对
→ `netConnected()` 几何判定 → 并查集 → 分量命名 → 回填。
- 通道：源码导入 / 图元导入 / 导出专业版 V2、V3、V4 / 导出标准版。标准版网络字段位置：
  `TRACK[3] / ARC[3] / CIRCLE[8] / SOLIDREGION[2] / PAD[7] / VIA[4]`；HOLE 无网络字段；
  板框 TRACK 与非铜层留空。未勾选时全写空串，输出与改动前逐字段一致。
- **定名规则**（不能按名字长短，参考实现就是错的）：① 票数多者优先 ② 真实名 > 通用 `NET*`
  ③ 短名 ④ 字典序。
- **几何判定**（误连/漏连的真正来源）：
  - 圆用**内接正十二边形**（旧用包围盒四边，方角远 √2 倍 → 误判相接）。
  - 矩形 / 长圆 / 异形用**真实轮廓** `netPadOutline`（旧用最短边内切圆 → 导线连不上焊盘 → 拆孤岛）。
  - 圆弧按 **≤22.5° 离散**（只影响连通图，不改生成图元）；旧只取弦，差一个矢高。
  - 导线端点正好搭在焊盘边界：补 `netSegSegDist2`「线段到多边形**边**距离 ≤ 线宽/2」
    （严格相交判端点=false、ray casting 边界不可靠、顶点距离≈半个焊盘）。圆形焊盘本就没这问题。
- **两个不同已知网络落到同一连通块 → 整块改名未占用的 `NET*`**。触发两条：
  ① `tryUnion` 时两边 label 无交集（`stats.renamedMerges`，标记传播到新根 `conflictRoots`）；
  ② 定名阶段 `votes.size > 1`（两个网络的焊盘通过**无名**导线/覆铜连上，union 阶段看不见）。
  新名 `while (used.has('NET'+c)) c++`，两个原名都不出现。`stats.renamedClusters` / `mixedClusters`。
- ⚠️ **改名同时必须改焊盘**（V3.9.9）：`buildNetAssignments` 返回 `renamed`（Set，冲突改名的图元），
  焊盘取值时 `isNetRenamed(pad) → netName = netOf.get(pad)`；否则焊盘沿用自己的飞针名，
  出现「焊盘 NET_4 / 焊盘 NET_2 / 中间导线 NET1」。**焊盘编号与 groupId 不受影响**（来自飞针匹配）。
  正常分量仍**飞针名优先**（飞针文件才是名字来源）。
- 健康度指标（`Temp/scripts/checks/net_health.js`）：`mixedClusters`（分量混多网络）与「同名多岛」（= 飞线）。
  6 个样本全部 0/0/0，网络名数 = 分量数 1:1。PCB1_2026-10-15：GND 2645 图元 / DP 35 图元 / 22 块覆铜归 GND。
- 校验脚本：`Temp/scripts/checks/` 下的 `net_conflict_probe.js`、`fix_check.js`、`fix_regress.js`。

## 9. 飞针标注 / 位号 / 补强标注
- 虚拟层：2001 引脚编号 / 2002 网络名称 / 2003 元件位号（有 `FlyingProbeTesting.json` 才出现）/
  2004 补强名称。三层引脚类并入「自定义/特殊」分组、**默认全勾选**；位号颜色 `#00ffff`，其余 `#ffffff`。
- 匹配统一在 06-utils（`buildFlyingPinIndex` / `padMatchBoxMM` / `flyingPinAt`）：① 中心 2.5mil 内
  ② 否则取落在焊盘包围盒内离中心最近的引脚（异形盘锚点常偏 27mil，只用中心匹配会整批丢编号）。
- 字高：`FLYING_REFDES_HEIGHT_MIL=30`（导出，cap height）、`FLYING_REFDES_CANVAS_MIL=16`（画布）；
  补强 `FLYING_STIFFENER_MAX_FONT=24`，引脚 `FLYING_LABEL_MAX_FONT=12`。
- **位号图层（V3.9.9 起按通道区分）**：
  - 专业版（源码/图元 → 05-pad-tool 的 STRING）：**装配层**，顶层 `9`、底层 `10` + `mirror`。
  - 标准版（08-export 的 TEXT）：**文档层**（层号 `12`）。
  - 常量：`FLYING_REFDES_LAYER_STD=12` / `_TOP=9` / `_BOTTOM=10`。
- 引脚编号 / 网络名称仅显示不导出；位号勾选后才随导出写文字。
- 单位 mil。孤立焊盘占位名（PAD / PAD1 / PAD23）一律跳过（`isFlyingPadPlaceholder`）。
- 补强画布标注：材料简称在上、厚度在下（`0.2mm`），行距 `half = min(boxH/4, 0.72×字号)`，色 `#193366`；
  `STIFFENER_LABEL`：PI / FR4 / 钢片 / 双面胶 / 电磁屏蔽膜。
  ⚠️ `renderFlyingLayerRows` 曾因 `if (!flyingProbeData) return` 让 FPC 板（无飞针文件）不显示补强行，
  已拆成 `hasFlying` / `hasStiff` 两个独立条件。

## 10. FPC 补强（Stiffener）
- 文件名 `Gerber_<Top|Bottom>StiffenerLayer_<材料码>_<厚度>.GTSL/.GBSL`，顶层 58 / 底层 59。
- 材料码两套：顶 `pit/fr4t/gpt/csa`，底 `pib/fr4b/gpb/ssa`；`pst_/psb_<型号>` 取型号大写
  （`pst_tesa8854 → TESA8854`，默认 0.1mm）。未知材料码 → 材料不写、几何保留，**绝不猜材料名**。
- `FPC_FILL`：V2 `["FPC_FILL", id, 0, layer, material, thickness, path, 0]`；
  V3/V4 `{"type":"FPC_FILL"}||{layerId, material, thickness, path, locked, zIndex}`。
  `path` 是路径对象数组（mil；thickness 单位 mm）：矩形快捷 `[["R",x,y,w,h,0,0]]`（x/y = 左上），
  通用 `[[x0,y0,"L",x1,y1,…,"ARC",扫角,x,y,…]]`。`fpcRectOf()` 命中 4 顶点才用 R 式。
- **补强只能「通过源码导入」**：`pcb_PrimitiveFill.create(58/59,…)` 实测无效（即便先 `setPcbType(2)`）。
  图元模式遇到 `FPC_FILL` / 58-59 层 FILL 直接跳过 + 计数 + 吐司，且**不再调 setPcbType**。
- 板类型自动切 FPC：`autoDetectSettings` 的 `hasStiffener`（58/59）。
- `configureHeader` 用 `needStiffener` 打开 58/59 的 `use/show`（V2 置 `LAYER[4]=3`），否则看不见。

## 11. 专业版 V4
- `getEnvInfo()`：`getEditorCurrentVersion()` 首字符 2→pro_v2 / 3→pro_v3 / 4→pro_v4。
- V4 图元行与 V3 **逐字节同构**，只有文档头不同（多 `META`/`LAYER_PHYS`/`D3_ATTRIBUTE`/`RULE:CREEPAGE`
  与一批显示配置 PRIMITIVE；`DOCHEAD` 多 `editVersion`/`user`；`CANVAS` 多 `layerBrightness`）。
  模板 `LCEDA_V4_Head_Source` 取自官方 4.1.78 空白 `.epru`，生成脚本 `Temp/scripts/tools/rebuild_v4_template.js`。
- 三个坑：① 模板字面量里 JSON 的 `\"` 要写成 `\\"`（少一层 → `LAYER` 行非法 JSON，60 行全废）；
  ② 末行**不能**以 `|` 结尾（否则 `}||`）；③ 以官方导出为准，别按旧模板补猜字段。
- `isV3`（严格 V3，仅 .epru 打包）/ `isLineFormat = isV3 || isV4`；`calculateMaxId` V3 分支扩到 V4。
- V4 的 `ticket/id` 起始值比 V3 大，对比源码要先归一化编号。
- 四套源码颜色以 **V3 模板**为基准（V2/V4 已对齐；标准版按语义映射）。

## 12. 渲染 / 交互 / 门控
- **高 DPI**（V3.9.7）：给 `canvas.width` 赋值会把变换重置成单位矩阵。`drawCanvas` 进入时无条件
  `ctx.setTransform(dpr,0,0,dpr,0,0)`（幂等自愈），结尾补 `ctx.restore()`；PDF 恢复现场改调 `resizeCanvas()`。
  `watchDprChanges()` 用 `matchMedia('(resolution: Ndppx)')` 监听并**重新挂载**。
  验证口径：dpr=2 的物理尺寸必须是 dpr=1 的 2 倍（`Temp/scripts/checks/dpr_fix_check.js`，必须跨 dsf 比较）。
- **PCB 画布门控**：`detectPcbCanvasContext()` —— `getDocumentSource()` 读不到 = 不在画布；
  读到非 PCB 源码 = 不在；源码为空时用 `documentType === 3` 交叉确认（空白 PCB 源码可能为空）。
  按钮加 `pcb-gated` + `confirmPcbAction()`；`.is-off-canvas` 只灰显、保留 pointer-events（否则点不到弹不出提示）。
  `refreshPcbContext()` 在 focus / visibilitychange 重测；`isOnPcbCanvas === null` 表示检测中。
- **用户协议**：复选框 `#cfg-agree`（`#agree-row`）；导入/导出五个按钮带 `agree-gated`，
  未勾选 `is-locked` **只灰显、不加 disabled**；`confirmAction()` 校验，未勾选 → `shakeAgreement()`。
- `showToast(msg, type)`：优先 `eda.sys_Message.showToastMessage` → 页面内 `.app-toast` → alert。
- 「板子属性」新增 软件名称 / 导出时间：`detectEasyEdaSource()` 解析头部
  `G04|; EasyEDA[ Pro][ Client] v<ver>, YYYY-MM-DD HH:MM:SS`，返回 `{software,time,raw}`；
  时间读不到回退压缩包内 Gerber 的 mtime（JSZip `entry.date` 必须按 **UTC** 字段读）。
  刷新点 `09-ui updateBoardStats()`。
- 「关于」页 = `iframe/About.html` + `js/about.js`（自带 style，不引 style.css）。
  菜单：`extension.json` 五个 headerMenus 各加 `{"id":"About","registerFn":"About"}`，
  `registerFn` 必须与 `src/index.ts` 的导出函数同名。
- `.modal-box` max-height = 72vh。

## 13. 已知缺口
宏基元 6/7 未绘制；`%SR` 未处理；`DEBUG` 硬编码 false；`LCEDA_STD_Head_Source` 空串；
`importPrimitivesAPI(primitives, isV3)` 的 `isV3` 从未使用（api 模式强制 pro_v2）；
PCB/FPC 手动开关只改 UI；标准版不导出埋盲孔；真彩图片离线无解。
`ImportGerber.html` 协议「技术局限」条已在 V3.9.9 改成与实现一致（网络为几何推算、冲突改名 `NET*`、
标准版不含埋盲孔、位号落层），责任/侵权/备份条款一字未动 —— 以后改这段只动**技术表述**。

## 14. 文档三处联动的约定
功能改动要同步四处：`CHANGELOG.md`（新版本条目）→ `README.md`（能力矩阵 + 4.4 特殊功能）→
`iframe/ImportGerber.html`（导出页提示列表 + 协议「技术局限」）→ `iframe/About.html`（使用方法/注意事项）。
版本号改 `extension.json` + `package.json`，然后 `npm run build`（HTML 也打进包，文档改了必须重打包）。
分析类文档放项目根 `docs/`（报告/修复记录/参考三个子目录，edaignore 已排除）；
一次性数据 dump、临时截图放 `Temp/del/`（可随时清空）。
