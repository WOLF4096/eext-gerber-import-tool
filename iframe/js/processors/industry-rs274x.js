// ====================================================================================
// processors/industry-rs274x.js  —  行业标准 RS-274X 处理模块
// ------------------------------------------------------------------------------------
// 定位：最通用的 Gerber 形态。光圈（%ADD/%AM）、单位（%MO）、坐标格式（%FS）
//       全部写在文件内部，任何 PCB 软件都能导出。
// 与嘉立创内部标准的区别：不使用嘉立创的 Gerber_xxxLayer 命名约定与埋盲孔层对命名，
//       改用行业通用命名规则（KiCad / Altium / Eagle / Protel 等）识别图层。
// 依赖：processors/registry.js、processors/industry-common.js
// 加载顺序：registry.js、industry-common.js 之后
// ====================================================================================

    registerProcessor({
        id: 'rs274x',
        label: 'RS-274X（通用扩展）',
        group: 'industry',
        ready: true,

        // 本模式不解析 X2/X3 属性，也不启用老式 RS-274D 兼容
        parserFeatures: {
            x2Attributes: false,
            x3Components: false,
            legacy274d: false,
            apertureTable: null
        },

        /**
         * 自动识别打分。
         * 注意：带 X2/X3 属性的文件让给对应处理器；没有 %ADD 光圈表的让给 RS-274D。
         */
        detect(ctx) {
            if (ctx.any(/%(TF|TA|TO)[.\\*]/)) return 0;   // 有属性 → 属于 X2/X3
            if (!ctx.any(/%ADD/)) return 0;               // 没有内嵌光圈 → 属于 RS-274D
            if (ctx.any(/%FS/)) return 4;                 // %ADD + %FS：标准 RS-274X
            return 3;
        },

        /**
         * 图层归属：用行业通用命名规则解析文件名。
         * 规则表见 processors/industry-common.js 的 INDUSTRY_LAYER_RULES。
         */
        resolveLayerId(fileObj, parseResult, defaultLayerId) {
            return resolveIndustryLayerId(fileObj.name, defaultLayerId);
        },

        // 输出统一走嘉立创专业版的源码/图元生成流程
        exportTarget: 'jlc'
    });
