// ====================================================================================
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

    /**
     * --- 6. PDF 导出功能模块 (逻辑修正版) ---
     */
    window.exportPDF = async (mode) => {
        if (loadedFiles.length === 0) {
            alert("请先加载 Gerber 文件");
            return;
        }

        // [新增] 计时
        const startTime = performance.now();

        const overlay = document.getElementById('loading-overlay');
        overlay.textContent = "正在准备 PDF 0%...";
        overlay.style.display = 'flex';

        // 给 UI 一点渲染时间
        await new Promise(r => setTimeout(r, 50));

        let savedState = null;

        try {
            // 1. 确定要导出的目标图层列表 & 用于计算尺寸的图层列表
            let targetLayers = []; // 实际要渲染的层
            let boundsLayers = []; // 用于计算包围盒的层

            if (mode === 'single') {
                // [当前内容]：合成渲染，只计算可见层尺寸
                targetLayers = null; // 特殊标记：不需要循环单独渲染
                boundsLayers = loadedFiles.filter(f => f.visible);
            } 
            else if (mode === 'multi') {
                // [启用图层]：只导出可见层，每层一页
                targetLayers = loadedFiles.filter(f => f.visible);
                boundsLayers = targetLayers;
            } 
            else if (mode === 'all') {
                // [全部图层]：导出所有层，每层一页
                targetLayers = loadedFiles;
                boundsLayers = loadedFiles; // 必须计算所有层的尺寸，防止隐藏的大层被裁切
            }

            if (boundsLayers.length === 0) {
                throw new Error("没有可导出的图层 (请至少启用一个图层)");
            }

            // 2. 备份当前视图状态 (用于导出后恢复)
            savedState = {
                w: mainCanvas.width, 
                h: mainCanvas.height,
                scale: viewState.scale,
                offsetX: viewState.offsetX, 
                offsetY: viewState.offsetY,
                visibility: loadedFiles.map(f => f.visible) // 备份可见性状态
            };

            // 3. 计算包围盒 (基于 boundsLayers)
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            
            boundsLayers.forEach(f => {
                const b = f.data.bounds;
                if (b.minX !== Infinity) {
                    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
                    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
                }
            });

            if (minX === Infinity) throw new Error("无法获取板子尺寸");

            
            // 4. 定义 PDF 物理尺寸 (英寸)
            const paddingInches = 0.7; // 固定 0.7 英寸边距
            
            // 将板子尺寸从 mm 转换为 inch
            const boardW_in = (maxX - minX) / 25.4;
            const boardH_in = (maxY - minY) / 25.4;
            
            // 加上边距的预期尺寸
            const raw_pdfW_in = boardW_in + (paddingInches * 2);
            const raw_pdfH_in = boardH_in + (paddingInches * 2);

            // 5. 读取 DPI 并计算画布像素
            const uiDpiVal = document.getElementById('cfg-dpi') ? document.getElementById('cfg-dpi').value : '1200';
            const targetDPI = parseInt(uiDpiVal) || 1200;

            // 像素 = 原始英寸 * DPI (向上取整)
            const canvasW = Math.ceil(raw_pdfW_in * targetDPI);
            const canvasH = Math.ceil(raw_pdfH_in * targetDPI);

            // 反向计算最终精确的 PDF 英寸尺寸 (避免像素取整误差导致比例不对)
            const final_pdfW_in = canvasW / targetDPI;
            const final_pdfH_in = canvasH / targetDPI;

            // 调整 Canvas 大小以匹配高分辨率
            mainCanvas.width = canvasW;
            mainCanvas.height = canvasH;
            bufferCanvas.width = canvasW;
            bufferCanvas.height = canvasH;

            // CSS 视觉缩放 (防止页面布局被撑大)
            const container = document.getElementById('canvas-container');
            const contW = container.clientWidth;
            const contH = container.clientHeight;
            // 保持比例居中显示
            const displayRatio = Math.min(contW / canvasW, contH / canvasH);
            
            mainCanvas.style.width = `${canvasW * displayRatio}px`;
            mainCanvas.style.height = `${canvasH * displayRatio}px`;
            mainCanvas.style.marginLeft = `${(contW - canvasW * displayRatio) / 2}px`;
            mainCanvas.style.marginTop = `${(contH - canvasH * displayRatio) / 2}px`;

            // 6. 计算渲染参数 (视图变换)
            const pixelScale = targetDPI / 25.4; 
            // 计算居中偏移
            const effectivePaddingW_Px = (canvasW - ((maxX - minX) * pixelScale)) / 2;
            const effectivePaddingH_Px = (canvasH - ((maxY - minY) * pixelScale)) / 2;

            // 应用到 ViewState
            viewState.scale = pixelScale;
            viewState.offsetX = effectivePaddingW_Px - (minX * pixelScale);
            viewState.offsetY = effectivePaddingH_Px + (maxY * pixelScale);

            // 7. 初始化 PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: final_pdfW_in > final_pdfH_in ? 'l' : 'p',
                unit: 'in', 
                format: [final_pdfW_in, final_pdfH_in]
            });

            // 辅助：黑底绘图函数 (接收 forceSolid 参数并透传)
            const drawWithBlackBg = (forceSolid = false) => {
                drawCanvas(true, forceSolid); 
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0); 
                ctx.globalCompositeOperation = 'destination-over'; 
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvasW, canvasH);
                ctx.restore();
            };
            
            // --- 8. 开始渲染 ---
            
            if (mode === 'single') {
                appLog(`正在生成当前视图...`);
                // === 模式 A: 单页合成 (当前可视内容) ===
                overlay.textContent = "正在渲染视图...";
                await new Promise(r => setTimeout(r, 10));

                drawWithBlackBg(false);
                appLog(`-----------------------`);
                overlay.textContent = "正在生成 PDF...";
                await new Promise(r => setTimeout(r, 10));

                const imgData = mainCanvas.toDataURL('image/jpeg', 1.0);
                doc.addImage(imgData, 'JPEG', 0, 0, final_pdfW_in, final_pdfH_in);
            
            } else {
                // === 模式 B & C: 多页分页 (启用图层 或 全部图层) ===
                const total = targetLayers.length;
                
                for (let i = 0; i < total; i++) {
                    const file = targetLayers[i];
                    appLog(`正在生成 ${file.name}`); // 或者 appLog(`正在生成第 ${i+1} 层`);
                    const percent = Math.round(((i) / total) * 100);
                    overlay.textContent = `正在处理图层 ${percent}% (${i + 1}/${total})`;
                    await new Promise(r => setTimeout(r, 0));

                    // 1. 隔离显示当前图层
                    loadedFiles.forEach(f => f.visible = false);
                    file.visible = true;

                    // 2. 绘制：强制 100% 不透明 (传 true)
                    drawWithBlackBg(true);

                    // 3. 绘制水印标签 (黄色文字)
                    ctx.setTransform(1, 0, 0, 1, 0, 0); 
                    ctx.fillStyle = '#FFFF00'; 
                    ctx.font = `bold ${3 * pixelScale}px "Segoe UI", sans-serif`; 
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    const label = `[${i+1}] ${file.name}  (${layerIdMap[file.layerId] || 'Unknown Layer'})`;
                    ctx.fillText(label, 5 * pixelScale, 3 * pixelScale);

                    // 4. 添加到 PDF
                    const imgData = mainCanvas.toDataURL('image/jpeg', 1.0);
                    if (i > 0) doc.addPage([final_pdfW_in, final_pdfH_in]); 
                    doc.addImage(imgData, 'JPEG', 0, 0, final_pdfW_in, final_pdfH_in);
                }
            }
            
            overlay.textContent = "正在保存文件...";
            await new Promise(r => setTimeout(r, 10));
            
            // --- [修改] 文件名生成逻辑 ---
            let fileName = "";
            const timestamp = new Date().getTime();
            
            if (currentZipName) {
                // 如果是 ZIP 导入，使用：压缩包名_模式_时间戳.pdf
                fileName = `${currentZipName}_${mode}_${timestamp}.pdf`;
            } else {
                // 否则使用默认：Gerber_Export_模式_时间戳.pdf
                fileName = `Gerber_Export_${mode}_${timestamp}.pdf`;
            }

            // [新增] 结束计时日志
            const endTime = performance.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            appLog(`数据生成完毕，耗时${duration}秒`);

            doc.save(fileName);

        } catch (e) {
            console.error(e);
            appLog(`PDF生成失败: ${e.message}`);
            alert("导出 PDF 失败: " + e.message);
        } finally {
            // 9. 恢复现场 (非常重要)
            if (savedState) {
                // 恢复画布尺寸
                mainCanvas.width = savedState.w;
                mainCanvas.height = savedState.h;
                bufferCanvas.width = savedState.w;
                bufferCanvas.height = savedState.h;
                
                // 清除 CSS 样式
                mainCanvas.style.width = '';
                mainCanvas.style.height = '';
                mainCanvas.style.marginLeft = '';
                mainCanvas.style.marginTop = '';

                // 恢复视图参数
                viewState.scale = savedState.scale;
                viewState.offsetX = savedState.offsetX;
                viewState.offsetY = savedState.offsetY;
                
                // 恢复图层可见性
                loadedFiles.forEach((f, i) => f.visible = savedState.visibility[i]);
                
                // 重绘
                drawCanvas();
            }
            overlay.style.display = 'none';
        }
    };



    // --- 1.1 按钮：导出至当前 PCB 画布 (修改版) ---
    window.handleExportToCanvas = async (method) => {
        const env = getEnvInfo();
        const sourceType = document.getElementById('cfg-source-type').value;

        // if (!env.isEdaEnv) {
        //     alert("此功能仅在嘉立创 EDA 专业版客户端环境中可用。");
        //     return;
        // }

        // 如果是通过API导入，使用V2版本源码方便提取参数
        if(method === 'api'){
            env.clientVer = 'pro_v2';
        }

        const config = {
            mode: 'canvas',           // 模式：注入画布
            targetVer: env.clientVer, // 目标版本：跟随当前编辑器版本
            sourceType: sourceType,   // 来源
            tryNetlist: document.getElementById('cfg-netlist').checked, // 尝试生成网络
            importMethod: method      // [新增] 导入方式: 'source' 或 'api'
        };

        if (sourceType === 'easyedapro'){
            await exportForEasyEDA_Pro(config);
        } else {
            await exportForOther_Pro(config); 
        }
    };

    // --- 1.2 按钮：导出标准版文件 (下载逻辑) ---
    window.handleExportStandard = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'std',//标准版
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        await exportForStandard(config);
    };

    // --- 1.3 按钮：导出专业版 V2 文件 (下载逻辑) ---
    window.handleExportProV2 = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'pro_v2',//专业版V2
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        if (sourceType === 'easyedapro'){
            await exportForEasyEDA_Pro(config);
        }else{
            await exportForOther_Pro(config); 
        }
    };

    // --- 1.4 按钮：导出专业版 V3 文件 (下载逻辑) ---
    window.handleExportProV3 = async () => {
        const sourceType = document.getElementById('cfg-source-type').value;
        const config = {
            mode: 'file',//导出文件
            targetVer: 'pro_v3',//专业版V3
            sourceType: sourceType, //来源
            tryNetlist: document.getElementById('cfg-netlist').checked // 尝试生成网络
        };

        if (sourceType === 'easyedapro'){
            await exportForEasyEDA_Pro(config);
        }else{
            await exportForOther_Pro(config); 
        }
    };

    // --- [修改] 动态配置头文件函数 ---
    function configureHeader(source, isV3) {
        const copperCountEl = document.getElementById('cfg-copper-layers');
        const copperCount = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;
        const neededInner = Math.max(0, copperCount - 2);

        const getLyrIdx = (id) => {
            if (id === 1) return 1;
            if (id === 2) return copperCount; 
            if (id >= 15 && id <= 46) return (id - 15) + 2; 
            return null;
        };

        // 2. 提取埋盲孔规则
        const blindFiles = loadedFiles.filter(f => f.layerId === 502 && f.pairStart && f.pairEnd);
        const blindRules = [];
        const seenRules = new Set();

        blindFiles.forEach(f => {
            const sId = f.pairStart;
            const eId = f.pairEnd;
            const sIdx = getLyrIdx(sId);
            const eIdx = getLyrIdx(eId);

            if (sIdx !== null && eIdx !== null) {
                const startPhys = Math.min(sIdx, eIdx);
                const endPhys = Math.max(sIdx, eIdx);
                const startID = (sIdx < eIdx) ? sId : eId;
                const endID   = (sIdx < eIdx) ? eId : sId;
                const ruleName = `${startPhys}-${endPhys}`;
                const uniqueKey = `${startID}-${endID}`;

                if (!seenRules.has(uniqueKey)) {
                    seenRules.add(uniqueKey);
                    blindRules.push({ name: ruleName, start: startID, end: endID });
                }
            }
        });
        
        if (isV3) {
            console.log(`[V3 Config] 1. 盲埋孔规则准备就绪: ${blindRules.length} 条`, blindRules);
        }

        const lines = source.split('\n');
        
        const newLines = lines.map((line, lineIdx) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return line;

            // === V3 处理逻辑 ===
            if (isV3) {
                const parts = trimmedLine.split("||");
                if (parts.length < 2) return line;

                let meta, content;
                try {
                    meta = JSON.parse(parts[0]);
                    
                    // [修复] 更安全的去尾逻辑
                    let contentStr = parts[1];
                    // 去除末尾所有空白和竖线
                    contentStr = contentStr.trim();
                    if (contentStr.endsWith('|')) {
                        contentStr = contentStr.substring(0, contentStr.length - 1);
                    }
                    content = JSON.parse(contentStr);
                    
                } catch (e) {
                    // [调试] 如果解析失败，打印出来
                    console.error(`[V3 Config] 解析错误 (行 ${lineIdx}):`, e.message, line.substring(0, 50) + "...");
                    return line; 
                }

                let isModified = false;

                try {
                    // A. 修改图层启用状态
                    if (meta.type === "LAYER" && typeof content.layerId === 'number') {
                        if (content.layerId >= 15 && content.layerId <= 46) {
                            const innerIndex = content.layerId - 14; 
                            const isEnabled = innerIndex <= neededInner;
                            if (content.use !== isEnabled) {
                                content.use = isEnabled;
                                content.show = isEnabled;
                                isModified = true;
                            }
                        }
                    }

                    // B. 修改埋盲孔规则
                    if (meta.type === "RULE") {
                        const idStr = JSON.stringify(meta.id || "");
                        
                        // [调试] 打印遇到的每一个规则 ID，确认是否扫描到了 blindVia
                        // console.log(`[V3 Config] 扫描规则: ${idStr}`);

                        // 宽松匹配：ID包含 blind，或者内容里有 blinds 字段
                        const isBlindRule = idStr.toLowerCase().includes("blind") || (content.ruleContext && content.ruleContext.blinds);

                        if (isBlindRule) {
                            console.log(`[V3 Config] 2. 命中盲埋孔规则行! ID: ${idStr}`);
                            
                            const v3BlindContent = blindRules.map(r => ({
                                "name": r.name,
                                "staLayerId": r.start,
                                "endLayerId": r.end,
                                "viaSizeRule": ""
                            }));
                            
                            // 确保结构路径存在 (防御性编程)
                            if (!content.ruleContext) content.ruleContext = {};
                            if (!content.ruleContext.blinds) content.ruleContext.blinds = {};
                            
                            console.log(`[V3 Config] 3. 注入数据:`, JSON.stringify(v3BlindContent));
                            
                            content.ruleContext.blinds.content = v3BlindContent;
                            isModified = true;
                        }
                    }

                } catch (err) {
                    console.error(`[V3 Config] 逻辑处理异常 (行 ${lineIdx}):`, err);
                    return line; // 发生逻辑错误返回原行
                }

                if (isModified) {
                    // [调试] 确认修改
                    if (meta.type === "RULE") {
                        console.log(`[V3 Config] 4. 规则行修改成功，重新打包`);
                    }
                    return JSON.stringify(meta) + "||" + JSON.stringify(content) + "|";
                } else {
                    return line;
                }

            } else {
                // === V2 处理逻辑 (保持不变) ===
                let arr;
                try { arr = JSON.parse(line); } catch (e) { return line; }

                if (arr[0] === "LAYER" && typeof arr[1] === 'number') {
                    const id = arr[1];
                    if (id >= 15 && id <= 46) {
                        const innerIndex = id - 14;
                        const isEnabled = innerIndex <= neededInner;
                        arr[4] = isEnabled ? 3 : 0; 
                        return JSON.stringify(arr);
                    }
                }

                if (arr[0] === "RULE" && arr[2] === "blindVia") {
                    const v2BlindContent = blindRules.map(r => [r.name, r.start, r.end]);
                    arr[4] = v2BlindContent;
                    return JSON.stringify(arr);
                }
                return line;
            }
        });

        return newLines.join('\n');
    }

    // --- [新增] 通过 API 配置盲埋孔规则 ---
    async function configureBlindViasAPI() {
        // 1. 检查是否有需要配置的盲埋孔文件
        const blindFiles = loadedFiles.filter(f => f.layerId === 502 && f.pairStart && f.pairEnd);
        if (blindFiles.length === 0) return;

        appLog("正在检测设计规则配置...");

        try {
            // 2. 获取当前设计规则
            const currentConfigObj = await eda.pcb_Drc.getCurrentRuleConfiguration();
            
            if (!currentConfigObj || !currentConfigObj.config) {
                console.warn("无法获取设计规则配置");
                return;
            }

            // 定位到 Blind/Buried Via 节点
            // 路径: config -> Physics -> "Blind/Buried Via" -> blindVia -> table
            const physics = currentConfigObj.config.Physics;
            if (!physics || !physics["Blind/Buried Via"] || !physics["Blind/Buried Via"].blindVia) {
                console.warn("设计规则中未找到盲埋孔配置节点");
                return;
            }

            const targetNode = physics["Blind/Buried Via"].blindVia;
            
            // 3. 构建新的规则表
            // 获取总层数用于计算物理层名称 (如 "1-2")
            const copperCountEl = document.getElementById('cfg-copper-layers');
            const totalLayers = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;

            const getPhysIdx = (id) => {
                if (id === 1) return 1;
                if (id === 2) return totalLayers;
                if (id >= 15 && id <= 46) return (id - 15) + 2;
                return 0;
            };

            const newTable = [];
            const seenKeys = new Set();

            blindFiles.forEach((f, idx) => {
                const sId = f.pairStart;
                const eId = f.pairEnd;
                
                // 确保层 ID 有效
                if (!sId || !eId) return;

                // 简单的去重键
                const uniqueId = `${Math.min(sId, eId)}-${Math.max(sId, eId)}`;
                
                if (!seenKeys.has(uniqueId)) {
                    seenKeys.add(uniqueId);

                    // 计算物理层名称 (例如 "1-2")
                    const sPhys = getPhysIdx(sId);
                    const ePhys = getPhysIdx(eId);
                    const name = `${Math.min(sPhys, ePhys)}-${Math.max(sPhys, ePhys)}`;

                    // 构造符合 API 定义的对象
                    newTable.push({
                        "name": name,
                        "startLayer": sId, // API 需要 layerId
                        "endLayer": eId,   // API 需要 layerId
                        "used": true,      // 标记为使用
                        "key": `generated_blind_${Date.now()}_${idx}`, // 生成唯一 Key 防止冲突
                        "viaSizeRule": ""  // 默认无特定尺寸规则
                    });
                }
            });

            // 4. 应用修改
            // 策略：保留原有的规则？还是覆盖？
            // 考虑到这是导入操作，建议将新规则追加到现有规则中，或者如果完全确信是新板子则覆盖。
            // 这里采用：追加并去重（根据 name）
            
            const existingTable = targetNode.table || [];
            // 过滤掉名字冲突的旧规则，保留我们的新规则
            const mergedTable = [
                ...existingTable.filter(old => !newTable.some(nw => nw.name === old.name)),
                ...newTable
            ];

            targetNode.table = mergedTable;

            // 5. 保存配置
            const configName = currentConfigObj.name || "自定义配置";
            appLog(`正在更新盲埋孔规则 (${newTable.length} 组新增)...`);
            
            // 调用 saveRuleConfiguration
            // 参数3 allowOverwrite = true
            const success = await eda.pcb_Drc.saveRuleConfiguration(currentConfigObj, configName, true);
            
            if (success) {
                appLog("设计规则更新成功");
            } else {
                appLog("设计规则更新被拒绝");
            }

        } catch (e) {
            console.error("配置盲埋孔规则异常:", e);
            appLog(`配置规则失败: ${e.message}`);
        }
    }


    // 来源：嘉立创EDA -> 目标：专业版 (支持 V2 和 V3)
    async function exportForEasyEDA_Pro(config) {
        console.log("开始导出处理...", config);
        const startTime = performance.now(); // 开始计时
        
        const isV3 = config.targetVer === 'pro_v3';
        const separator = isV3 ? "|\n" : "\n"; // 提前定义分隔符
        
        // 1. 准备源码头 (移除 !DEBUG 判断，始终生成头文件)
        let rawTemplate = isV3 ? LCEDA_V3_Head_Source : LCEDA_V2_Head_Source;
        // 调用配置函数，动态修改图层和规则
        let finalSource = configureHeader(rawTemplate, isV3);
        
        // 仅在非Debug或Debug但未显示日志时记录，避免刷屏，但此处为了逻辑简单保留
        // appLog(`已根据设置动态更新文件头配置`);

        // 2. 提取数据
        // 仅导出勾选的图层
        const rawData = PadTool.extractRawData(loadedFiles.filter(f => f.visible));
        
        // 3. 聚合数据
        const unifiedData = PadTool.consolidate(
            rawData.rawPads || [], 
            rawData.rawVias || [], 
            rawData.rawTracks || [], 
            rawData.rawPolys || [], 
            rawData.rawFills || [], 
            rawData.drills || [],
            rawData.rawImages || [],
            rawData.rawTextLines || [],
            rawData.rawCoppers || []
        );
        
        // 4. 获取 ID 起始值
        const startIds = (typeof DEBUG !== 'undefined' && DEBUG) 
            ? { ticket: 200, id: 200 } 
            : calculateMaxId(finalSource, config.targetVer);

        // 5. 生成图元字符串 (这一步才真正决定了最终有多少个图元)
        const primitives = PadTool.generatePrimitives(unifiedData, {
            isV3: isV3,
            ticket: startIds.ticket || 10000,
            id: startIds.id || 10000
        }, config); 

        // --- 统计生成的图元数量 ---
        let stat_pads = 0;
        let stat_vias = 0;
        let stat_tracks = 0;
        let stat_polys = 0;
        let stat_fills = 0; 
        let stat_holes = 0;
        let stat_texts = 0;

        primitives.forEach(str => {
            if (isV3) {
                try {
                    const parts = str.split("||");
                    if(parts.length > 1) {
                        const meta = JSON.parse(parts[0]);
                        const content = JSON.parse(parts[1]);
                        const type = meta.type;
                        if (type === 'PAD') stat_pads++;
                        else if (type === 'VIA') stat_vias++;
                        else if (type === 'TRACK' || type === 'ARC' || type === 'LINE') stat_tracks++;
                        else if (type === 'STRING' || type === 'TEXT') stat_texts++;
                        else if (type === 'HOLE') stat_holes++;
                        else if (type === 'REGION' || type === 'FILL') {
                            if (content.fill || type === 'FILL') stat_fills++;
                            else stat_polys++;
                        } else if (type === 'POLY') stat_polys++;
                        else if (type === 'IMAGE') stat_fills++;
                    }
                } catch(e) {}
            } else {
                try {
                    const match = str.match(/^\["([A-Z_]+)"/);
                    if (match) {
                        const type = match[1];
                        if (type === 'PAD') stat_pads++;
                        else if (type === 'VIA') stat_vias++;
                        else if (type === 'LINE' || type === 'ARC') stat_tracks++;
                        else if (type === 'POLY') stat_polys++;
                        else if (type === 'FILL' || type === 'POURED' || type === 'IMAGE') stat_fills++;
                        else if (type === 'STRING') stat_texts++;
                        else if (type === 'HOLE') stat_holes++;
                    }
                } catch(e) {}
            }
        });

        // 输出日志
        appLog(`-----------------------`);
        appLog(`生成焊盘 ${stat_pads} 个`);
        appLog(`生成过孔 ${stat_vias} 个`);
        appLog(`生成导线 ${stat_tracks} 条`);
        appLog(`生成折线 ${stat_polys} 条`);
        appLog(`生成填充 ${stat_fills} 个`);
        appLog(`生成文本 ${stat_texts} 个`);

        // 6. 处理 DEBUG 输出 (修改点：拼接完整源码)
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            if (config.mode === 'debug') {
                 const textArea = document.getElementById('debug-source-area');
                 if(textArea) {
                     // 拼接：头文件 + 分隔符 + 图元
                     let debugFullSource = finalSource;
                     if (primitives.length > 0) {
                         debugFullSource += separator + primitives.join(separator);
                     }
                     textArea.value = debugFullSource;
                 }
                 // Debug 模式下生成完源码直接返回，不进行后续的文件下载或API写入
                 return;
            }
        }

        // 7. 正式输出拼接 (非 Debug 模式，或者 Debug 模式下的文件导出)
        if (primitives.length > 0) {
            // 注意：V3 格式如果直接拼接在头文件后，需要补一个分隔符
            if (isV3) finalSource += separator + primitives.join(separator);
            else finalSource += "\n" + primitives.join("\n");
        }

        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        appLog(`数据生成完毕，耗时${duration}秒`);

        // --- 文件导出逻辑：打包 ZIP ---
        if (config.mode === 'file') {
            const zip = new JSZip();
            const timestamp = new Date().getTime();
            const baseName = currentZipName || `${timestamp}`;
            const outputName = `Gerber_To_PCB_${baseName}`;

            if (isV3) {
                const projectConfig = {
                    "title": outputName,
                    "cbb_project": false,
                    "editorVersion": "",
                    "introduction": "",
                    "description": "",
                    "tags": "[]"
                };
                zip.file(`${outputName}.epru`, finalSource);
                zip.file("project2.json", JSON.stringify(projectConfig, null, 2));
                appLog("正在打包 V3 工程文件...");
                const content = await zip.generateAsync({type:"blob"});
                downloadBlobAsFile(content, `${outputName}.epro2`);
            } else {
                const uuid = generateUUID();
                const projectConfig = {
                    "schematics": {},
                    "pcbs": {}, 
                    "panels": {},
                    "symbols": {},
                    "footprints": {},
                    "devices": {},
                    "boards": {},
                    "config": {
                        "title": "PCB1",
                        "cbbProject": false,
                        "defaultSheet": "",
                        "editorVersion": "2.2.45.5"
                    }
                };
                projectConfig.pcbs[uuid] = "PCB1";
                zip.file("project.json", JSON.stringify(projectConfig, null, 2));
                const pcbFolder = zip.folder("PCB");
                pcbFolder.file(`${uuid}.epcb`, finalSource);
                appLog("正在打包 V2 工程文件...");
                const content = await zip.generateAsync({type:"blob"});
                downloadBlobAsFile(content, `${outputName}.epro`);
            }

        } else if (config.mode === 'canvas') {
            
            const writeStartTime = performance.now();
            try {
                // 1. 获取 UI 上设定的层数 (例如 2, 4, 6...)
                const copperCountEl = document.getElementById('cfg-copper-layers');
                const targetLayerCount = copperCountEl ? (parseInt(copperCountEl.value) || 2) : 2;
                // 2. 调用 API 设置层数
                const setLayerResult = await eda.pcb_Layer.setTheNumberOfCopperLayers(targetLayerCount);
                // console.log("层数设置结果:", setLayerResult);
                
                // 稍微等待一下，确保状态更新
                // await new Promise(r => setTimeout(r, 50));

                appLog(`正在将板子设为${targetLayerCount}层板`);
                
                if (typeof eda !== 'undefined') {
                    if (config.importMethod === 'api') {
                        appLog(`写入画布中 (图元模式)...`);
                        // 在导入图元之前，先配置设计规则
                        // await configureBlindViasAPI(); // 当前保存设计规划失败，未知原因
                        await importPrimitivesAPI(primitives, isV3);
                        
                        const writeEndTime = performance.now();
                        const writeDuration = ((writeEndTime - writeStartTime) / 1000).toFixed(2);
                        appLog(`参数传递完成，耗时${writeDuration}秒`);
                        appLog(`全部参数已传递至EDA，待EDA绘制完成`);
                    } else {
                        appLog(`正在写入全量数据...`);
                        const result = await eda.sys_FileManager.setDocumentSource(finalSource);
                        const writeEndTime = performance.now();
                        const writeDuration = ((writeEndTime - writeStartTime) / 1000).toFixed(2);
                        if (result) appLog(`写入完成，耗时${writeDuration}秒`);
                        else appLog(`写入失败 (API返回false)`);
                    }
                }
            } catch (e) {
                console.error(e);
                appLog(`写入过程出错: ${e.message}`);
            }
        }
    }

    // 来源：其他 -> 目标：专业版 (支持 V2 和 V3) (保留入口)
    async function exportForOther_Pro(config) {
        // 待完善
    }

    // importPrimitivesAPI (API 写入)。
    async function importPrimitivesAPI(primitivesArr, isV3) {
        // console.log("准备通过 API 导入图元...", primitivesArr.length);
        const separator = "\n"; // 提前定义分隔符
        const textArea = document.getElementById('debug-source-area');
        let FullSource = '';
        if (primitivesArr.length > 0) {
            FullSource += separator + primitivesArr.join(separator);
        }

        // 逐行处理
        const lines = FullSource.trim().split('\n').map(line => JSON.parse(line));
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const command = line[0];
            switch (command) {
                case 'PAD': // 焊盘
                    try {
                        let holeDef = line[9];
                        if (Array.isArray(holeDef) && holeDef.length >= 3 && holeDef[0] === "SLOT") {
                            const w = holeDef[1];
                            const h = holeDef[2];
                            holeDef = ["SLOT", h, w]; // 交换 直接 长度
                        }
                        eda.pcb_PrimitivePad.create(
                            line[4],                          // layer: 层编号
                            line[5]?.toString() || "",        // padNumber: 焊盘编号，转为字符串
                            line[6],                          // x: X坐标
                            line[7],                          // y: Y坐标
                            line[8] || 0,                     // rotation: 旋转角度
                            line[10] || null,                 // pad: 默认焊盘形状
                            line[3] || "",                    // net: 网络名称
                            holeDef || null,                  // [修改] 使用处理过的 holeDef
                            line[12] || 0,                    // holeOffsetX: 孔偏移X
                            line[13] || 0,                    // holeOffsetY: 孔偏移Y
                            line[14] || 0,                    // holeRotation: 孔旋转角度
                            !!line[15],                       // metallization: 是否金属化
                            line[16] || 0,                    // padType: 焊盘类型
                            line[11] || [],                   // specialPad: 特殊焊盘
                            // 阻焊和助焊扩展
                            (line[17] !== null || line[18] !== null || line[19] !== null || line[20] !== null) ? {
                                "topSolderMask": line[17],
                                "bottomSolderMask": line[18],
                                "topPasteMask": line[19],
                                "bottomPasteMask": line[20]
                            } : null,
                            // 热焊设置
                            (line[21] !== null || line[22] !== null || line[23] !== null || line[24] !== null) ? {
                                "connectionType": line[21],
                                "divergenceSpacing": line[22],
                                "divergenceLineWidth": line[23],
                                "divergenceAngle": line[24]
                            } : null,
                            !!line[25]                        // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建PAD失败:', error);
                    }
                    break;
                case 'VIA': // 过孔
                    try {
                        eda.pcb_PrimitiveVia.create(
                            line[3],               // NET名称
                            line[5],               // X坐标
                            line[6],               // Y坐标
                            line[7],               // 孔直径
                            line[8],               // 焊盘直径
                            line[9] || 0,          // 过孔类型，默认普通过孔
                            line[4] || null,       // 设计规则名称（盲埋孔类型）
                            line[10] === null && line[11] === null ? null : { // 阻焊扩展
                                "topSolderMask": line[10],
                                "bottomSolderMask": line[11]
                            },
                            !!line[12]             // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建VIA失败:', error);
                    }
                    break;
                case 'LINE': // 直线
                    try {
                        eda.pcb_PrimitiveLine.create(
                            line[3] || "",    // 网络名称
                            line[4],          // 层编号
                            line[5],          // 开始X坐标
                            line[6],          // 开始Y坐标
                            line[7],          // 结束X坐标
                            line[8],          // 结束Y坐标
                            line[9],          // 线宽
                            !!line[10]        // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建LINE失败:', error);
                    }
                    break;
                case 'ARC': // 弧线
                    try {
                        eda.pcb_PrimitiveArc.create(
                            line[3] || "",    // 网络名称
                            line[4],          // 层编号
                            line[5],          // 起始X坐标
                            line[6],          // 起始Y坐标
                            line[7],          // 结束X坐标
                            line[8],          // 结束Y坐标
                            line[9],          // 圆弧角度
                            line[10],         // 线宽，默认0.5
                            "1",              // 交互模式，固定为"1"（两点圆弧）
                            !!line[11]        // 是否锁定
                        );
                    } catch (error) {
                        console.error('创建ARC失败:', error);
                    }
                    break;
                    
                case 'POLY': // 折线
                    try {
                        // 创建多边形对象，第6项是多边形数据
                        const polygon = eda.pcb_MathPolygon.createPolygon(line[6]);
                        
                        // 调用折线API创建折线图元
                        eda.pcb_PrimitivePolyline.create(
                            line[3] || "",                    // net: 网络名称
                            line[4] || 1,                     // layer: 层编号
                            polygon,                          // polygon: 多边形对象
                            line[5] || 0.5,                   // lineWidth: 线宽
                            !!line[7]                         // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建POLY失败:', error);
                    }
                    break;
                case 'FILL': // 填充
                    try {
                        // 创建多边形对象，第7项是多边形数据数组
                        const polygon = eda.pcb_MathPolygon.createPolygon(line[7]);
                        
                        // 调用填充API创建填充图元
                        eda.pcb_PrimitiveFill.create(
                            line[4],                          // layer: 层编号
                            polygon,                          // complexPolygon: 多边形对象
                            line[3] || "",                    // net: 网络名称
                            line[6] || 0,                     // fillMode: 填充模式
                            line[5] || 0.2,                   // lineWidth: 线宽（网格填充时有效）
                            !!line[8]                         // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建FILL失败:', error);
                    }
                    break;
                case 'IMAGE': // 图片
                    try {
                        // 创建多边形对象，第10项是多边形数据数组
                        const complexPolygon = eda.pcb_MathPolygon.createPolygon(line[10]);
                        
                        // 调用图片API创建图片图元
                        eda.pcb_PrimitiveImage.create(
                            line[4],                          // x: 左上角X坐标
                            line[5],                          // y: 左上角Y坐标
                            complexPolygon,                   // complexPolygon: 多边形对象
                            line[3] || 1,                     // layer: 层编号
                            line[6],                          // width: 宽度
                            line[7],                          // height: 高度
                            line[8] || 0,                     // rotation: 旋转角度
                            !!line[9],                        // horizonMirror: 是否水平镜像
                            !!line[11]                        // primitiveLock: 是否锁定
                        );
                    } catch (error) {
                        console.error('创建IMAGE失败:', error);
                    }
                    break;
                case 'STRING': // 文字
                    try {             
                        // 调用文字API创建文字图元
                        eda.pcb_PrimitiveString.create(
                            line[3] || 1,                 // layer: 层
                            line[4],                      // x: 位置 X
                            line[5],                      // y: 位置 Y
                            line[6] || "",                // text: 内容
                            line[7] || "default2",        // fontFamily: 字体名称
                            line[8],                      // fontSize: 字号
                            line[9],                      // lineWidth: 粗细
                            line[12] || 1,                // alignMode: 对齐模式 (索引13，跳过加粗/斜体)
                            line[13] || 0,                // rotation: 旋转角度
                            !!line[14],                   // reverse: 是否反相扩展 (转为Boolean)
                            line[15] || 0,                // expansion: 反相扩展尺寸
                            !!line[16],                   // mirror: 是否镜像 (转为Boolean)
                            !!line[17]                    // primitiveLock: 是否锁定 (转为Boolean)
                        );
                    } catch (error) {
                        console.error('创建STRING失败:', error);
                    }
                    break;
                default:
                    console.warn(`未知命令: ${command}，数据:`, line.slice(0, 3).concat('...'));
                    break;
            }
        }
    }

    // 目标：标准版 (保留入口)
    async function exportForStandard(config) {
        // 待完善
        alert('待后续更新');
    }

    // --- [新增] 手动生成 DEBUG 源码 ---
    window.generateDebugSource = async () => {
        if (loadedFiles.length === 0) {
            alert("请先导入 Gerber 文件");
            return;
        }

        const btn = document.querySelector('button[onclick="generateDebugSource()"]');
        const oldText = btn.textContent;
        btn.textContent = "生成中...";

        // 构造配置：指定生成 V3 版本，且模式为 debug (输出到文本框不下载)
        const config = {
            mode: 'debug',           // 关键：输出到文本框
            targetVer: 'pro_v3',     // 关键：强制生成 V3 版本
            sourceType: document.getElementById('cfg-source-type').value,
            tryNetlist: document.getElementById('cfg-netlist').checked
        };

        try {
            // 调用现有的导出逻辑
            await exportForEasyEDA_Pro(config);
            
            // 按钮反馈
            btn.textContent = "已完成";
        } catch (e) {
            console.error(e);
            btn.textContent = "失败";
        }

        setTimeout(() => btn.textContent = oldText, 1000);
    };

