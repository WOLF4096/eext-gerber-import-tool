// ====================================================================================
// processors/industry-rs274d.js  —  RS-274D（老式 Gerber）处理模块
// ------------------------------------------------------------------------------------
// 【当前状态】骨架已就位，老式指令与孔径表逻辑尚未实现（ready: false）。
//             选择该模式会给出明确提示，不会静默无响应。
//
// 定位：RS-274D 是 1980~90 年代的老格式，与 RS-274X 的根本区别是
//       **光圈定义不在文件里**，必须配一张外部的孔径表（或约定默认表）。
//       另外它用 G 代码表达一些 RS-274X 用 % 指令表达的东西。
//
// 已确认的缺口（实测：光圈表为空，线宽只能按 0.05mm 兜底）：
//   G70 / G71        以英寸 / 毫米为单位（当前完全不处理 → 英寸文件会整体放大 25.4 倍）
//   G90 / G91        绝对 / 增量坐标（当前恒按绝对处理 → 增量文件几何全错）
//   G54Dnn           选择光圈（当前能识别出 Dnn，但没有对应定义）
//   G74 / G75        单象限 / 多象限圆弧（当前按多象限处理）
//
// 待实现清单：
//   1. GerberParser 支持 G70/G71、G90/G91、G54Dnn、G74/G75
//   2. 孔径表来源（按既定方案）：先从导入的压缩包里按常见命名找
//      （.apr / .apt / aperture.lst / *.lst / *.apt），
//      找不到时退回内置的常用孔径默认表；两者都交给 parserFeatures.apertureTable
//   3. 无孔径定义时的兜底策略（按同层已出现过的最大孔径推断）
// 依赖：processors/registry.js、processors/industry-common.js
// 加载顺序：registry.js、industry-common.js 之后
// ====================================================================================

    registerProcessor({
        id: 'rs274d',
        label: 'RS-274D（老式格式）',
        group: 'industry',
        ready: false,

        todo: '支持 G70/G71、G90/G91、G54Dnn、G74/G75，并从压缩包或内置表加载孔径表',

        parserFeatures: {
            x2Attributes: false,
            x3Components: false,
            legacy274d: true,
            apertureTable: null   // 实现后填入选中的孔径表
        },

        /**
         * 自动识别打分：核心判据是「没有内嵌光圈定义」。
         */
        detect(ctx) {
            if (ctx.any(/%ADD/)) return 0;                 // 有 %ADD → 不是老格式
            let score = 0;
            if (ctx.any(/G54[ \t]*D\d+/i)) score += 4;      // G54Dnn 选刀
            if (ctx.any(/^[ \t]*G7[01]\b/im)) score += 3;   // G70/G71 单位
            if (ctx.any(/^[ \t]*G9[01]\b/im)) score += 2;   // G90/G91 绝对/增量
            if (score === 0 && ctx.any(/D\d+\*/)) score += 2; // 有 D 码却无光圈表
            return score;
        },

        resolveLayerId(fileObj, parseResult, defaultLayerId) {
            return resolveIndustryLayerId(fileObj.name, defaultLayerId);
        },

        exportTarget: 'jlc'
    });
