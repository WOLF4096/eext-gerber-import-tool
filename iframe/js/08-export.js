// ====================================================================================
// 08-export.js  —  导出控制器
// ------------------------------------------------------------------------------------
// 职责：全部导出入口与实现。
//   · window.exportPDF            位图 PDF 导出（DPI 300/600/900/1200）
//   · window.handleExportToCanvas 注入当前 PCB 画布（源码注入 / 图元注入）
//   · window.handleExportProV2 / handleExportProV3   导出工程文件（.epcb / .epro2）
//   · window.handleExportStandard 导出标准版（生成嘉立创EDA标准版 PCB 源码 .json）
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
    // ====================================================================================
    // 写入画布前的安全检查：确认当前文档是空白 PCB
    // ------------------------------------------------------------------------------------
    // 本工具通过 eda.sys_FileManager.setDocumentSource() 整体替换当前文档源码，
    // 若文档中已有设计数据，这些数据会被覆盖且难以恢复。
    // 免责声明里写了「务必在空白 PCB 文档中使用」，但那只能靠用户自觉；
    // 这里补一道程序化校验：读取当前文档源码，统计其中的图元记录数，非空则强提示。
    // 任何一步失败都放行（不拦路）—— 免责声明已经提示过，这里只是多一层保险，
    // 不能因为它自身异常而让本来可用的功能失效。
    // ====================================================================================

    // 文档源码中「图元」记录的类型白名单（DOCHEAD / LAYER / RULE 等属于元信息，不计入）
    const PRIMITIVE_SOURCE_TYPES = new Set([
        'PAD', 'VIA', 'TRACK', 'ARC', 'LINE', 'POLY', 'POLYLINE', 'FILL', 'REGION',
        'POUR', 'POURED', 'STRING', 'TEXT', 'HOLE', 'IMAGE', 'DIMENSION', 'COMPONENT', 'OBJECT'
    ]);

    /**
     * 统计文档源码里已有多少个图元记录。
     * 兼容 V3（每行 {"type":"XXX",...}||{...}）与 V2（每行 ["XXX",...]）两种行格式。
     * 采用「白名单」而非「黑名单」：识别不出的类型一律不算图元，
     * 最坏情况只是少提示一次，不会误报。
     *
     * @param source - 文档源码
     * @returns 图元记录数量
     */
    function countPrimitivesInDocumentSource(source) {
        if (!source) return 0;
        let count = 0;
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            let type = null;
            if (line.charAt(0) === '{') {
                const end = line.indexOf('}');
                if (end > 0) {
                    const m = /"type"\s*:\s*"([A-Za-z_]+)"/.exec(line.slice(0, end + 1));
                    if (m) type = m[1].toUpperCase();
                }
            } else if (line.charAt(0) === '[') {
                const m = /^\[\s*"([A-Za-z_]+)"/.exec(line);
                if (m) type = m[1].toUpperCase();
            }
            if (type && PRIMITIVE_SOURCE_TYPES.has(type)) count++;
        }
        return count;
    }

    /**
     * 弹出「当前文档非空」的确认框。
     * 优先使用 EDA 原生确认框 SYS_Dialog.showConfirmationMessage，退回浏览器 confirm。
     *
     * @param count - 检测到的图元数量
     * @returns 用户是否选择继续
     */
    function askOverwriteConfirm(count) {
        const content =
            '⚠️ 当前 PCB 文档中已存在 ' + count + ' 个图元。\n\n' +
            '继续导入会替换当前文档的源码，原有图元可能丢失，且无法撤销。\n\n' +
            '强烈建议：先新建一个空白 PCB 文档，或先备份并关闭当前文档，再重新导入。\n\n' +
            '确定要继续吗？';

        if (typeof eda !== 'undefined' && eda.sys_Dialog &&
            typeof eda.sys_Dialog.showConfirmationMessage === 'function') {
            return new Promise((resolve) => {
                let settled = false;
                const done = (v) => { if (!settled) { settled = true; resolve(v); } };
                try {
                    eda.sys_Dialog.showConfirmationMessage(
                        content, '数据覆盖警告', '仍然继续', '取消', (ok) => done(!!ok)
                    );
                    // 兜底：万一对话框被关闭而回调未触发，避免流程永久挂起
                    setTimeout(() => done(false), 5 * 60 * 1000);
                } catch (e) {
                    done(false);
                }
            });
        }
        return Promise.resolve(window.confirm(content));
    }

    /**
     * 写入画布前的守卫：当前文档为空（或无法判断）时返回 true 放行。
     *
     * @returns 是否可以继续写入
     */
    async function confirmIfDocumentNotEmpty() {
        try {
            if (typeof eda === 'undefined' || !eda.sys_FileManager ||
                typeof eda.sys_FileManager.getDocumentSource !== 'function') {
                return true; // 非 EDA 环境（例如直接用浏览器打开）无法检查
            }
            const source = await eda.sys_FileManager.getDocumentSource();
            if (!source) return true; // 当前未打开文档，或读取失败

            const n = countPrimitivesInDocumentSource(source);
            if (n <= 0) return true;  // 文档是空的，直接放行

            appLog('检测到当前文档已有 ' + n + ' 个图元，已弹出覆盖确认');
            return await askOverwriteConfirm(n);
        } catch (e) {
            appLog('空文档校验已跳过：' + (e && e.message ? e.message : e));
            return true;
        }
    }

    /**
     * 按当前「处理模式」把导出请求路由到对应后端。
     * 处理模式只决定「怎么解析输入 Gerber、怎么定层」，输出统一走
     * 嘉立创专业版的源码 / 图元生成流程（exportTarget === 'jlc'）。
     * 选中的模式尚未实现时给出明确提示，而不是静默什么都不做。
     *
     * @param config - 导出配置
     */
    async function routeExport(config) {
        const processor = processorRegistry.current();
        if (!processor.ready) {
            const msg = `处理模式「${processor.label}」尚未实现，暂时无法导出。\n请在「处理模式」下拉中改用已实现的模式（嘉立创专业版 / RS-274X）。`;
            appLog(msg.replace(/\n/g, ' '));
            alert(msg);
            return;
        }
        if (processor.exportTarget === 'other') {
            await exportForOther_Pro(config);
            return;
        }
        await exportForEasyEDA_Pro(config);
    }

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

        // --- [数据安全] 写入画布前，校验当前文档是否已有设计数据 ---
        if (!(await confirmIfDocumentNotEmpty())) {
            appLog('已取消导入：当前文档非空，用户选择不覆盖。');
            return;
        }

        // 按当前处理模式路由到对应导出后端
        await routeExport(config);
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

        // 按当前处理模式路由到对应导出后端
        await routeExport(config);
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

        // 按当前处理模式路由到对应导出后端
        await routeExport(config);
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

        // 逐行处理：单行 JSON 解析失败不能中断整批导入（否则一个坏图元就全批失败）
        const rawLines = FullSource.trim().split('\n').filter(line => line.trim());
        const lines = [];
        let skippedLines = 0;
        for (const raw of rawLines) {
            try { lines.push(JSON.parse(raw)); } catch (e) { skippedLines++; }
        }
        if (skippedLines > 0) appLog(`图元模式：${skippedLines} 行无法解析，已跳过`);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const command = Array.isArray(line) ? line[0] : (line && line.type);
            switch (command) {
                case 'PAD': // 焊盘
                    try {
                        let holeDef = line[9];
                        // 官方孔类型只有 ROUND(长圆形) / RECT；历史数据里的 "SLOT" 一并归一到 ROUND，
                        // 并统一按 (短边, 长边) 排序，避免长短边颠倒。
                        if (Array.isArray(holeDef) && holeDef.length >= 3 && (holeDef[0] === "SLOT" || holeDef[0] === "ROUND")) {
                            const hw = holeDef[1];
                            const hh = holeDef[2];
                            holeDef = ["ROUND", Math.min(hw, hh), Math.max(hw, hh)];
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
                        // 同上：兼容平铺 / 嵌套两种源数组
                        const polySrc = line[6];
                        const polygon = (Array.isArray(polySrc) && Array.isArray(polySrc[0]))
                            ? eda.pcb_MathPolygon.createComplexPolygon(polySrc)
                            : eda.pcb_MathPolygon.createPolygon(polySrc);
                        if (!polygon) throw new Error('折线多边形数据不合法');
                        
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
                        // createPolygon 只接受「平铺」源数组；FILL 的 path 是 [[...]] 嵌套，
                        // 直接喂给 createPolygon 会得到 undefined → 填充静默创建失败。
                        const fillSrc = line[7];
                        const polygon = (Array.isArray(fillSrc) && Array.isArray(fillSrc[0]))
                            ? eda.pcb_MathPolygon.createComplexPolygon(fillSrc)
                            : eda.pcb_MathPolygon.createPolygon(fillSrc);
                        if (!polygon) throw new Error('填充多边形数据不合法');
                        
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

    // ==================================================================================
    // 目标：嘉立创EDA 标准版 —— 导出 PCB 源码（.json）
    // ----------------------------------------------------------------------------------
    // 格式规范取自 Temp/标准版格式参考/标准版PCB源码.json（嘉立创EDA标准版 v6.5.51 导出）。
    // 三条硬约束（错一条标准版就打不开/解析错位）：
    //   1. 全部坐标、长度以「1 单位 = 10 mil = 0.254 mm」存储；
    //   2. 世界坐标 → 画布坐标： X = ORIGIN_X + mmX / 0.254 ， Y = ORIGIN_Y - mmY / 0.254
    //      （X 向右为正，Y 向上为正，与参考文件的正负号一致）；
    //   3. shape 是字符串数组，首字段是图元标识符，字段顺序必须与官方文档一致。
    // 各图元字段顺序（0 基）：
    //   PAD        shape,x,y,w,h,layer,net,num,holeR,points,rot,gId,holeLength,slotPts,
    //              plated,locked,pasteExp,solderExp,holeCenter
    //   VIA        x,y,diameter,net,holeR,gId,locked
    //   HOLE       x,y,holeR,gId,locked
    //   TRACK      strokeWidth,layer,net,points,gId,locked
    //   ARC        strokeWidth,layer,net,d,helperDots,gId,locked
    //   CIRCLE     cx,cy,r,strokeWidth,layer,gId,locked,net,transformArc
    //   SOLIDREGION layer,'',pathStr,fillStyle,gId,'','','',locked
    // 注：所有区域类图元（含覆铜）统一用 SOLIDREGION 承载，不再输出 COPPERAREA
    //     —— 后者需要「铺铜压缩数据 + 网络」附属信息，SOLIDREGION 才是纯几何、
    //     打开即见实心铜，也避免标准版自己去重建铺铜时的各种边界问题。
    // ==================================================================================

    const STD_UNIT = 0.254;          // 1 标准版单位 = 10 mil
    const STD_ORIGIN_X = 4020;       // 画布原点（与官方模板一致）
    const STD_ORIGIN_Y = 3560.5;
    const STD_EDITOR_VER = '6.5.51';

    // 内部图层 ID → 标准版图层 ID（顺序不同！阻焊/锡膏、组装/文档都要换位）
    const STD_LAYER_MAP = {
        1: 1,    // 顶层铜   → TopLayer
        2: 2,    // 底层铜   → BottomLayer
        3: 3,    // 顶层丝印 → TopSilkLayer
        4: 4,    // 底层丝印 → BottomSilkLayer
        5: 7,    // 顶层阻焊 → TopSolderMaskLayer
        6: 8,    // 底层阻焊 → BottomSolderMaskLayer
        7: 5,    // 顶层锡膏 → TopPasteMaskLayer
        8: 6,    // 底层锡膏 → BottomPasteMaskLayer
        9: 13,   // 顶层装配 → TopAssembly
        10: 14,  // 底层装配 → BottomAssembly
        11: 10,  // 板框     → BoardOutLine
        12: 11,  // 多层     → Multi-Layer
        13: 12,  // 文档     → Document
        14: 15,  // 机械     → Mechanical
        47: 11,  // 钻孔     → Multi-Layer
        56: 12,  // 钻孔图   → Document
        57: 12   // 其它     → Document
    };
    const STD_LAYER = (internalId) => {
        if (STD_LAYER_MAP[internalId] !== undefined) return STD_LAYER_MAP[internalId];
        if (internalId >= 15 && internalId <= 46) return internalId + 6;  // Inner1(15) → 21
        return 12;
    };
    const STD_IS_COPPER = (internalId) => internalId === 1 || internalId === 2 || (internalId >= 15 && internalId <= 46);

    // 标准版图层表 / 对象表 / 设计规则（照抄参考文件，保证与官方模板一致）
    const STD_LAYERS = [
        '1~TopLayer~#FF0000~true~false~true~',
        '2~BottomLayer~#0000FF~true~false~true~',
        '3~TopSilkLayer~#FFCC00~true~false~true~',
        '4~BottomSilkLayer~#66CC33~true~false~true~',
        '5~TopPasteMaskLayer~#808080~true~false~true~',
        '6~BottomPasteMaskLayer~#800000~true~false~true~',
        '7~TopSolderMaskLayer~#800080~true~false~true~0.3',
        '8~BottomSolderMaskLayer~#AA00FF~true~false~true~0.3',
        '9~Ratlines~#6464FF~true~true~true~',
        '10~BoardOutLine~#FF00FF~true~false~true~',
        '11~Multi-Layer~#C0C0C0~true~false~true~',
        '12~Document~#FFFFFF~true~false~true~',
        '13~TopAssembly~#33CC99~false~false~false~',
        '14~BottomAssembly~#5555FF~false~false~false~',
        '15~Mechanical~#F022F0~false~false~false~',
        '19~3DModel~#66CCFF~false~false~false~',
        '21~Inner1~#999966~false~false~false~~',
        '22~Inner2~#008000~false~false~false~~',
        '23~Inner3~#00FF00~false~false~false~~',
        '24~Inner4~#BC8E00~false~false~false~~',
        '25~Inner5~#70DBFA~false~false~false~~',
        '26~Inner6~#00CC66~false~false~false~~',
        '27~Inner7~#9966FF~false~false~false~~',
        '28~Inner8~#800080~false~false~false~~',
        '29~Inner9~#008080~false~false~false~~',
        '30~Inner10~#15935F~false~false~false~~',
        '31~Inner11~#000080~false~false~false~~',
        '32~Inner12~#00B400~false~false~false~~',
        '33~Inner13~#2E4756~false~false~false~~',
        '34~Inner14~#99842F~false~false~false~~',
        '35~Inner15~#FFFFAA~false~false~false~~',
        '36~Inner16~#99842F~false~false~false~~',
        '37~Inner17~#2E4756~false~false~false~~',
        '38~Inner18~#3535FF~false~false~false~~',
        '39~Inner19~#8000BC~false~false~false~~',
        '40~Inner20~#43AE5F~false~false~false~~',
        '41~Inner21~#C3ECCE~false~false~false~~',
        '42~Inner22~#728978~false~false~false~~',
        '43~Inner23~#39503F~false~false~false~~',
        '44~Inner24~#0C715D~false~false~false~~',
        '45~Inner25~#5A8A80~false~false~false~~',
        '46~Inner26~#2B937E~false~false~false~~',
        '47~Inner27~#23999D~false~false~false~~',
        '48~Inner28~#45B4E3~false~false~false~~',
        '49~Inner29~#215DA1~false~false~false~~',
        '50~Inner30~#4564D7~false~false~false~~',
        '51~Inner31~#6969E9~false~false~false~~',
        '52~Inner32~#9069E9~false~false~false~~',
        '99~ComponentShapeLayer~#00CCCC~false~false~false~0.4',
        '100~LeadShapeLayer~#CC9999~false~false~false~',
        '101~ComponentMarkingLayer~#66FFCC~false~false~false~',
        'Hole~Hole~#222222~~false~true~',
        'DRCError~DRCError~#FAD609~~false~true~'
    ];
    const STD_OBJECTS = [
        'All~true~false', 'Component~true~true', 'Prefix~true~true', 'Name~true~false',
        'Track~true~true', 'Pad~true~true', 'Via~true~true', 'Hole~true~true',
        'Copper_Area~true~true', 'Circle~true~true', 'Arc~true~true',
        'Solid_Region~true~true', 'Text~true~true', 'Image~true~true', 'Rect~true~true',
        'Dimension~true~true', 'Protractor~true~true'
    ];
    const STD_DRCRULE = {
        "Default": { "trackWidth": 1, "clearance": 0.6, "viaHoleDiameter": 2.4, "viaHoleD": 1.2 },
        "isRealtime": false,
        "isDrcOnRoutingOrPlaceVia": false,
        "checkObjectToCopperarea": true,
        "showDRCRangeLine": true
    };
    const STD_CANVAS = 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45ARC~~0.5~4020~3560.5~0~yes';

    // 数字格式化：最多 4 位小数，去掉无意义的尾随 0（标准版源码里 1.5000 写作 1.5）
    function stdNum(v) {
        if (typeof v !== 'number' || !isFinite(v)) return '0';
        let s = (Math.round(v * 1e4) / 1e4).toFixed(4);
        if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        if (s === '' || s === '-0') return '0';
        return s;
    }
    const stdX = (mm) => stdNum(STD_ORIGIN_X + mm / STD_UNIT);
    const stdY = (mm) => stdNum(STD_ORIGIN_Y - mm / STD_UNIT);
    const stdU = (mm) => stdNum(mm / STD_UNIT);

    /**
     * 把内部路径数组（M/L/A/ARC + i,j/sweep/cx,cy 三种弧表示）统一转成折线点列（mm）。
     * 标准版的 TRACK / SOLIDREGION 都只吃点列，圆弧一律采样成短直线。
     */
    function stdFlattenPath(path, stepDeg) {
        const pts = [];
        if (!Array.isArray(path) || path.length === 0) return pts;
        let cur = null;
        const push = (x, y) => { if (typeof x === 'number' && isFinite(x) && typeof y === 'number' && isFinite(y)) { pts.push({ x, y }); cur = { x, y }; } };
        for (let i = 0; i < path.length; i++) {
            const op = path[i];
            if (!op) continue;
            if (op.cmd === 'M' || op.cmd === 'L') { push(op.x, op.y); continue; }
            if (op.cmd !== 'A' && op.cmd !== 'ARC') { continue; }
            if (!cur) continue;
            const ex = op.x, ey = op.y;
            // 1) 直接给了圆心
            let cx = op.cx, cy = op.cy;
            // 2) 给了相对圆心的 i/j
            if (cx === undefined && op.i !== undefined) { cx = cur.x + op.i; cy = cur.y + op.j; }
            // 3) 只给了扫掠角：由弦长 + 扫掠角反算圆心
            let sweepRad = null;
            if (op.sweep !== undefined) sweepRad = op.sweep * Math.PI / 180;
            if (cx === undefined && sweepRad !== null && Math.abs(sweepRad) > 1e-9) {
                const chord = Math.hypot(ex - cur.x, ey - cur.y);
                const r = Math.abs(chord / (2 * Math.sin(sweepRad / 2)));
                const mx = (cur.x + ex) / 2, my = (cur.y + ey) / 2;
                const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
                const ux = (ex - cur.x) / (chord || 1), uy = (ey - cur.y) / (chord || 1);
                const sgn = sweepRad > 0 ? 1 : -1;
                cx = mx + sgn * h * (-uy); cy = my + sgn * h * ux;
            }
            if (cx === undefined || !isFinite(cx) || !isFinite(cy)) {
                // 圆心未知（含 360° 整圆）：退化为两点直线，至少不丢这一段
                if (Math.abs(ex - cur.x) > 1e-9 || Math.abs(ey - cur.y) > 1e-9) push(ex, ey);
                continue;
            }
            const r = Math.hypot(cur.x - cx, cur.y - cy);
            if (!(r > 1e-9)) { push(ex, ey); continue; }
            let a0 = Math.atan2(cur.y - cy, cur.x - cx);
            let a1 = Math.atan2(ey - cy, ex - cx);
            let d = a1 - a0;
            const ccw = (op.mode === 3) || (sweepRad !== null && sweepRad > 0);
            if (ccw) { while (d <= 1e-9) d += 2 * Math.PI; } else { while (d >= -1e-9) d -= 2 * Math.PI; }
            const isFull = Math.abs(ex - cur.x) < 1e-6 && Math.abs(ey - cur.y) < 1e-6;
            if (isFull) d = ccw ? 2 * Math.PI : -2 * Math.PI;
            const step = (stepDeg || 6) * Math.PI / 180;
            const n = Math.max(2, Math.ceil(Math.abs(d) / step));
            for (let k = 1; k <= n; k++) {
                const a = a0 + d * k / n;
                push(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
        }
        return pts;
    }

    /** 点列 → 标准版路径串 "M x y L x y ... [Z]" */
    function stdPathStr(pts, closed) {
        if (!pts || pts.length === 0) return '';
        let s = 'M ' + stdX(pts[0].x) + ' ' + stdY(pts[0].y);
        for (let i = 1; i < pts.length; i++) s += ' L' + stdX(pts[i].x) + ',' + stdY(pts[i].y);
        if (closed) s += ' Z ';
        return s;
    }

    /** 点列 → 标准版 points 串 "x y x y ..."（TRACK 用） */
    function stdPointStr(pts) {
        return pts.map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
    }

    /**
     * 生成一个 SOLIDREGION 图元串（10 字段，与官方导出的字段布局逐位对齐）：
     * cmdKey, layer, '', pathStr, fillStyle, gId, '', '', '', locked
     * 所有区域类图元（含覆铜）统一用它承载 —— 标准版对 SOLIDREGION 的解析最稳，
     * 不需要 COPPERAREA 那套「压缩数据 + 网络」附属信息，打开即见实心铜。
     */
    function stdSolidRegion(layer, pathStr, gid) {
        return ['SOLIDREGION', layer, '', pathStr, 'solid', gid, '', '', '', 0].join('~');
    }

    /**
     * 生成标准版 PCB 源码对象。
     * @returns {object} 可直接 JSON.stringify 的标准版 PCB 源码
     */
    function buildStandardSource() {
        const rawData = PadTool.extractRawData(loadedFiles.filter(f => f.visible));
        const uni = PadTool.consolidate(
            rawData.rawPads || [], rawData.rawVias || [], rawData.rawTracks || [],
            rawData.rawPolys || [], rawData.rawFills || [], rawData.drills || [],
            rawData.rawImages || [], rawData.rawTextLines || [], rawData.rawCoppers || []
        );

        const shapes = [];
        let gidSeq = 1000;
        const nextGid = () => 'gge' + (++gidSeq);
        // 包围盒（标准版坐标）
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
        const grow = (xs, ys) => {
            const x = Number(xs), y = Number(ys);
            if (!isFinite(x) || !isFinite(y)) return;
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
            if (y < by0) by0 = y; if (y > by1) by1 = y;
        };

        // ---------- 飞针测试数据（FlyingProbeTesting.json）----------
        // 压缩包里带飞针文件时，用它给焊盘补上「焊盘编号」(PAD 的第 9 个字段)。
        // 索引与两级匹配算法与画布标注完全共用（06-utils.js 的 buildFlyingPinIndex /
        // flyingPinAt / padMatchBoxMM），保证「画布上看到的编号」＝「导出写进去的编号」。
        const flyingIndex = buildFlyingPinIndex(typeof flyingProbeData !== 'undefined' ? flyingProbeData : null);
        if (flyingIndex.pins.length) {
            appLog(`标准版导出：已读取飞针文件，共 ${flyingIndex.pins.length} 个引脚用于匹配焊盘编号`);
        }

        // ---------- 1. 焊盘 ----------
        (uni.unifiedPads || []).forEach(pad => {
            const prim = pad.top || pad.bottom || pad.innerRep || (pad.inners && pad.inners[0]);
            if (!prim) return;
            const hasDrill = !!pad.drill;
            // 通孔 → 多层(11)；表贴 → 顶层(1) / 底层(2)
            const layer = hasDrill ? 11
                : (pad.top ? 1 : (pad.bottom ? 2 : STD_LAYER(prim.layerId)));

            let w = prim.w, h = prim.h;
            if (prim.shape === 'POLYGON') {
                // 多边形焊盘的 w/h 恒为 0，尺寸取自路径包围盒（匹配用的包围盒统一走 padMatchBoxMM）
                const poly = stdFlattenPath(prim.path, 6);
                if (poly.length < 3) return;
                let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
                poly.forEach(p => { lx0 = Math.min(lx0, p.x); lx1 = Math.max(lx1, p.x); ly0 = Math.min(ly0, p.y); ly1 = Math.max(ly1, p.y); });
                w = lx1 - lx0; h = ly1 - ly0;
            }
            if (!(w > 0) || !(h > 0)) return;

            let shapeName = 'ELLIPSE';
            if (prim.shape === 'RECT' || prim.shape === 'ROUNDRECT') shapeName = 'RECT';
            else if (prim.shape === 'OVAL') shapeName = 'OVAL';
            else if (prim.shape === 'POLYGON') shapeName = 'POLYGON';

            const rot = prim.rotation || 0;
            const rad = rot * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            let points = '';
            if (shapeName === 'POLYGON') {
                points = stdFlattenPath(prim.path, 6).map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
            } else if (shapeName === 'RECT') {
                const hw = w / 2, hh = h / 2;
                // 顺序：左上 → 右上 → 右下 → 左下（世界坐标 Y 向上）
                const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([dx, dy]) => ({
                    x: pad.x + dx * cos - dy * sin,
                    y: pad.y + dx * sin + dy * cos
                }));
                points = corners.map(p => stdX(p.x) + ' ' + stdY(p.y)).join(' ');
            } else if (shapeName === 'OVAL') {
                // 长圆：给中轴线两端点
                const along = w >= h;
                const half = (along ? w : h) / 2 - Math.min(w, h) / 2;
                const a = { x: pad.x - (along ? half : 0), y: pad.y - (along ? 0 : half) };
                const b = { x: pad.x + (along ? half : 0), y: pad.y + (along ? 0 : half) };
                const ra = { x: pad.x + (a.x - pad.x) * cos - (a.y - pad.y) * sin, y: pad.y + (a.x - pad.x) * sin + (a.y - pad.y) * cos };
                const rb = { x: pad.x + (b.x - pad.x) * cos - (b.y - pad.y) * sin, y: pad.y + (b.x - pad.x) * sin + (b.y - pad.y) * cos };
                points = stdX(ra.x) + ' ' + stdY(ra.y) + ' ' + stdX(rb.x) + ' ' + stdY(rb.y);
            }

            let holeR = 0, holeLength = 0, slotPts = '';
            if (hasDrill) {
                if (pad.drill.isSlot) {
                    // === 槽孔 ===
                    // PadTool 里槽孔的 w = 全长（中心距 + 钻刀直径），h = 槽宽；
                    // 标准版的约定（对照官方源码实测）：
                    //   [9]  holeR      = 槽宽 / 2（半径）
                    //   [13] holeLength = 槽孔全长（含两端圆头）
                    //   [14] slotPointArr = 槽中心线两端点（画布绝对坐标）
                    // 【必须给出 slotPointArr】只给 holeLength 时标准版会把槽从原点
                    // 拉到焊盘中心，槽长被撑到 1000mm 以上（实测复现）。
                    const slotW = Math.min(pad.drill.w, pad.drill.h);
                    const slotLen = Math.max(pad.drill.w, pad.drill.h);
                    holeR = stdU(slotW / 2);
                    holeLength = stdU(slotLen);
                    const halfLine = (slotLen - slotW) / 2;      // 中心线半长
                    const slotRad = (pad.drill.rotation || 0) * Math.PI / 180;
                    const ddx = Math.cos(slotRad) * halfLine;
                    const ddy = Math.sin(slotRad) * halfLine;
                    slotPts = stdX(pad.x - ddx) + ' ' + stdY(pad.y - ddy) + ' '
                        + stdX(pad.x + ddx) + ' ' + stdY(pad.y + ddy);
                } else {
                    holeR = stdU(pad.drill.w / 2);
                }
            }
            const plated = hasDrill ? (pad.drill.isPlated ? 'Y' : 'N') : 'Y';
            const solExp = (pad.exps && pad.exps.mt !== null && pad.exps.mt !== undefined) ? stdU(pad.exps.mt) : '';
            const pstExp = (pad.exps && pad.exps.pt !== null && pad.exps.pt !== undefined) ? stdU(pad.exps.pt) : '';
            const hx = stdX(pad.x), hy = stdY(pad.y);
            grow(hx, hy);

            // 焊盘编号：优先取飞针文件里匹配到的引脚号，否则回退 '1'
            const pinHit = flyingPinAt(flyingIndex, pad.x, pad.y, padMatchBoxMM(prim));
            const padNum = (pinHit && pinHit.num) || '1';
            const f = ['PAD', shapeName, hx, hy, stdU(w), stdU(h), layer, '', padNum,
                holeR, points, stdNum(rot), nextGid(), holeLength, slotPts, plated, 0,
                pstExp, solExp, hx + ',' + hy];
            shapes.push(f.join('~'));
        });

        // ---------- 2. 过孔 / 非金属化孔 ----------
        (uni.remainingVias || []).forEach(v => {
            const hx = stdX(v.x), hy = stdY(v.y);
            grow(hx, hy);
            if (v.isPlated) {
                shapes.push(['VIA', hx, hy, stdU(v.padDia || v.dia), '', stdU(v.dia / 2), nextGid(), 0].join('~'));
            } else {
                shapes.push(['HOLE', hx, hy, stdU(v.dia / 2), nextGid(), 0].join('~'));
            }
        });

        // ---------- 3. 导线 / 圆弧 ----------
        const tracks = uni.tracks || [];
        // 圆弧 → 标准版 ARC 图元： d = "M sx,sy A r,r 0 <largeArc> <sweep> ex,ey"
        // 扫描方向与参考文件一致：Gerber G03（逆时针，角度为正）→ sweep-flag 0，G02 → 1。
        const svgArcD = (sx, sy, ex, ey, r, sweepDeg) => {
            // 容差：半圆的扫掠角由浮点运算得出，可能是 180.00000000000003，
            // 直接用 > 180 会把半圆误判成优弧（large-arc=1）。
            const largeArc = Math.abs(sweepDeg) > 180.0001 ? 1 : 0;
            const sweepFlag = (sweepDeg > 0) ? 0 : 1;
            return 'M' + stdX(sx) + ',' + stdY(sy) + ' A' + stdU(r) + ',' + stdU(r)
                + ' 0 ' + largeArc + ' ' + sweepFlag + ' ' + stdX(ex) + ',' + stdY(ey);
        };
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            const layer = STD_LAYER(t.layerId);
            const sw = stdU(t.width || 0.15);
            const gid = nextGid();
            if (t.type !== 'ARC') {
                grow(stdX(t.x1), stdY(t.y1)); grow(stdX(t.x2), stdY(t.y2));
                shapes.push(['TRACK', sw, layer, '', stdX(t.x1) + ' ' + stdY(t.y1) + ' ' + stdX(t.x2) + ' ' + stdY(t.y2), gid, 0].join('~'));
                continue;
            }
            // 360° 整圆在提取阶段已拆成「两段对向的 180° 半圆」——
            // 这里把它们重新合成标准版的 CIRCLE 图元（与 EDA 官方导出的形态一致）。
            const nxt = tracks[i + 1];
            const isHalf = Math.abs(Math.abs(t.angle) - 180) < 0.01;
            const pairs = isHalf && nxt && nxt.type === 'ARC'
                && Math.abs(nxt.angle - t.angle) < 0.01
                && Math.abs(nxt.x1 - t.x2) < 1e-6 && Math.abs(nxt.y1 - t.y2) < 1e-6
                && Math.abs(nxt.x2 - t.x1) < 1e-6 && Math.abs(nxt.y2 - t.y1) < 1e-6;
            if (pairs) {
                const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
                const r = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) / 2;
                grow(stdX(cx - r), stdY(cy)); grow(stdX(cx + r), stdY(cy));
                shapes.push(['CIRCLE', stdX(cx), stdY(cy), stdU(r), sw, layer, gid, 0, '', ''].join('~'));
                i++;   // 两段半圆已经合成一个整圆
                continue;
            }
            const chord = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
            const srad = (t.angle || 0) * Math.PI / 180;
            if (chord < 1e-9 || Math.abs(Math.sin(srad / 2)) < 1e-9) {
                // 退化圆弧（起点=终点又非整圆）：没有半径信息，按点处理跳过
                grow(stdX(t.x1), stdY(t.y1));
                continue;
            }
            const r = Math.abs(chord / (2 * Math.sin(srad / 2)));
            grow(stdX(t.x1), stdY(t.y1)); grow(stdX(t.x2), stdY(t.y2));
            shapes.push(['ARC', sw, layer, '', svgArcD(t.x1, t.y1, t.x2, t.y2, r, t.angle), '', gid, 0].join('~'));
        }

        // ---------- 4. 折线 / 覆铜 / 板框 ----------
        (uni.polys || []).forEach(p => {
            const pts = stdFlattenPath(p.path, 6);
            if (pts.length < 2) return;
            pts.forEach(q => grow(stdX(q.x), stdY(q.y)));
            if (p.layerId === 11) {
                // 板框：标准版用 BoardOutLine 层上的闭合 TRACK 折线承载
                shapes.push(['TRACK', stdU(p.width || 0.254), 10, '', stdPointStr(pts), nextGid(), 0].join('~'));
            } else if (STD_IS_COPPER(p.layerId)) {
                // 覆铜 → 填充区域（SOLIDREGION），与画布渲染一致：打开就是实心铜
                shapes.push(stdSolidRegion(STD_LAYER(p.layerId), stdPathStr(pts, true), nextGid()));
            } else {
                // 其它层的折线（丝印/文档/机械的描边）保留为带线宽的 TRACK
                shapes.push(['TRACK', stdU(p.width || 0.15), STD_LAYER(p.layerId), '', stdPointStr(pts), nextGid(), 0].join('~'));
            }
        });

        // ---------- 5. 填充区域（含铜层覆铜，统一走 SOLIDREGION） ----------
        (uni.fills || []).forEach(f => {
            const pts = stdFlattenPath(f.path, 6);
            if (pts.length < 3) return;
            pts.forEach(q => grow(stdX(q.x), stdY(q.y)));
            shapes.push(stdSolidRegion(STD_LAYER(f.layerId), stdPathStr(pts, true), nextGid()));
        });

        // ---------- 6. 图片（轮廓填充） ----------
        (uni.images || []).forEach(img => {
            const pts = stdFlattenPath(img.path, 6);
            if (pts.length < 3) return;
            pts.forEach(q => grow(stdX(q.x), stdY(q.y)));
            shapes.push(stdSolidRegion(STD_LAYER(img.layerId), stdPathStr(pts, true), nextGid()));
        });

        // 兜底：一个图元都没生成时，BBox 用原点，避免出现 Infinity
        if (!isFinite(bx0)) { bx0 = STD_ORIGIN_X; bx1 = STD_ORIGIN_X; by0 = STD_ORIGIN_Y; by1 = STD_ORIGIN_Y; }

        return {
            head: {
                docType: '3',
                editorVersion: STD_EDITOR_VER,
                newgId: true,
                c_para: {},
                x: STD_ORIGIN_X,
                y: STD_ORIGIN_Y,
                hasIdFlag: true
            },
            canvas: STD_CANVAS,
            shape: shapes,
            layers: STD_LAYERS,
            objects: STD_OBJECTS,
            BBox: {
                x: stdNum(bx0),
                y: stdNum(by0),
                width: stdNum(bx1 - bx0),
                height: stdNum(by1 - by0)
            },
            preference: { hideFootprints: '', hideNets: '' },
            DRCRULE: STD_DRCRULE,
            netColors: {}
        };
    }

    // 目标：标准版 —— 生成并下载嘉立创EDA标准版 PCB 源码（.json）
    async function exportForStandard(config) {
        if (!loadedFiles || loadedFiles.length === 0) {
            alert('请先导入 Gerber 文件');
            return;
        }
        try {
            const doc = buildStandardSource();
            if (!doc.shape.length) {
                alert('没有可导出的图元，请检查已勾选的图层');
                return;
            }
            const json = JSON.stringify(doc, null, 2);
            const baseName = currentZipName || `${new Date().getTime()}`;
            downloadBlobAsFile(new Blob([json], { type: 'application/json;charset=utf-8' }),
                `Gerber_To_PCB_${baseName}.json`);

            let nPad = 0, nVia = 0, nHole = 0, nTrack = 0, nArc = 0, nSolid = 0, nSlot = 0;
            doc.shape.forEach(s => {
                const k = s.split('~')[0];
                if (k === 'PAD') { nPad++; if (parseFloat(s.split('~')[13]) > 0) nSlot++; }
                else if (k === 'VIA') nVia++;
                else if (k === 'HOLE') nHole++;
                else if (k === 'TRACK') nTrack++;
                else if (k === 'ARC') nArc++;
                else if (k === 'SOLIDREGION') nSolid++;
            });
            appLog('-----------------------');
            appLog('标准版源码生成完毕');
            appLog(`焊盘 ${nPad} 个（含槽孔 ${nSlot} 个）/ 过孔 ${nVia} 个 / 非金属化孔 ${nHole} 个`);
            appLog(`导线 ${nTrack} 条 / 圆弧 ${nArc} 条 / 填充区域 ${nSolid} 块`);
            appLog(`画布尺寸 ${doc.BBox.width} × ${doc.BBox.height} 单位（1 单位 = 10 mil）`);
        } catch (e) {
            console.error(e);
            appLog(`标准版导出失败: ${e.message}`);
            alert('标准版导出失败: ' + e.message);
        }
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

