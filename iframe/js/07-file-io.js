// ====================================================================================
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

// ====================================================================================
// 6. 业务逻辑控制器 (Logic Controllers)
// ====================================================================================

    // handleFiles (文件入口)。
    async function handleFiles(files) {
        document.getElementById('loading-overlay').style.display = 'flex';
        rawFilesCache = []; 
        
        // 重置状态
        currentZipName = null; 
        flyingProbeData = null; // --- [新增] 重置网络数据 ---
        // 重新导入一批文件时，放弃上一批遗留的「手动覆盖单位/精度」选择，
        // 让本批文件重新按各自声明自动识别。
        window.manualUnitOverride = false;
        window.manualFormatOverride = false;

        try {
            // --- 阶段一：读取所有文件内容 ---
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileNameLower = file.name.toLowerCase();

                appLog(`导入文件：${file.name}`);

                // === 情况 A: 处理 ZIP 压缩包 ===
                if (fileNameLower.endsWith('.zip')) {
                    currentZipName = file.name.replace(/\.zip$/i, '');
                    
                    const zip = await JSZip.loadAsync(file);
                    const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);
                    
                    for (let name of entries) {
                        // --- [新增] 拦截 FlyingProbeTesting.json ---
                        if (name.toLowerCase().endsWith('flyingprobetesting.json')) {
                            try {
                                const jsonStr = await zip.files[name].async("string");
                                flyingProbeData = JSON.parse(jsonStr);
                                // console.log("成功加载网络文件:", flyingProbeData);
                            } catch (e) {
                                console.error("网络文件解析失败:", e);
                            }
                            continue; // 拦截成功，跳过后续步骤（不作为图层显示）
                        }

                        // 常规 Gerber 处理
                        // 只放进真正像 Gerber/钻孔的文件：说明文件、报告(.ERR)、
                        // 嵌套压缩包、二进制文件都会被拦掉，避免垃圾图层与解析崩溃。
                        const content = await zip.files[name].async("string");
                        if (isGerberText(name, content)) rawFilesCache.push({ name, content });
                    }
                } 
                
                // === 情况 B: 处理散文件 ===
                else {
                    // --- [新增] 拦截 FlyingProbeTesting.json ---
                    if (fileNameLower === 'flyingprobetesting.json') {
                        try {
                            const jsonStr = await file.text();
                            flyingProbeData = JSON.parse(jsonStr);
                            // console.log("成功加载网络文件:", flyingProbeData);
                        } catch (e) {
                            console.error("网络文件解析失败:", e);
                        }
                        continue; // 拦截成功，不存入 rawFilesCache
                    }

                    // 常规 Gerber 处理（同样做内容探测）
                    const content = await file.text();
                    if (isGerberText(file.name, content)) {
                        rawFilesCache.push({ name: file.name, content });
                    } else {
                        appLog(`已跳过非 Gerber 文件：${file.name}`);
                    }
                }
            }

            // --- 阶段二：全量自动检测 ---
            // 单位与精度优先取「文件自己的声明」：%FS 扩展指令、G04 注释
            // （"3 integer and 6 decimal" / "Dimensions in inches" / P-CAD 的
            //  "Numeric Format: 4.4"）、钻孔文件头（";FILE_FORMAT=2:4" /
            //  "METRIC,LZ,000.00000"）。旧实现只认复数形式的 %FS，大量文件
            // 只能退回默认精度，坐标整体差 10 倍。
            let detectedG = { int: null, dec: null }; 
            let detectedD = { int: null, dec: null }; 
            let detectedGraphicUnit = null; 
            let detectedDrillUnit = null; 

            for (const file of rawFilesCache) {
                 const content = file.content;
                 const decl = detectGerberDeclarations(content);
                 const looksDrill = content.indexOf('M48') !== -1 || /\.(drl|txt|xln|ncd|nc)$/i.test(file.name);

                 if (looksDrill) {
                    if (!detectedD.int && decl.dDeclared) { detectedD.int = decl.dInt; detectedD.dec = decl.dDec; }
                    if (!detectedDrillUnit && decl.dUnits) detectedDrillUnit = decl.dUnits;
                 } else {
                    if (!detectedG.int && decl.gDeclared) { detectedG.int = decl.gInt; detectedG.dec = decl.gDec; }
                    if (!detectedGraphicUnit && decl.gUnits) detectedGraphicUnit = decl.gUnits;
                 }
            }

            if (!detectedGraphicUnit) detectedGraphicUnit = 'mm';
            if (!detectedDrillUnit) detectedDrillUnit = (detectedGraphicUnit === 'in') ? 'in' : 'mm';
            
            // ... (UI 同步与 processRawFiles 调用，保持不变) ...
            // 自动识别 Gerber 代际并切换处理模式（注册表驱动，见 processors/registry.js）
            applyDetectedProcessMode(rawFilesCache);

            document.getElementById('cfg-units').value = detectedGraphicUnit;
            document.getElementById('cfg-d-units').value = detectedDrillUnit;
            
            // 自动检测期间不能把「程序写入」误记为「用户手动覆盖」
            window.__autoDetecting = true;
            if (window.setUnitUI) {
                setUnitUI(detectedGraphicUnit, 'graphic');
                setUnitUI(detectedDrillUnit, 'drill');
            }

            if (detectedG.int && detectedG.dec) {
                document.getElementById('cfg-g-int').value = detectedG.int;
                document.getElementById('cfg-dec').value = detectedG.dec;
            }
            if (detectedD.int && detectedD.dec) {
                document.getElementById('cfg-d-int').value = detectedD.int;
                document.getElementById('cfg-d-dec').value = detectedD.dec;
            }
            if (window.syncUiFromState) window.syncUiFromState();
            window.__autoDetecting = false;

            // 解析器默认以「文件自带声明」为准（%FS / G04 / 钻孔头）。
            // 只有用户手动改过单位或精度（UI 会置 manual*Override）才强制覆盖。
            const finalConfig = {
                units: document.getElementById('cfg-units').value,
                drillUnits: document.getElementById('cfg-d-units').value,
                gInt: parseInt(document.getElementById('cfg-g-int').value) || 2,
                gDec: parseInt(document.getElementById('cfg-dec').value) || 5,
                dInt: parseInt(document.getElementById('cfg-d-int').value) || 2,
                dDec: parseInt(document.getElementById('cfg-d-dec').value) || 4,
                forceUnits: window.manualUnitOverride === true,
                forceFormat: window.manualFormatOverride === true
            };
            processRawFiles(finalConfig);

            appLog(`渲染完成`);

        } catch (e) {
            console.error(e);
            alert("加载失败: " + e.message);
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    }
    
    // processRawFiles, autoDetectSettings (处理流程)。
    function processRawFiles(configOverride) {
        loadedFiles = [];
        document.getElementById('layer-list-content').innerHTML = '';
        // 解析结果变了，飞针标注（引脚编号/网络名称/元件位号）需要重建
        flyingLabelCache = null;

        // 当前处理模式决定「怎么解析」与「怎么定层」：特性开关与图层归属都取自处理器
        const processor = processorRegistry.current();
        const parserFeatures = processor.parserFeatures || {};
        if (processor.ready === false) {
            appLog(`处理模式「${processor.label}」尚未实现，暂按通用方式解析`);
        }

        rawFilesCache.forEach((fileObj) => {
            const parseResult = parser.parse(fileObj.content, configOverride, parserFeatures);
            if (parseResult.commands.length === 0) return; 

            let matchedId = 57; 
            for (let rule of fileNameRules) { if (rule.regex.test(fileObj.name)) { matchedId = rule.layerId; break; } }
            // 处理器可覆盖「按文件名猜」的结果（例如 Gerber X2 用 %TF.FileFunction 直接定层）。
            // 取「更具体」的那个：处理器给不出意见(57)时沿用内置规则的结果，
            // 以免 *_silkscreen_bottom.gbr 这类命名被泛化规则回退成顶层。
            if (typeof processor.resolveLayerId === 'function') {
                const overrideId = processor.resolveLayerId(fileObj, parseResult, matchedId);
                if (typeof overrideId === 'number' && (overrideId !== 57 || matchedId === 57)) {
                    matchedId = overrideId;
                }
            }
            
            // --- [新增/修改] 针对埋盲孔 (ID 502) 的自动识别逻辑 ---
            let detectedStart = null;
            let detectedEnd = null;

            if (matchedId === 502) {
                // 匹配格式: ..._Top_to_Inner1... 或 ..._Inner1_to_Inner4...
                // 正则捕获组: (Top|Bottom|Inner\d+)
                const pattern = /_?(Top|Bottom|Inner\d+)_to_(Top|Bottom|Inner\d+)/i;
                const match = fileObj.name.match(pattern);
                if (match) {
                    detectedStart = mapNameToId(match[1]);
                    detectedEnd = mapNameToId(match[2]);
                    console.log(`自动识别埋盲孔层对: ${fileObj.name} -> ${match[1]}(${detectedStart}) to ${match[2]}(${detectedEnd})`);
                }
            }

            loadedFiles.push({
                name: fileObj.name,
                layerId: matchedId,
                // [修改] 默认不勾选钻孔图层 (ID 56)
                visible: matchedId !== 56, 
                index: loadedFiles.length,
                data: parseResult,
                // [新增] 存储层对信息
                pairStart: detectedStart, 
                pairEnd: detectedEnd
            });
        });

        // 1. 排序
        sortLoadedFiles();

        // 2. 自动检测设置
        autoDetectSettings();

        // 3. 调整视图与渲染
        autoFitView();
        renderLayerTable(); 
        drawCanvas();
        // --- [新增] 更新板子属性面板 ---
        updateBoardStats();


        // --- [新增] DEBUG模式下自动转换并输出源码 ---
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            // 延迟一点执行，确保数据就绪
            setTimeout(() => {
                // 默认以 V2 格式预览

                const config = {
                    mode: 'debug',           // 模式：注入画布
                    targetVer: 'pro_v2', // 目标版本：跟随当前编辑器版本
                    sourceType: 'easyedapro',   // 来源
                    tryNetlist: document.getElementById('cfg-netlist').checked, // 尝试生成网络
                    importMethod: 'api'      // [新增] 导入方式: 'source' 或 'api'
                };

                exportForEasyEDA_Pro(config);
            }, 100);
        }

    }

    // [新增] 自动检测层数与板子类型
    function autoDetectSettings() {
        if (!loadedFiles || loadedFiles.length === 0) return;

        let maxInnerId = 0;
        let hasStiffener = false;
        let hasTop = false;     // 新增：标记是否有顶层
        let hasBottom = false;  // 新增：标记是否有底层

        // 1. 遍历文件特征
        loadedFiles.forEach(f => {
            const id = f.layerId;
            
            // 检测 Top/Bottom (ID 1, 2)
            if (id === 1) hasTop = true;
            if (id === 2) hasBottom = true;

            // 检测内层 (ID 15 ~ 46)
            if (id >= 15 && id <= 46) {
                if (id > maxInnerId) maxInnerId = id;
            }
            
            // 检测补强层 (ID 58: Top Stiffener, 59: Bottom Stiffener)
            if (id === 58 || id === 59) {
                hasStiffener = true;
            }
        });

        // 2. 自动设置板子类型 (FPC/PCB)
        if (hasStiffener) {
            setBoardType('FPC'); 
        } else {
            setBoardType('PCB');
        }

        // 3. 自动设置铜层数
        const layerSelect = document.getElementById('cfg-copper-layers');
        if (layerSelect) {
            let targetLayerCount = 1; // 默认初始值设为 1

            if (maxInnerId > 0) {
                // 如果有内层，按之前的逻辑计算 (2 + 内层偶数块) -> 4, 6, 8...
                // Inner1 (ID 15) -> index 1 -> ceil(0.5)*2 = 2 -> 2+2=4
                const innerIndex = maxInnerId - 14; 
                const requiredInnerBlock = Math.ceil(innerIndex / 2) * 2;
                targetLayerCount = 2 + requiredInnerBlock;
            } else {
                // 没有内层，根据顶底存在情况判断
                if (hasTop && hasBottom) {
                    targetLayerCount = 2; // 双面板
                } else if (hasTop || hasBottom) {
                    targetLayerCount = 1; // 单面板
                } else {
                    // 既无顶也无底 (例如只导入了 Drill 或 Silk)，默认归为 1 层
                    targetLayerCount = 1;
                }
            }

            // 设置下拉框的值
            layerSelect.value = targetLayerCount;
        }
    }

    /**
     * --- [新增] 从 EDA 获取当前板子 Gerber ---
     */
    async function importCurrentGerber() {
        if (typeof eda === 'undefined') {
            alert("未检测到嘉立创 EDA 环境，无法使用此功能。");
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        overlay.textContent = "正在从 EDA 获取 Gerber...";
        overlay.style.display = 'flex';

        try {
            // 1. 调用 API 获取 ZIP 文件对象
            // 该 API 返回标准的 File 对象 (application/zip)
            const zipFile = await eda.pcb_ManufactureData.getGerberFile();

            if (zipFile) {
                console.log("获取成功:", zipFile.name, zipFile.size);
                
                // 2. 复用现有的 handleFiles 逻辑
                // handleFiles 接受 FileList 或数组，我们构造一个数组传进去
                await handleFiles([zipFile]);
            } else {
                alert("获取失败：API 返回了空文件。请确保 PCB 文档已打开。");
                overlay.style.display = 'none';
            }

        } catch (e) {
            console.error(e);
            alert("获取 Gerber 异常: " + e.message);
            overlay.style.display = 'none';
        }
    }

