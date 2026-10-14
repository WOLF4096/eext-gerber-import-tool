// ====================================================================================
// 10-init.js  —  初始化与全局事件
// ------------------------------------------------------------------------------------
// 职责：
//   · initLayerSelect     图层类型下拉初始化
//   · 拖拽导入：dragenter / dragleave / dragover / drop（含全屏遮罩层）
//   · window.resetConfig / window.reparseFiles  恢复默认设置 / 应用参数并重载
//   · DOMContentLoaded 初始化、窗口 resize 监听、首屏尺寸与绘制
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
            document.getElementById('cfg-source-type').value = 'other';
            
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
        let detectedSource = 'easyedapro';
        let detectedGraphicUnit = 'mm'; 
        let detectedDrillUnit = 'mm'; // <--- 新增：钻孔单位检测变量

        // 遍历缓存文件进行检测
        for (const file of rawFilesCache) {
            const content = file.content;
            
            // A. 检测来源
            // if (content.includes("EasyEDA Pro")) detectedSource = 'easyedapro';
            // else if (content.includes("Altium") && detectedSource !== 'easyedapro') detectedSource = 'ad';


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

        // 设置来源
        const sourceSelect = document.getElementById('cfg-source-type');
        if (sourceSelect) sourceSelect.value = detectedSource;

        // 设置精度参数 (若未检测到，使用默认值)
        document.getElementById('cfg-g-int').value = detectedG.int || 2;
        document.getElementById('cfg-dec').value = detectedG.dec || 5;

        document.getElementById('cfg-d-int').value = detectedD.int || 2;
        document.getElementById('cfg-d-dec').value = detectedD.dec || 4;

        // 4. 刷新数字显示
        if (window.syncUiFromState) window.syncUiFromState();
        
        // 5. 立即应用
        reparseFiles();
        appLog(`渲染完成`);
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
        appLog(`渲染完成`);
    };

    // --- 初始化入口 ---
    document.addEventListener('DOMContentLoaded', () => {
        initLayerSelect();
        
        // 检测是否在嘉立创 EDA 环境中
        const isEdaEnv = typeof eda !== 'undefined';
        
        // 获取相关 DOM 元素
        const titleExport = document.getElementById('ui-export-canvas-title'); // 导出标题
        const btnExportWrapper = document.getElementById('ui-export-canvas-btn-wrapper'); // 导出按钮组
        
        const titleImportEda = document.getElementById('eda-export-title'); // [获取当前板子] 标题
        const divImportEda = document.getElementById('in-eda-gerber');     // [导入当前...] 按钮区域

        if (!isEdaEnv) {
            // --- 情况 A: 普通浏览器环境 ---
            // 1. 隐藏 [导出至 PCB 画布] (这是原来就有的逻辑)
            if (titleExport) titleExport.textContent = ''; // 或者 style.display = 'none'
            if (btnExportWrapper) btnExportWrapper.style.display = 'none';

            // 2. [新增] 隐藏 [获取当前板子] 区域
            if (titleImportEda) titleImportEda.style.display = 'none';
            if (divImportEda) divImportEda.style.display = 'none';

        } else {
            // --- 情况 B: EDA 环境 ---
            // 1. 显示 [导出至 PCB 画布]
            if (titleExport) titleExport.style.display = 'flex';
            if (btnExportWrapper) btnExportWrapper.style.display = 'block';
            
            // 2. [新增] 显示 [获取当前板子] 区域
            if (titleImportEda) titleImportEda.style.display = 'flex';
            if (divImportEda) divImportEda.style.display = 'block';
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

        // document.querySelector('#generatenet').closest('div').style.display = 'none';
        document.getElementById('generatenet').style.display = 'none';

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

    window.addEventListener('resize', resizeCanvas);

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
