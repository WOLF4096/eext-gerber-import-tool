# 项目长期记忆 — pro-api-sdk / eext-gerber-import

## 项目本质

嘉立创EDA 专业版扩展「Gerber 转 PCB」。**真正的产品是单页应用，不是 TS 脚手架**：

- `src/index.ts`（758 B）只是入口壳，`ImportGerber()` 调
  `eda.sys_IFrame.openIFrame('/iframe/ImportGerber.html', 1280, 800, 'ImportGerber')`。
- 全部业务逻辑在 `iframe/` 下，**与 `src/` 无关**；构建时 `.edaignore` 会把 `src/`、`build/`、`config/` 排除，
  只把 `iframe/`、`dist/index.js`、`extension.json`、`locales/`、`images/` 等打进 `.eext`。
- 因此改功能基本都在改 `iframe/`，`npm run build` 只负责打包，不参与 iframe 的构建。

## iframe 目录结构（2026-10-14 从单文件拆分而来）

原 `iframe/ImportGerber.html` 为 315 KB 单文件（内联 CSS + 内联 JS）。现已拆为：

| 文件 | 职责 |
|---|---|
| `iframe/ImportGerber.html` | 界面骨架：head + body 标记 + 资源引用 |
| `iframe/css/style.css` | 全部样式（dark 主题） |
| `iframe/js/jszip.min.js`、`jspdf.umd.min.js` | 第三方库 |
| `iframe/js/01-templates.js` | 工程文件头模板常量（STD / V2 / V3） |
| `iframe/js/02-config.js` | DEBUG、全局变量、图层定义与文件名识别规则 |
| `iframe/js/03-state.js` | 运行时状态、画布上下文、免责声明弹窗 |
| `iframe/js/04-gerber-parser.js` | `class GerberParser`（RS-274X 解析） |
| `iframe/js/05-pad-tool.js` | `PadTool` 逆向还原引擎（提取→聚合→生成图元） |
| `iframe/js/06-utils.js` | 通用工具函数 |
| `iframe/js/07-file-io.js` | 文件导入与解析调度 |
| `iframe/js/08-export.js` | 导出控制器（画布注入 / .epcb / .epro2 / PDF） |
| `iframe/js/09-ui.js` | UI 渲染与交互 |
| `iframe/js/10-init.js` | 初始化与全局事件 |

## 维护铁律

1. **`iframe/js/0X-*.js` 的数字前缀 = 加载顺序，不可调整**。
   用经典 `<script src>`（**禁止 `type="module"`**）——多个经典脚本共享同一全局词法作用域，
   顶层 `const`/`let`/`class` 跨文件可见，所以不需要 import/export。
2. **脚本必须放在 `</body>` 之前**：`03-state.js` 与 `10-init.js` 在**加载时**就访问 DOM
   （`getElementById('main-canvas')`、`resizeCanvas()`、`drawCanvas()`）。
3. **所有脚本引用用绝对路径 `/iframe/...`**（与原文件活动配置一致），保证 EDA 环境零回归；
   需用浏览器直接打开时才改成相对路径 `css/`、`js/`。
4. **不要对内联脚本做反缩进**：顶层 4 空格缩进是刻意保留的，
   模板字面量（工程头模板、innerHTML 片段）对空白敏感。
5. **`.js` / `.css` 一律带 UTF-8 BOM**：内容含中文，防服务端不下发 charset 时乱码。
6. 新增功能放对应职责文件，**不要重新内联回 HTML**。

## 已知空缺 / 技术债

- ⚠️ **`iframe/js/processors/` 未被 git 跟踪**（`git status` 里是 `?? iframe/js/processors/`），
  而 `ImportGerber.html` 已引用其中脚本。提交前必须 `git add iframe/js/processors`，
  否则别人克隆后 404、页面打不开。`.eext` 打包走文件系统 + `.edaignore`，不受影响。
- `exportForStandard()` 是空实现（只 `alert('待后续更新')`），但 UI 仍暴露入口。
- `importPrimitivesAPI` 里 `pcb_Primitive*.create()` 返回 Promise 但**既未 await 也未 catch**，
  失败会变成静默的 unhandled rejection；且只支持 V2 图元数组格式
  （`handleExportToCanvas('api')` 会强制把 clientVer 设为 `pro_v2`，所以当前没问题）。
