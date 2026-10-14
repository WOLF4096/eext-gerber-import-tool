// ====================================================================================
// processors/industry-x2.js  —  Gerber X2（RS-274X + 属性）处理模块
// ------------------------------------------------------------------------------------
// 【当前状态】骨架已就位，解析与利用逻辑尚未实现（ready: false）。
//             选择该模式会给出明确提示，不会静默无响应。
//
// 定位：Gerber X2 = RS-274X + 属性。属性分三类：
//   %TF.<名>,<值>*%   文件属性，写在文件头。关键的是 .FileFunction（本文件是哪一层）
//                     —— 有了它就不必再靠文件名猜图层。
//   %TA.<名>,<值>*%   光圈属性，写在 %ADD 之后。关键的是 .AperFunction
//                     —— 直接说明这个光圈是导线(Conductor) 还是焊盘(SMDPad) 还是过孔(ViaDrill)。
//   %TO.<名>,<值>*%   对象属性，写在指令前，作用于随后的图元。%TD*% 表示属性作用域结束。
//
// 待实现清单：
//   1. GerberParser 解析 %TF/%TA/%TO/%TD，按作用域正确绑定到文件 / 光圈 / 指令
//   2. resolveLayerId 改用 %TF.FileFunction（parseGerberFileFunction 已备好）
//   3. PadTool 用 %TA.AperFunction 区分焊盘 / 过孔 / 导线，替代现在的几何猜测
// 依赖：processors/registry.js、processors/industry-common.js
// 加载顺序：registry.js、industry-common.js 之后
// ====================================================================================

    registerProcessor({
        id: 'gerberx2',
        label: 'Gerber X2（含属性）',
        group: 'industry',
        ready: false,

        todo: '解析 %TF/%TA/%TO/%TD 属性：FileFunction 定层、AperFunction 定图元类型',

        // 目标特性（实现后由 GerberParser 消费）
        parserFeatures: {
            x2Attributes: true,
            x3Components: false,
            legacy274d: false,
            apertureTable: null
        },

        /**
         * 自动识别打分：以 X2 三类属性为准；出现 X3 的元件属性时让给 X3。
         */
        detect(ctx) {
            if (ctx.any(/%TO\.[ \t]*C[ \t]*,/)) return 0;  // 有元件位号 → 是 X3
            if (ctx.any(/%TF\./)) return 5;                // 文件属性是 X2 的标志
            if (ctx.any(/%(TA|TO)\./)) return 3;
            return 0;
        },

        /**
         * 图层归属：实现后应优先使用 %TF.FileFunction；
         * 目前尚未接入属性，先退化为行业文件名规则。
         */
        resolveLayerId(fileObj, parseResult, defaultLayerId) {
            return resolveIndustryLayerId(fileObj.name, defaultLayerId);
        },

        exportTarget: 'jlc'
    });
