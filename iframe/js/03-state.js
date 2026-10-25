// ====================================================================================
// 03-state.js  —  运行时状态、画布上下文与协议弹窗
// ------------------------------------------------------------------------------------
// 职责：
//   · 全局可变状态：rawFilesCache / loadedFiles / viewState
//   · 主画布与标尺的 2D 上下文、离屏缓冲画布
//   · 用户协议确认与条款弹窗（confirmAction / showDisclaimer / 协议复选框同步）
//   · PCB 画布上下文门控（「通过源码导入 / 通过图元导入」仅在 PCB 画布上可用）
// 依赖：本文件在【加载时即访问 DOM】（#main-canvas / #ruler-h / #ruler-v），
//       因此所有脚本必须放在 </body> 之前，且本文件早于 09-ui.js。
// 加载顺序：第 3 个
// ====================================================================================

// ====================================================================================
// 2. 全局状态定义
// ====================================================================================

    let rawFilesCache = []; 
    let loadedFiles = [];
    let viewState = { scale: 15, offsetX: 0, offsetY: 0, unit: 'mm', isDragging: false, lastX: 0, lastY: 0 };

    // 当前是否处于 PCB 画布（由 06-utils.js detectPcbCanvasContext() 检测后写入）。
    // null = 尚未检测完成（此时不锁定按钮，避免误禁用）。
    let isOnPcbCanvas = null;
    let pcbContextReason = '';

    // --- 飞针标注层（顶层/底层 × 元件位号/焊盘名称）---------------------------------
    // 数据源：压缩包内的 FlyingProbeTesting.json（LAYER 字段 T/B 决定属于哪一面）。
    // 这些层不对应 Gerber 文件，只在画布上做文字标注；「元件位号」两层勾选后还会参与导出
    // （见 05-pad-tool.js / 08-export.js）。
    // 四层默认全部勾选显示（导入的 Gerber 若带飞针文件即刻可见）。
    const flyingOverlayVisible = {
        [FLYING_LAYER.REFDES_TOP]: true,
        [FLYING_LAYER.PADNAME_TOP]: true,
        [FLYING_LAYER.REFDES_BOTTOM]: true,
        [FLYING_LAYER.PADNAME_BOTTOM]: true,
        // FPC 补强「材料 + 厚度」标注，同样默认显示
        [FLYING_LAYER.STIFFENER]: true
    };
    // 标注数据缓存：{ pads:[{x,y,num,net,comp,side}], comps:[{x,y,ref,side}] }。
    // 导入/重载时置空重建，避免在 drawCanvas（跟随平移缩放高频调用）里重复做
    // extractRawData + consolidate。
    let flyingLabelCache = null;
    // --- 5. 画布渲染 (优化版：HiDPI + RAF 节流) ---
    const mainCanvas = document.getElementById('main-canvas');
    const ctx = mainCanvas.getContext('2d', { alpha: false }); // 优化：关闭透明通道
    const rulerH = document.getElementById('ruler-h'); const ctxH = rulerH.getContext('2d');
    const rulerV = document.getElementById('ruler-v'); const ctxV = rulerV.getContext('2d');

    const bufferCanvas = document.createElement('canvas');
    const bufCtx = bufferCanvas.getContext('2d', { willReadFrequently: true });
    // bufferCanvas 里「当前还残留着像素」的矩形（设备像素）。绘制时只清这一块、
    // 只把这块 drawImage 到主画布 —— 避免每层都全屏 clear + 全屏拷贝。
    let lastBufRect = null;

    let isRenderPending = false; // RAF 锁

    // --- 交互期「快照快放」 ---
    // 大板（>500KB）整幅重绘要 300ms 以上（19k 图元 × 逐条 stroke），缩放/平移只有 3fps。
    // 交互（滚轮缩放 / 中键拖拽）期间不再整幅重绘，而是把上一帧的位图按新的偏移/缩放贴回去
    // （一次 drawImage，1~3ms），松手 150ms 后再做一次完整重绘。视觉上缩放像「图片缩放」，
    // 但操作是跟手的；停止操作后立刻恢复清晰渲染。
    const snapCanvas = document.createElement('canvas');
    const snapCtx = snapCanvas.getContext('2d', { alpha: false });
    let snapInfo = null;          // { offsetX, offsetY, scale, w, h }
    let snapValid = false;
    let snapIdleTimer = 0;
    let viewInteracting = false;  // true = 正在拖动/缩放中（允许走快照路径）



    // --- 弹窗与协议确认逻辑 ---
    // 「用户协议与免责声明」的确认改由侧栏复选框（#cfg-agree）承担：
    // 勾选后才会放行导入 / 导出嘉立创EDA 操作；弹窗本身只用于查看条款正文。

    /** 打开《用户协议与免责声明》弹窗 */
    function showDisclaimer() {
        const modal = document.getElementById('disclaimer-modal');
        if (modal) modal.style.display = 'flex';
    }

    /** 关闭《用户协议与免责声明》弹窗 */
    function closeDisclaimer() {
        const modal = document.getElementById('disclaimer-modal');
        if (modal) modal.style.display = 'none';
    }

    /** 协议复选框是否已勾选 */
    function isAgreementChecked() {
        const cb = document.getElementById('cfg-agree');
        return !!(cb && cb.checked);
    }

    /** 复选框勾选状态变化时的回调（HTML onchange 调用） */
    function onAgreementChange() {
        syncAgreementButtons();
    }

    /**
     * 整行点击切换协议勾选（命中区 = 整个 .agree-row）。
     * 两个例外：
     *   · 点复选框本身 → 交给原生行为，避免取反两次；
     *   · 点《用户协议与免责声明》链接 → 只打开条款，不改变勾选状态。
     */
    function onAgreeRowClick(e) {
        const t = e && e.target;
        if (!t) return;
        if (t.id === 'cfg-agree') return;
        if (t.classList && t.classList.contains('agree-link')) return;
        const cb = document.getElementById('cfg-agree');
        if (!cb) return;
        cb.checked = !cb.checked;
        onAgreementChange(cb.checked);
    }

    /** 依据协议勾选状态，切换受控按钮的「锁定」外观（按钮仍可点击，点击会震动提示） */
    function syncAgreementButtons() {
        const debugOn = typeof DEBUG !== 'undefined' && DEBUG;
        const locked = !debugOn && !isAgreementChecked();
        document.querySelectorAll('.agree-gated').forEach(btn => {
            btn.classList.toggle('is-locked', locked);
        });
    }

    /** 未勾选协议就点击受控按钮：让协议复选框左右震动提醒 */
    function shakeAgreement() {
        const row = document.getElementById('agree-row');
        if (!row) return;
        row.classList.remove('agree-shake');
        void row.offsetWidth; // 强制回流，保证连续点击也能重放动画
        row.classList.add('agree-shake');
        row.addEventListener('animationend', () => row.classList.remove('agree-shake'), { once: true });
        const cb = document.getElementById('cfg-agree');
        if (cb) cb.focus();
    }

    /**
     * 统一的导入 / 导出确认入口（HTML 内联 onclick 调用）。
     * 已勾选协议 → 直接执行；未勾选 → 震动协议复选框并中止。
     */
    function confirmAction(actionCallback) {
        // DEBUG 模式跳过协议校验，便于调试
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            actionCallback();
            return;
        }
        if (!isAgreementChecked()) {
            shakeAgreement();
            return;
        }
        actionCallback();
    }

    // ----------------------------------------------------------------------------------
    // PCB 画布上下文门控
    // ------------------------------------------------------------------------------------
    // 「通过源码导入 / 通过图元导入」必须写在**当前打开的 PCB 文档**里：
    //   · 不在 PCB 画布（开始页 / 原理图 / 符号库…）→ 按钮置灰 + 点击给提示，不发起写入；
    //   · 在 PCB 画布但未勾选协议 → 仍走原有「震动协议复选框」的提示。
    // 检测结果由 06-utils.js detectPcbCanvasContext() 异步返回。
    // ----------------------------------------------------------------------------------

    /** 非 PCB 画布时给用户的提示文案 */
    function pcbContextHintText() {
        return '未检测到 PCB 画布：打开 PCB 文档后才能进行导入。';
    }

    /**
     * 刷新「需要 PCB 画布」按钮的状态。
     * 三态：null（检测中，不锁） / true（可用） / false（禁用并显示提示行）
     * 同时决定「获取当前板子」（#eda-export-title / #in-eda-gerber）的显隐：
     * 只有检测确认在 PCB 文档里才显示，其余情况（不在 / 检测中 / 检测失败）一律隐藏。
     */
    function applyPcbContextUI() {
        const off = (isOnPcbCanvas === false);
        document.querySelectorAll('.pcb-gated').forEach(btn => {
            btn.classList.toggle('is-off-canvas', off);
        });
        const hint = document.getElementById('pcb-context-hint');
        if (hint) {
            hint.style.display = off ? 'block' : 'none';
            if (off) hint.textContent = pcbContextHintText();
        }
        // 「获取当前板子」读的是 EDA 里当前打开的工程：非 PCB 文档时整块隐藏（这里不像导入按钮
        // 那样还能「先勾协议」，置灰没有意义）。显隐只由本函数负责——HTML 里默认 display:none，
        // 环境门控也在 applyEnvVisibility 里交给这里接管，避免两处各写一次互相打架。
        // 检测中（null）保持隐藏，检测到 PCB 后才显示，省掉「先亮后灭」的闪烁。
        if (typeof eda !== 'undefined') {
            const onBoard = (isOnPcbCanvas === true);
            const titleEl = document.getElementById('eda-export-title');
            if (titleEl) titleEl.style.display = onBoard ? 'flex' : 'none';
            const gerberWrap = document.getElementById('in-eda-gerber');
            if (gerberWrap) gerberWrap.style.display = onBoard ? 'block' : 'none';
        }
    }

    /** 进行中的全量检测（并发调用合并到同一个 Promise，避免同时读两份文档源码） */
    let pcbRefreshInFlight = null;

    /**
     * 检测并刷新 PCB 画布状态。
     * @param {boolean} [silent] 静默模式（只刷新界面，不写运行日志）
     * @returns {Promise<boolean|null>} 是否在 PCB 画布上（检测失败返回 null）
     */
    async function refreshPcbContext(silent) {
        if (typeof detectPcbCanvasContext !== 'function') return isOnPcbCanvas;
        // 轮询 tick / 焦点复核 / 首次检测可能撞在一起，全量检测要读整份源码，不允许并行
        if (pcbRefreshInFlight) return pcbRefreshInFlight;
        pcbRefreshInFlight = (async () => {
            try {
                const r = await detectPcbCanvasContext();
                const changed = (isOnPcbCanvas !== r.onPcbCanvas);
                isOnPcbCanvas = r.onPcbCanvas;
                pcbContextReason = r.reason;
                if (!silent || changed) {
                    // 只写状态，不写检测依据（原因由画布下方的提示条负责说明）
                    appLog(r.onPcbCanvas ? '已检测到 PCB 画布' : '未检测到 PCB 画布');
                }
                applyPcbContextUI();
                return isOnPcbCanvas;
            } catch (e) {
                isOnPcbCanvas = false;
                pcbContextReason = '检测异常：' + (e && e.message ? e.message : e);
                appLog('画布状态：检测失败');
                applyPcbContextUI();
                return isOnPcbCanvas;
            }
        })();
        try {
            return await pcbRefreshInFlight;
        } finally {
            pcbRefreshInFlight = null;
        }
    }

    /**
     * 首次检测：跑一次全量检测（要写日志，所以非静默），并把「文档标识」记下来，
     * 免得 200ms 后的第一轮轮询因为标识未知，把整份源码再读一遍。
     */
    async function initPcbContext() {
        await refreshPcbContext();
        pcbLastFullCheck = Date.now();
        pcbDocKey = await currentDocKey();
        return isOnPcbCanvas;
    }

    // ----------------------------------------------------------------------------------
    // PCB 画布状态轮询（200ms）
    // ------------------------------------------------------------------------------------
    // 面板开着时用户随时可能切页签（PCB → 原理图画布 → 再切回来），此时 iframe 不会重载，
    // focus / visibilitychange 也未必触发，所以用一个 200ms 的轮询兜住。
    //
    // 轮询本身必须**足够便宜**：每次只用 dmt_SelectControl.getCurrentDocumentInfo() 取
    // 「文档标识」（类型 + uuid + tabId，单次很轻），标识变了才去跑 detectPcbCanvasContext()
    // ——后者会读整份文档源码，21MB 的板子按 5Hz 读是不可接受的。
    // ----------------------------------------------------------------------------------

    const PCB_CONTEXT_POLL_MS = 200;      // 轮询间隔
    const PCB_CONTEXT_RECHECK_MS = 3000;  // 判为「不在画布」或拿不到文档标识时的复核间隔
    let pcbPollTimer = null;
    let pcbPollBusy = false;              // 一个 tick 尚未跑完（含异步）
    let pcbDocKey = null;                 // 上次全量检测对应的文档标识
    let pcbLastFullCheck = 0;             // 上次全量检测的时间戳

    /**
     * 便宜的「当前文档标识」：文档类型 + uuid + tabId。
     * 只用来判断「文档换了没有」，不参与 PCB 判定本身。
     * @returns {Promise<string|null>} 取不到时返回 null（调用方退回限速的全量检测）
     */
    async function currentDocKey() {
        try {
            const sc = (typeof eda !== 'undefined') ? eda.dmt_SelectControl : null;
            if (!sc || typeof sc.getCurrentDocumentInfo !== 'function') return null;
            const info = await sc.getCurrentDocumentInfo();
            if (!info) return '';
            return [info.documentType, info.uuid, info.tabId].join('|');
        } catch (e) {
            return null;
        }
    }

    /**
     * 一次轮询 / 一次手动复核：文档没变就立即返回，变了才重跑全量检测。
     * 定时器与窗口焦点事件共用本函数，避免两套逻辑各读一遍源码。
     */
    async function pcbContextTick() {
        if (pcbPollBusy) return;                              // 上一轮还没跑完
        if (document.visibilityState === 'hidden') return;    // 面板不可见时不做
        const overlay = document.getElementById('loading-overlay');
        // 解析 / 导出期间遮罩被置成 inline 的 flex（见 07-file-io.js、08-export.js），
        // 这时别再去读文档源码抢资源；空闲时它是 CSS 的 display:none，inline 值为空
        if (overlay && overlay.style.display === 'flex') return;

        pcbPollBusy = true;
        try {
            const key = await currentDocKey();
            const now = Date.now();
            if (key === null) {
                // 取不到文档标识（旧版 EDA 接口缺失）：退回全量检测，限速到 3s 一次
                if (now - pcbLastFullCheck < PCB_CONTEXT_RECHECK_MS) return;
            } else if (key === pcbDocKey) {
                // 文档没换：已在画布上就什么都不用做；判为「不在」时低频复核，避免一次误判
                // （比如读源码瞬时失败）把按钮永久藏掉
                if (isOnPcbCanvas === true) return;
                if (now - pcbLastFullCheck < PCB_CONTEXT_RECHECK_MS) return;
            }
            await refreshPcbContext(true);
            pcbLastFullCheck = Date.now();
            // 用检测「之后」的标识对齐：检测期间用户可能又切了文档，那样状态与标识会错配，
            // 置 null 让下一轮 200ms 立刻重检，而不是把按钮按错的结论一直挂着
            const keyAfter = await currentDocKey();
            pcbDocKey = (keyAfter === key) ? keyAfter : null;
        } catch (e) {
            // 轮询不允许抛错打断定时器
        } finally {
            pcbPollBusy = false;
        }
    }

    /** 启动 200ms 轮询（幂等：重复调用只挂一个定时器） */
    function startPcbContextPolling() {
        if (pcbPollTimer) return;
        pcbPollTimer = setInterval(pcbContextTick, PCB_CONTEXT_POLL_MS);
    }

    /** 停止轮询（目前只在页面卸载时调用，避免定时器泄漏） */
    function stopPcbContextPolling() {
        if (!pcbPollTimer) return;
        clearInterval(pcbPollTimer);
        pcbPollTimer = null;
    }

    window.addEventListener('pagehide', () => {
        if (typeof stopPcbContextPolling === 'function') stopPcbContextPolling();
    });

    /**
     * 需要 PCB 画布的导入入口（HTML 内联 onclick 调用）。
     * 顺序：不在 PCB 画布 → 提示并中止；在画布但未勾选协议 → 震动提示；否则执行。
     */
    function confirmPcbAction(actionCallback) {
        if (typeof DEBUG !== 'undefined' && DEBUG) {
            actionCallback();
            return;
        }
        if (isOnPcbCanvas === false) {
            if (typeof showToast === 'function') showToast(pcbContextHintText(), 'warn');
            else alert(pcbContextHintText());
            return;
        }
        confirmAction(actionCallback);
    }