- 光圈宏现已支持基元 1/4/5/20/21/22 与 `$n` 参数化运算（`resolveApertureMacro()`）；
  6(Moiré)/7(Thermal) 仍未绘制。
- `LCEDA_STD_Head_Source` 声明了但从未使用。
- `src/index.ts` 里 `import * as extensionConfig from '../extension.json'` 导入后未使用。
- `DEBUG` 硬编码为 `false`（true 那行被注释），调试面板/「生成」按钮等于死功能。
- 版本号三处不一致：`extension.json` 3.4.0 / `package.json` 1.1.1 / CHANGELOG 缺 3.4.0 条目。
- `exportForEasyEDA_Pro` 用 `LCEDA_V3_Head_Source` / `LCEDA_V2_Head_Source` 作模板，
  `configureHeader()` 在其上按铜层数（layerId 15–46）与埋盲孔规则打补丁。
- V3 工程文件 = JSZip 打包 `{name}.epru` + `project2.json` → 改名 `.epro2`。

## 几个容易踩的业务坑（已在代码里注释）

- **坐标 vs 光圈参数的单位不同**：解析阶段 `X/Y/I/J` 已换算成 mm，但**光圈/宏参数仍是文件单位**。
  `PadTool` 里坐标必须用 `mmOf()`（仅有限性保护），光圈参数才用 `toMM()`。
  混用会让英寸文件的元件位置整体偏 25.4 倍（历史上就是这么错的）。
- **`PadTool.extractRawData` 依赖 `G04` 段标记**（嘉立创专业版私有）：`Pad Start` / `Via Start` /
  `Track Start` / `PolygonModel Start` / `Copper Start` / `Image Start` / `Text Start` /
  `Drill Drawing Start`。没有这些标记的来源必须靠 `hasSectionMarkers` 分支按图层+指令类型推断。
- **无 D 码的坐标行要沿用模态操作码**（`state.dCode`）；位置未定义时的裸 `D2*` 不要写进包围盒，
  否则 (0,0) 会毁掉 `autoFitView`。
- **`isGerberText` 必须传 content**：只给文件名时会退回旧的扩展名判断。


## 目录约定（重要）

- **所有临时文件放根目录 `Temp/`**，它同时被 `.gitignore` 与 `.edaignore` 排除（不进 git、不进 `.eext`）：
  回归测试脚本、测试样本 `Temp/测试gerber/`、截图、报告 md、原始单文件备份 `Temp/ImportGerber.html.orig`。
- `.workbuddy/` 只保留 `memory/`（记忆，跟踪进 git）；`.workbuddy/tmp/` 已废弃。
- 脚本路径：`.workbuddy/tmp` → `Temp`，`测试gerber` → `Temp/测试gerber`；
  `verify.py`/`split.py` 的 ROOT 已由三级 `dirname` 改为两级。

## 打包与版本

- `.edaignore` 决定 `.eext` 内容：排除 `.workbuddy/`、`Temp/`、`/images/Test.png`（仅 README 演示图）。
  运行期必需 = `dist/index.js`、`iframe/**`（含 `js/processors/`）、`extension.json`、
  `images/logo.png`、`locales/**`；`README/CHANGELOG/LICENSE` 作为元数据保留。
- 打包：`npm run build` → `build/dist/eext-gerber-import_v<version>.eext`（已 gitignore）。
- 版本号以 `extension.json` 为准（当前 **3.4.0**），`package.json` 已同步；`CHANGELOG.md` 记到 V3.4.0。

## 可用工具（均在 Temp/）

- `verify.py`（字节级等价校验）、`split.py`（拆分器）、`smoke.js`（真实 Chrome 前后对比）、
  `guard_test.js`、`processor_test.js`、`render_test.js`、`repro_full.js`。
- 运行 JS 测试需设 `NODE_PATH=C:/Users/狼黑/.workbuddy/binaries/node/workspace/node_modules`（内含 playwright-core）。
