// ====================================================================================
// processors/registry.js  —  处理模式注册表与路由
// ------------------------------------------------------------------------------------
// 职责：
//   · 定义统一的「处理模式处理器」接口（见下方 makeProcessor 注释）
//   · 收集各处理器模块的注册（processors/*.js 在加载时调用 registerProcessor）
//   · 按 id 取用处理器：解析特性、图层归属、导出路径全部由处理器决定，
//     主流程（07-file-io / 08-export）不再写死 if (sourceType === 'xxx')
//   · 自动识别：导入文件后按各处理器的 detect() 打分，选出最匹配的模式
//
// 当前注册的处理模式（下拉框「处理模式」中只保留这两项）：
//   easyedapro  嘉立创EDA专业版 V2.2 / V3 专用   （processors/jlc-internal.js）
//   rs274x      RS-274X（通用）                  （processors/industry-rs274x.js）
// 其余模式（Gerber X2 / X3 / RS-274D / 兼容 / 保底）已按要求整体移除。
// _getPending 仅作为「取不到处理器」时的防御性兜底保留，正常流程不会走到。
//
// 加载顺序：必须早于所有 processors/*.js，且早于 09-ui.js / 10-init.js
// 注意：本文件只定义对象与方法，加载期不访问 DOM；DOM 只在运行期函数里触碰。
// ====================================================================================

    // 处理器接口字段说明：
    //   id              下拉框 value，必须与 ImportGerber.html 中 <option> 的 value 一致
    //   label           下拉框显示名
    //   group           'internal'（内部标准）/ 'industry'（行业标准）/ 'pending'（未实现）
    //   ready           是否已实现；false 时选择该模式会给出明确提示而不是静默无响应
    //   parserFeatures  交给 GerberParser.parse() 的特性开关（可选字段，缺省即关闭）
    //   detect(ctx)     自动识别打分，返回数字（0 表示不匹配），ctx 见 makeDetectContext
    //   resolveLayerId(fileObj, parseResult, defaultLayerId)
    //                   决定某个文件归属哪一层；缺失则沿用按文件名匹配的默认结果
    //   exportTarget    导出路由目标：'jlc'（嘉立创专业版流程）/ 'other'（其它流程）
    const PROCESSOR_SCAN_CAP = 256 * 1024; // 自动识别时每个文件最多扫描的字符数

    const processorRegistry = {
        _defs: new Map(),
        _order: [],

        /** 注册一个处理器；后注册的同名 id 会覆盖先前的 */
        register(def) {
            if (!def || !def.id) throw new Error('处理器必须提供 id');
            if (!this._defs.has(def.id)) this._order.push(def.id);
            this._defs.set(def.id, def);
            return def;
        },

        /** 按 id 取处理器；取不到时返回「未实现」兜底处理器 */
        get(id) {
            return this._defs.get(id) || this._getPending(id);
        },

        /**
         * 已注册的处理器列表。
         * 顺序即各处理器模块的加载顺序；下拉框的展示顺序由 ImportGerber.html
         * 里的 optgroup 决定，与此顺序无关。
         */
        list() {
            return this._order.map((id) => this._defs.get(id));
        },

        /** 读取当前下拉框选中的处理模式 id */
        currentId() {
            const sel = document.getElementById('cfg-source-type');
            return sel ? sel.value : '';
        },

        /** 读取当前选中的处理器 */
        current() {
            return this.get(this.currentId());
        },

        /** 未实现模式的兜底处理器：明确告知，而不是静默什么都不做 */
        _getPending(id) {
            return {
                id: id || 'unknown',
                label: id || '未知模式',
                group: 'pending',
                ready: false,
                parserFeatures: {},
                detect: () => 0,
                exportTarget: 'other'
            };
        }
    };

    /**
     * 各处理器模块在加载时调用本函数完成自注册。
     *
     * @param def - 处理器定义，字段见文件头部的接口说明
     * @returns 注册后的处理器定义
     */
    function registerProcessor(def) {
        return processorRegistry.register(def);
    }

    /**
     * 构造自动识别的上下文。
     * 只提供按需扫描的辅助方法，避免把全部 Gerber 文本拼成一个大字符串。
     *
     * @param fileList - [{ name, content }]
     * @returns 识别上下文
     */
    function makeDetectContext(fileList) {
        const files = (fileList || []).map((f) => ({
            name: f.name || '',
            content: f.content || ''
        }));
        // 扫描窗口：只取每个文件的前 N 个字符（属性、%ADD、%FS 都在文件头部）
        const scan = files.map((f) => f.content.slice(0, PROCESSOR_SCAN_CAP));
        return {
            files,
            names: files.map((f) => f.name),
            nameText: files.map((f) => f.name).join('\n'),
            size: files.length,
            /** 任一文件命中该正则 */
            any(re) {
                for (let i = 0; i < scan.length; i++) if (re.test(scan[i])) return true;
                return false;
            },
            /** 任一文件名命中该正则 */
            anyName(re) {
                return re.test(this.nameText);
            },
            /** 所有文件里该正则出现的总次数（超过 limit 提前返回） */
            count(re, limit) {
                const max = limit || 1000;
                let n = 0;
                for (let i = 0; i < scan.length; i++) {
                    const re2 = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
                    let m;
                    while ((m = re2.exec(scan[i])) !== null) {
                        n++;
                        if (n >= max) return n;
                        if (m.index === re2.lastIndex) re2.lastIndex++;
                    }
                }
                return n;
            }
        };
    }

    /**
     * 自动识别处理模式：让每个处理器为自己的匹配度打分，选出最匹配的模式。
     * 尚未实现（ready === false）的处理器照样参与打分，但不会被自动选中
     * —— 避免把用户自动切到一个还不能用的模式上。
     *
     * @param fileList - [{ name, content }]
     * @returns { id, label, scores, blockedBy } ；识别不出或并列时 id 为 null
     */
    function detectProcessMode(fileList) {
        const ctx = makeDetectContext(fileList);
        const scores = [];
        processorRegistry.list().forEach((def) => {
            let s = 0;
            try {
                s = Number(def.detect(ctx)) || 0;
            } catch (e) {
                s = 0;
            }
            if (s > 0) scores.push({ id: def.id, label: def.label, score: s, ready: def.ready !== false });
        });
        scores.sort((a, b) => b.score - a.score);

        // 没有命中任何特征 —— 不自动切换，保留用户当前选择
        if (scores.length === 0) return { id: null, label: null, scores, blockedBy: null };

        const usable = scores.filter((s) => s.ready);
        if (usable.length === 0) {
            // 命中的都是未实现的模式：不切换，但把原因带出去
            return { id: null, label: null, scores, blockedBy: scores[0] };
        }
        // 最高分与次高分并列（且都可用）时不切换，避免来回跳
        if (usable.length > 1 && usable[0].score === usable[1].score) {
            return { id: null, label: null, scores, blockedBy: null };
        }
        const blockedBy = (scores[0].score > usable[0].score && !scores[0].ready) ? scores[0] : null;
        return { id: usable[0].id, label: usable[0].label, scores, blockedBy };
    }

    /**
     * 识别并自动切换下拉框，同时写运行日志。
     * 识别不出时不改动当前选择。
     *
     * @param fileList - [{ name, content }]
     * @returns 最终生效的处理器
     */
    function applyDetectedProcessMode(fileList) {
        const sel = document.getElementById('cfg-source-type');
        const result = detectProcessMode(fileList);
        const detail = result.scores.map((s) => `${s.label}:${s.score}${s.ready ? '' : '(未实现)'}`).join('，');

        if (result.id && sel && sel.value !== result.id) {
            const from = processorRegistry.get(sel.value);
            sel.value = result.id;
            appLog(`处理模式：${from && from.label ? from.label : '未指定'} → ${result.label}`);
        } else if (result.id) {
            // 与当前选择一致时只报一次结果，不再追加「（与当前选择一致）」这类冗余说明
            appLog(`处理模式：${result.label}`);
        } else if (result.blockedBy) {
            appLog(`处理模式：${result.blockedBy.label} 暂不支持，沿用当前选择`);
        } else {
            appLog('处理模式：未能识别，沿用当前选择');
        }
        return processorRegistry.current();
    }
