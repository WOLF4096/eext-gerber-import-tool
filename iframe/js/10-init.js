// ====================================================================================
// 10-init.js  —  初始化与全局事件
// ------------------------------------------------------------------------------------
// 职责：
//   · initLayerSelect     图层类型下拉初始化
//   · 拖拽导入：dragenter / dragleave / dragover / drop（含全屏遮罩层）
//   · window.resetConfig / window.reparseFiles  恢复默认设置 / 应用参数并重载
//   · DOMContentLoaded 初始化、窗口 resize 监听、首屏尺寸与绘制
//   · PCB 画布上下文检测的启动与重新检测（焦点 / 可见性变化时刷新）
// 依赖：必须最后加载 —— 加载时会立即调用 09-ui.js 的 resizeCanvas() 与 drawCanvas()。
// 加载顺序：第 10 个（最后）
// ====================================================================================

// ====================================================================================
// 8. 初始化入口 (Init)
// ====================================================================================

    // DOMContentLoaded 事件监听。
    // initLayerSelect。
    // 1. 初始化铜层数选择器 (1, 2, 4, 6 ... 32)
    function initLayerSelect() {
        const select = document.getElementById('cfg-copper-layers');
        if (!select) return;

        // 记录当前值（如果有），防止重置时丢失用户的选择
        const oldVal = select.value;

        select.innerHTML = ''; // 清空

        const layers = [1, 2];
        for (let i = 4; i <= 32; i += 2) {
            layers.push(i);
        }

        layers.forEach(num => {
            const option = document.createElement('option');
            option.value = num;
            option.textContent = num + ' 层板';
            select.appendChild(option);
        });

        // 恢复值或设默认值
        if (oldVal && layers.includes(parseInt(oldVal))) {
            select.value = oldVal;
        } else {
            select.value = 2; 
        }
    }
    
    // 全局拖拽事件处理
    const dropZone = document.getElementById('global-drop-zone');
    let dragCounter = 0; // 计数器，防止进入子元素时闪烁

    // 重置配置 (Reset)
    window.resetConfig = () => {
        // --- 1. 无文件时的硬重置 ---
        if (!rawFilesCache || rawFilesCache.length === 0) {
            document.getElementById('cfg-units').value = 'mm';
            document.getElementById('cfg-g-int').value = 2;
            document.getElementById('cfg-dec').value = 5;
            document.getElementById('cfg-d-int').value = 2;
            document.getElementById('cfg-d-dec').value = 4;
            // 兜底模式已移除，重置为默认的处理模式（嘉立创EDA专业版）
            document.getElementById('cfg-source-type').value = 'easyedapro';
            
            // 显式重置两个单位面板的 UI
            if (window.setUnitUI) {
                setUnitUI('mm', 'graphic');
                setUnitUI('mm', 'drill'); // <--- 新增：重置钻孔单位 UI
            }
            
            if (window.syncUiFromState) window.syncUiFromState();
            return;
        }

        // --- 2. 有文件时的智能检测重置 ---
        let detectedG = { int: null, dec: null }; // 图形精度
        let detectedD = { int: null, dec: null }; // 钻孔精度
        let detectedGraphicUnit = 'mm'; 
        let detectedDrillUnit = 'mm'; // <--- 新增：钻孔单位检测变量

        // 遍历缓存文件进行检测
        for (const file of rawFilesCache) {
            const content = file.content;
            
            // A. 处理模式的识别改由注册表统一负责
            //    （见 processors/registry.js 的 applyDetectedProcessMode，
            //      它会综合内容特征与文件名约定判断 Gerber 代际）


            // B. 检测图形单位 (G70/MOIN)
            if (content.match(/(?:^|\n)(?:%MOIN|G70)/) || content.includes("Units: Imperial")) {
                detectedGraphicUnit = 'in';
            }

            // C. 检测钻孔单位 (METRIC/INCH)
            // 只有当文件看起来像钻孔文件时才检测
            if (content.indexOf('M48') !== -1 || file.name.match(/\.(drl|txt|xln)$/i)) {
                if (content.match(/INCH|M72/i)) {
                    detectedDrillUnit = 'in';
                } else if (content.match(/METRIC|M71/i)) {
                    detectedDrillUnit = 'mm';
                }
            }

            // D. 检测 Gerber 图形精度
            const g04Match = content.match(/(\d+)\s*integers\s+(?:and\s+)?(\d+)\s+decimals/i);
            if (g04Match && !detectedG.int) {
                detectedG.int = parseInt(g04Match[1]);
                detectedG.dec = parseInt(g04Match[2]);
            }
            if (!detectedG.int) {
                const fsMatch = content.match(/%FS[LTAI]*[XY](\d)(\d)/i);
                if (fsMatch) {
                    detectedG.int = parseInt(fsMatch[1]);
                    detectedG.dec = parseInt(fsMatch[2]);
                }
            }

            // E. 检测 Drill 钻孔精度
            if (!detectedD.int && (content.indexOf('M48') !== -1 || file.name.match(/\.(drl|txt|xln)$/i))) {
                const drillMatch = content.match(/(?:METRIC|INCH).*?,([0-9\.]+)/i);
                if (drillMatch) {
                    const fmtStr = drillMatch[1]; 
                    if (fmtStr.includes('.')) {
                        const parts = fmtStr.split('.');
                        detectedD.int = parts[0].length;
                        detectedD.dec = parts[1].length;
                    }
                }
            }
        }

        // --- 3. 将检测结果回填 ---

        // 设置图形单位
        document.getElementById('cfg-units').value = detectedGraphicUnit;
        // 【新增】设置钻孔单位到隐藏 Input
        document.getElementById('cfg-d-units').value = detectedDrillUnit; 
        
        // 设置 UI 显式状态
        if (window.setUnitUI) {
            setUnitUI(detectedGraphicUnit, 'graphic');
            setUnitUI(detectedDrillUnit, 'drill'); 
        }

        // 设置来源：自动识别 Gerber 代际并切换处理模式
        applyDetectedProcessMode(rawFilesCache);

        // 设置精度参数 (若未检测到，使用默认值)
        document.getElementById('cfg-g-int').value = detectedG.int || 2;
        document.getElementById('cfg-dec').value = detectedG.dec || 5;

        document.getElementById('cfg-d-int').value = detectedD.int || 2;
        document.getElementById('cfg-d-dec').value = detectedD.dec || 4;

        // 4. 刷新数字显示
        if (window.syncUiFromState) window.syncUiFromState();
        
        // 5. 立即应用
        reparseFiles();
    };

    // 重解析文件 (Reparse)
    window.reparseFiles = () => {
        if (rawFilesCache.length === 0) return;
        
        // 获取所有配置值
        const cfgUnits = document.getElementById('cfg-units').value;
        const cfgDUnits = document.getElementById('cfg-d-units').value;
        
        const cfgGInt = parseInt(document.getElementById('cfg-g-int').value);
        const cfgGDec = parseInt(document.getElementById('cfg-dec').value);
        const cfgDInt = parseInt(document.getElementById('cfg-d-int').value);
        const cfgDDec = parseInt(document.getElementById('cfg-d-dec').value);
        
        // 构建配置对象
        const configOverride = { 
            units: cfgUnits,        // 图形单位
            drillUnits: cfgDUnits,  // 【新增】钻孔单位
            gInt: cfgGInt,
            gDec: cfgGDec,
            dInt: cfgDInt,
            dDec: cfgDDec
        };
        
        processRawFiles(configOverride);
        appLog('已按新的单位 / 精度重新渲染');
    };

    // ====================================================================================
    // 环境显隐（演示模式）
    // ====================================================================================

    /**
     * 按运行环境显隐「只有 EDA 里才有意义」的入口。
     * HTML 中这些节点默认 display:none，所以浏览器直开演示时不会闪一下；
     * EDA 里再恢复它们各自的布局方式（标题是 flex，按钮区是 block）。
     * @param {boolean} isEdaEnv 是否处于 EDA 环境
     */
    function applyEnvVisibility(isEdaEnv) {
        const setDisplay = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.style.display = value;
        };
        setDisplay('eda-export-title', isEdaEnv ? 'flex' : 'none');              // 获取当前板子
        setDisplay('in-eda-gerber', isEdaEnv ? 'block' : 'none');                // 同上：按钮区
        setDisplay('ui-export-canvas-title', isEdaEnv ? 'flex' : 'none');        // 导出至当前 PCB 画布
        setDisplay('ui-export-canvas-btn-wrapper', isEdaEnv ? 'block' : 'none'); // 源码 / 图元导入
    }

    /**
     * 演示模式提示：把本机打开次数写进 cookie，并显示一行提示。
     * 写失败（隐私模式 / 禁用 cookie）只降级文案，不影响演示本身。
     */
    function showDemoUsageHint() {
        const hint = document.getElementById('demo-usage-hint');
        const usage = window.DemoUsage && typeof window.DemoUsage.bump === 'function' ? window.DemoUsage.bump() : null;
        if (!usage) return;

        if (typeof appLog === 'function') {
            appLog('演示模式：本机第 ' + usage.opens + ' 次打开' + (usage.saved ? '' : '（cookie 写入失败）'));
        }
        if (!hint) return;
        hint.textContent = '演示模式 · 导入画布需在 EDA 内使用';
        hint.style.display = 'block';
    }

    // --- 初始化入口 ---
    document.addEventListener('DOMContentLoaded', () => {
        initLayerSelect();

        // 初始化用户协议复选框对应的按钮外观：默认未勾选 → 导入 / 导出嘉立创EDA 按钮呈锁定态
        if (typeof syncAgreementButtons === 'function') syncAgreementButtons();
        
        // 检测是否在嘉立创 EDA 环境中（README 的「打开演示」是浏览器直开本页，此时为 false）
        const isEdaEnv = typeof eda !== 'undefined';

        // 「获取当前板子」与「通过源码 / 图元导入」都依赖 EDA：前者读 EDA 里打开的工程，
        // 后者写入当前 PCB 文档。HTML 里这几块默认 display:none（避免演示页闪一下），
        // 这里按环境统一恢复或保持隐藏。
        applyEnvVisibility(isEdaEnv);

        if (!isEdaEnv) {
            // --- 情况 A: 演示环境（浏览器直开 / GitHub Pages） ---
            // EDA 专属入口已隐藏；这里补一句演示提示，并把本机使用次数写进 cookie
            showDemoUsageHint();
        } else {
            // --- 情况 B: EDA 环境 ---
            // 检测当前是否处于 PCB 画布：从开始页 / 原理图 / 符号库打开时读不到 PCB 源码 →
            // 「通过源码导入 / 通过图元导入」禁用（按钮仍可见，只是锁定并给出提示）。
            if (typeof refreshPcbContext === 'function') {
                refreshPcbContext();
                // 用户切到其它文档再切回来时重新检测（iframe 重新获得焦点 / 页面重新可见）
                let pcbRecheckTimer = null;
                const schedulePcbRecheck = () => {
                    if (pcbRecheckTimer) clearTimeout(pcbRecheckTimer);
                    pcbRecheckTimer = setTimeout(() => { refreshPcbContext(true); }, 400);
                };
                window.addEventListener('focus', schedulePcbRecheck);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') schedulePcbRecheck();
                });
            }
        }
        
        // --- [修改] 调试面板初始化与模式控制 ---
        const panel = document.getElementById('debug-panel');
        const title = document.getElementById('debug-panel-title');
        const genBtn = document.getElementById('btn-debug-gen');
        const textArea = document.getElementById('debug-source-area');

        // [修改] 使用 flex 布局以支持高度自适应
        if (panel) {
            panel.style.display = 'flex'; 
        }

        // 「生成网络」复选框常驻显示（勾选后导入 / 导出时按铜层连通性为图元分配网络）

        if (typeof DEBUG !== 'undefined' && DEBUG) {
            // === DEBUG 模式 ===
            if (title) title.textContent = "图形源码 (DEBUG)";
            if (genBtn) genBtn.style.display = 'block'; 
        } else {
            // === 普通模式 (日志模式) ===
            if (title) title.textContent = "运行日志";
            if (genBtn) genBtn.style.display = 'none';  
            
            appLog(`系统就绪，等待导入...`);
        }
    });


    // 立即运行以防脚本在 DOM 之后加载
    if(document.getElementById('cfg-copper-layers')) initLayerSelect();

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropZone.classList.remove('active');
        }
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault(); // 必须阻止默认行为才能触发 drop
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('active');
        
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFiles(files);
        }
    });
    
    // 遮罩层本身也需要处理 drop，防止事件没冒泡
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation(); // 停止冒泡，由这里处理
        dragCounter = 0;
        dropZone.classList.remove('active');
        
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFiles(files);
        }
    });

    // 尺寸变化合并：EDA 打开面板 / 拖拽分栏时会连续触发几十次 resize，
    // 而大板一次全量重绘要 1s 上下（3200×2000@2x 实测 1.2s）—— 不合并的话
    // 一次面板动画就能把渲染时间叠成几十秒。这里延迟 120ms，只在尺寸稳定后重绘一次。
    let _resizeTimer = 0;
    window.addEventListener('resize', () => {
        if (_resizeTimer) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => { _resizeTimer = 0; resizeCanvas(); }, 120);
    });
    // 多显示器拖动时 dpr 会变但不一定触发 resize —— 单独监听，避免图形与文字 DPI 不一致
    if (typeof watchDprChanges === 'function') watchDprChanges();

    // 启动时立即执行：调整画布大小。
    resizeCanvas();

    // --- 新增：启动时将坐标原点置于画面中心 ---
    const container = document.getElementById('canvas-container');
    if (container.clientWidth > 0 && container.clientHeight > 0) {
        viewState.offsetX = container.clientWidth / 2;
        viewState.offsetY = container.clientHeight / 2;
    }

    // 启动时立即执行：绘制初始画面。
    drawCanvas();
