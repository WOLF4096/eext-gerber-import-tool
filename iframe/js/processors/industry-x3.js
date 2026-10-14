// ====================================================================================
// processors/industry-x3.js  —  Gerber X3（X2 + 元件与网络）处理模块
// ------------------------------------------------------------------------------------
// 【当前状态】骨架已就位，解析与利用逻辑尚未实现（ready: false）。
//             选择该模式会给出明确提示，不会静默无响应。
//
// 定位：Gerber X3 = X2 的全部属性 + 装配信息。新增的关键属性是：
//   %TF.Part,Single|Array*%           单板还是拼板
//   %TO.C,<位号>*%                    随后的图元属于哪个元件（R1、U3 ...）
//   %TO.N,<网络名>*%                  随后的图元属于哪个网络
//   %TO.P,<位号>,<引脚号>*%           随后的图元是某元件的第几脚
//   这些信息足以把焊盘自动关联到元件与网络，正好对接本工具已有的
//   tryNetlist / flyingProbeData 网络生成能力。
//
// 待实现清单：
//   1. 复用 X2 的属性解析（%TF/%TA/%TO/%TD），另加 .Part 与 TO.C/TO.N/TO.P 语义
//   2. 建立「图元 → 元件位号 / 引脚号 / 网络名」的映射
//   3. 输出阶段把映射喂给网络生成，替代现在依赖 FlyingProbeTesting.json 的做法
// 依赖：processors/registry.js、processors/industry-common.js
//       以及先完成 industry-x2.js（X3 是 X2 的超集）
// 加载顺序：registry.js、industry-common.js 之后
// ====================================================================================

    registerProcessor({
        id: 'gerberx3',
        label: 'Gerber X3（含元件网络）',
        group: 'industry',
        ready: false,

        todo: '解析 TO.C/TO.N/TO.P 元件与网络属性，并接入 tryNetlist 网络生成',

        parserFeatures: {
            x2Attributes: true,
            x3Components: true,
            legacy274d: false,
            apertureTable: null
        },

        /**
         * 自动识别打分：只认 X3 独有的特征，普通 X2 文件不会命中。
         */
        detect(ctx) {
            if (ctx.any(/%TO\.[ \t]*C[ \t]*,/)) return 6;        // 元件位号属性
            if (ctx.any(/%TF\.[ \t]*Part[ \t]*,/i)) return 5;    // 单板/拼板标记
            if (ctx.any(/%TO\.[ \t]*(N|P)[ \t]*,/)) return 4;    // 网络/引脚属性
            return 0;
        },

        resolveLayerId(fileObj, parseResult, defaultLayerId) {
            return resolveIndustryLayerId(fileObj.name, defaultLayerId);
        },

        exportTarget: 'jlc'
    });
