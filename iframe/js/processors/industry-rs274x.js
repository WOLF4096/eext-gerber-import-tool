// ====================================================================================
// processors/industry-rs274x.js  —  行业标准 RS-274X 处理模块
// ------------------------------------------------------------------------------------
// 定位：最通用的 Gerber 形态。光圈（%ADD/%AM）、单位（%MO）、坐标格式（%FS）
//       全部写在文件内部，任何 PCB 软件都能导出。
//       本模式是全工具唯一的「行业标准」入口（Gerber X2/X3 只是在其上追加
//       %TF/%TA/%TO 属性，属性对本工具只是附加信息，不影响图形解析）。
// 与嘉立创内部标准的区别：不使用嘉立创的 Gerber_xxxLayer 命名约定与埋盲孔层对命名，
//       改用行业通用命名规则（KiCad / Altium / Eagle / Protel 等）识别图层。
// 依赖：processors/registry.js、processors/industry-common.js
// 加载顺序：registry.js、industry-common.js 之后
// ====================================================================================

    registerProcessor({
        id: 'rs274x',
        label: 'RS-274X（通用）',
        group: 'industry',
        ready: true,

        // 本模式不解析 X2/X3 属性（属性只影响图元语义，不影响几何）
        parserFeatures: {
            x2Attributes: false,
            x3Components: false,
            legacy274d: false,
            apertureTable: null
        },

        /**
         * 自动识别打分。
         * 判据是「文件内嵌了光圈定义（%ADD）」—— 这正是 RS-274X 与老式
         * RS-274D（光圈定义在外面）的本质区别。带 %TF/%TA/%TO 属性的 X2/X3
         * 文件同属 RS-274X 家族，一并接住，不再让给已移除的专用模式。
         */
        detect(ctx) {
            if (!ctx.any(/%ADD/)) return 0;               // 没有内嵌光圈 → 不是 RS-274X
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
