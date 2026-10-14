// ====================================================================================
// processors/jlc-internal.js  —  嘉立创EDA专业版内部标准处理模块
// ------------------------------------------------------------------------------------
// 定位：处理嘉立创EDA专业版（V2.2 / V3）自己导出的 Gerber。
//       这是本扩展原有的、验证最充分的一条路径，行为与拆分前保持一致。
// 与行业标准的区别：沿用 02-config.js 里的 fileNameRules，包含
//       · Gerber_TopLayer / Gerber_BottomLayer / Gerber_InnerLayerN 等内部命名
//       · Drill_PTH_Through / Drill_NPTH_Through / Drill_xxx_to_yyy（埋盲孔层对）
//       · 钻孔图层默认不勾选的约定
// 依赖：processors/registry.js
// 加载顺序：registry.js 之后
// ====================================================================================

    registerProcessor({
        id: 'easyedapro',
        label: '嘉立创EDA专业版 V2.2 / V3 专用',
        group: 'internal',
        ready: true,

        // 嘉立创导出的 Gerber 就是 RS-274X，不需要额外特性
        parserFeatures: {
            x2Attributes: false,
            x3Components: false,
            legacy274d: false,
            apertureTable: null
        },

        /**
         * 自动识别打分。
         * 嘉立创导出的 Gerber 在内容上属于标准 RS-274X，无法只靠指令区分，
         * 因此这里的依据是「厂商标识 + 内部命名约定」两处特征。
         */
        detect(ctx) {
            let score = 0;
            // 文件内容里的厂商标识（生成软件信息）
            if (ctx.any(/EasyEDA\s*Pro/i)) score += 5;
            // 归档后的内部命名：Gerber_TopLayer.gbr / Gerber_BottomSilkLayer.gbr ...
            if (ctx.anyName(/Gerber_(Top|Bottom|Inner|Board|Mechanical|Document|Drill)\w*Layer/i)) score += 4;
            // 钻孔的内部命名，含埋盲孔层对 Drill_Inner1_to_Inner2
            if (ctx.anyName(/Drill_(PTH|NPTH|.*_to_)/i)) score += 3;
            return score;
        },

        // 不提供 resolveLayerId：沿用 02-config.js 中 fileNameRules 的默认匹配结果
        exportTarget: 'jlc'
    });
