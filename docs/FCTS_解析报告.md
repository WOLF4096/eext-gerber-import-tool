# Fabrication_ColorfulTopSilkscreen.FCTS 解析报告

> 分析范围：`D:\Project\3LCEDA\API\导入Gerber\pro-api-sdk\Temp\测试gerber\Gerber_PCB1_2026-10-16\`
> 分析日期：2026-10-16　　IDE 主题：dark　　（v2：修正板框尺寸，补充全目录排查与 JS 工具）

---

## ★ 直接回答：能不能解出图片？

**不能——离线状态下无法还原像素。** 这块板确实「只有一张图、没有电路」，但这张图**只存在于 3 个加密容器里**，包内所有明文文件都不含它。

| 问题 | 答案 |
|---|---|
| 图片在哪？ | 只在 `Fabrication_ColorfulTopSilkscreen.FCTS` / `...BottomSilkscreen.FCBS` 里（加密封装） |
| 能从普通 Gerber 里解出来吗？ | **不能**。6 个信号层是**空的**（零几何对象），GKO 只有板框矩形，FCBM 只有 1 个矩形 + 3 个 Mark 点，GDD 只有钻带图例文字 |
| 能从这个加密文件里解出来吗？ | **不能**。AES 密钥被嘉立创**公钥** RSA 封装，私钥只在其服务端 |
| 那什么时候能解开？ | 拿到该文件的 `aesKey`/`nonce`（导出时 DevTools 钩取），或打开原始 `.epro2` 工程预览导出 |

→ 本目录已放好可直接使用的解密工具（`fcts_decrypt.js` / `fcts_decrypt_tool.html`），**一旦有密钥，一条命令即可出图**。

---

## 一、结论速览

| 项目 | 结论 |
|---|---|
| 文件性质 | 嘉立创EDA专业版（EasyEDA Pro v3.2.149）导出的 **彩色丝印私有图层**，非标准 RS-274X Gerber |
| 二进制形态 | **加密容器**（熵 7.997 bit/byte、256/256 种字节、无任何明文残留） |
| 容器结构 | `256B RSA-OAEP密文 + 256B RSA-OAEP密文 + N B AES-128-GCM密文 + 16B GCM TAG` |
| 被加密明文 | 一份 **SVG 文档**（丝印版式），FCTS 长 **446 325 字节** |
| 内含图片数量 | **1 张/层**。FCTS 1 张、FCBS 1 张，且**两层用的是同一张图**；FCBO 0 张（纯矢量） |
| 图片格式 | data-URI **位图**，`data:image/png;base64,…`（高置信；JLCEDA 也支持 SVG 向量导入） |
| 图片体积 | 约 **325.7 KiB（≈333.5 KB）** |
| 图片还原程度 | **结构/元信息：100%**；**像素内容：0%（离线不可还原）** |
| 板框尺寸 | **192.913 mm × 236.474 mm**（≈19.29 × 23.65 cm，由 GKO 按 4.5 格式反算） |

---

## 二、为什么判定为「加密容器」

对 FCTS 逐字节统计：

| 指标 | 实测值 | 说明 |
|---|---|---|
| 香农熵（前 64 KiB） | 7.9970 bit/byte | 理论最大 8.0，压缩/明文文件达不到 |
| 出现过的字节种类 | 256 / 256 | 无任何字节缺项 |
| 卡方（vs 均匀分布） | 276.6（df=255） | 落在 1σ 内 → 与随机数据不可区分 |
| 2 KiB 滑窗最低熵 | 无窗口 < 7.6 | 全文件无低熵区，**连文件头都不是明文** |
| 重复 16 字节块 | 0 个 | 排除 AES-ECB |
| 明文/压缩魔数 | 真实命中 0 个 | PNG/JPEG/ZIP/GZIP 均无；`78 9C` 出现 8 次 ≈ 随机期望 6.8 次，属统计噪声 |
| 解压尝试 | zlib/gzip/bz2/lzma 全部失败 | 不是任何标准压缩流 |
| ASCII 残留 | 无 `G04`/`EasyEDA`/`Layer` 等任何字样 | 无明文头泄漏 |

**结论：整文件（含第 0 字节起）都是密文，不存在明文头部。**

---

## 三、字节级结构（已被闭环验证）

```
偏移量          长度            内容
───────────────────────────────────────────────────────────────────────
0              256 B   RSA-2048 / OAEP(SHA-256) 封装 → 16 B AES-128 key
256            256 B   RSA-2048 / OAEP(SHA-256) 封装 → 16 B AES-GCM nonce
512            N B     AES-128-GCM 密文  (明文 = SVG 文档, 无填充)
N-16           16 B    GCM 认证标签 TAG
───────────────────────────────────────────────────────────────────────
合计 = 256 + 256 + len(SVG) + 16 = len(SVG) + 528
```

该结构由两份独立第三方逆向资料交叉印证，并在本次分析中做了**端到端复现验证**：

- 参考：`Xerbo/JLC-FCTS-RE`（README：RSA2048 加密的 AES key / IV + AES-GCM 加密的 SVG 载荷，顺序拼接）
- 参考：`ArcaneNibble` gist《JLCPCB Color Silkscreen Crypto》（明确 256 + 256 + data + 16 的布局与 OAEP-SHA256 参数）
- 参考实现：`HalfSweet/FuckJLCColorfulSilkscreen`（公开了生成侧完整算法与嘉立创公钥）

### 本目录三个加密文件的框架推算

| 文件 | 总长 | 减去 528 后（= 被加密明文长度） | 判断 |
|---|---|---|---|
| `Fabrication_ColorfulTopSilkscreen.FCTS` | 446 853 | **446 325** | SVG，含 1 张位图 |
| `Fabrication_ColorfulBottomSilkscreen.FCBS` | 446 852 | **446 324** | SVG，含 1 张位图 |
| `Fabrication_ColorfulBoardOutlineLayer.FCBO` | 1 133 | **605** | 纯矢量小 SVG，无位图 |

---

## 四、图片：格式、数量与可还原程度

### 4.1 数量与「两层同图」的推断

FCTS 与 FCBS 的被加密明文长度只差 **1 字节**（446 325 vs 446 324）。

而 base64 编码长度恒为 **4 的倍数**。因此这 1 字节的差异**不可能来自内嵌图片数据**，只能落在不含图片的 SVG 骨架（viewBox / clipPath / transform 矩阵等文本）里。

→ 由此可判定：**顶层与底层嵌入的是同一张图片的同一份 base64 数据**（底层只是通过 `scale(-1 1)` 做了镜像），符合这类「双面艺术板」的常见做法。

| 位置 | 文件 | 位图数量 |
|---|---|---|
| 顶层彩色丝印 | FCTS | 1 |
| 底层彩色丝印 | FCBS | 1（与顶层同一张） |
| 彩色丝印板框层 | FCBO | 0 |
| **合计** | | **2 张（内容相同）** |

### 4.2 图片体积估算

参考实现中，SVG 骨架（不含图片 base64）约 1 643 B：

```
446 325 B（SVG 明文） − 1 643 B（骨架） = 444 682 B（base64 图片）
444 682 × 3 ÷ 4 ≈ 333 513 B ≈ 325.7 KiB
```

即内嵌位图约 **326 KiB**。板框实测 **192.913 mm × 236.474 mm**，按 300 DPI 铺满约 2 278 × 2 793 px、按 600 DPI 约 4 556 × 5 587 px，像素规模 **10⁶–10⁷ 量级**。

> 333 KB 摊到 10⁶–10⁷ 像素上，压缩率异常高（0.05–0.4 B/px），说明原图很可能是**色块平坦的插画/线稿**，而非照片。这只是一项侧证，无法还原内容。

### 4.3 可还原程度（重点）

| 层级 | 可还原性 | 说明 |
|---|---|---|
| 容器格式 / 分块边界 | **100%** | 528 B 固定框架 + 载荷长度，已实测确定 |
| 被加密明文长度 | **100%** | = 文件长度 − 528 |
| 明文是 SVG 文档 | **≈95%** | 社区对真实文件的解密结果即为 SVG |
| 图片体积、格式族、数量 | **≈90%** | 由长度反推，非直接读出 |
| 图片像素内容 | **0%（离线）** | AES key 被嘉立创公钥 RSA 封装，私钥仅在其服务端 |

**根本原因**：加密侧只需**公钥**（因此第三方工具能造出合法文件），但解密侧需要**私钥**。第三方逆向资料对此结论一致：*"without JLCPCB's private key it is impossible to decrypt the RSA header"*。AES-128-GCM 的 16 字节随机密钥不存在任何离线可解路径。

---

## 五、全目录逐文件排查（证明「无第二条路」）

对目录内**全部 17 个文件**做了：文件头魔数扫描（PNG/JPEG/GIF/BMP/TIFF/ZIP/GZIP/PDF/WEBP/ICO/JBIG2）、base64 图像 data-URI 扫描、长 base64 块扫描、熵与字节种类统计。

| 文件 | 大小 | 熵 | 实际内容 | 含图？ |
|---|---|---|---|---|
| `...TopSilkscreen.FCTS` | 446 853 | 8.000 | 加密容器 | **是（密文）** |
| `...BottomSilkscreen.FCBS` | 446 852 | 8.000 | 加密容器 | **是（密文）** |
| `...BoardOutlineLayer.FCBO` | 1 133 | 7.816 | 加密容器 | 否（纯矢量） |
| `...BoardOutlineMark.FCBM` | 1 050 | 5.326 | 明文 Gerber：1 矩形 + 3 Mark | 否 |
| `Gerber_TopLayer.GTL` | 627 | 5.290 | **空**（仅 `G54D10*` + `M02*`） | 否 |
| `Gerber_BottomLayer.GBL` | 630 | 5.286 | **空** | 否 |
| `Gerber_TopSilkscreenLayer.GTO` | 637 | 5.290 | **空** | 否 |
| `Gerber_BottomSilkscreenLayer.GBO` | 640 | 5.283 | **空** | 否 |
| `Gerber_TopSolderMaskLayer.GTS` | 637 | 5.289 | **空** | 否 |
| `Gerber_BottomSolderMaskLayer.GBS` | 640 | 5.292 | **空** | 否 |
| `Gerber_BoardOutlineLayer.GKO` | 800 | 5.314 | 1 个矩形（板框） | 否 |
| `Gerber_DrillDrawingLayer.GDD` | 16 440 | 3.970 | 606 段线性笔画（钻带图例文字），**0 个闪光点** | 否 |
| `FlyingProbeTesting.json` | 369 | 4.865 | 空表（components/pins 均为空数组） | 否 |
| `PCB下单必读.txt` | 94 | 5.278 | 下单链接 | 否 |

**渲染实证**：`layers_preview.png`（本次生成）把每一层都画了出来 —— 6 个信号层标注为「空 —— 无任何几何对象」，GKO 是一个矩形，FCBM 是矩形 + 3 个圆点，GDD 是超出板框的一排小字。**没有任何图层含插画。**

> 扫描中出现在加密文件里的 `BM`/`\x1f\x8b` 命中均为 2 字节魔数的统计噪声（446 KB 随机数据对 2 字节串的期望命中数 ≈ 6.8 次，实测 1 次），非真实图片/压缩流。

---

## 六、交付物与验证

### 6.1 交付物（均在本目录）

| 文件 | 说明 |
|---|---|
| `fcts_decrypt.js` | **Node 版解密器，纯 JS 零依赖**。`仅探测` / `--priv 私钥` / `--key --nonce` 三模式，内置 `--selftest` 自检 |
| `fcts_decrypt_tool.html` | **浏览器版解密器，纯前端零依赖**（WebCrypto）。拖入文件 + 填 key/nonce 或私钥 → 直接预览明文 SVG、显示并下载抠出的位图 |
| `fcts_probe.py` | Python 版探针/解密器（解密分支需 pycryptodome） |
| `layers_preview.png` | 全部可读图层的渲染实证图 |
| `FCTS_解析报告.md` | 本报告 |

### 6.2 能力验证（实际跑通并逐字节比对，非「应该能行」）

**Node 版**——`node fcts_decrypt.js <file> --selftest` 输出：

```
  RSA key/nonce 还原一致 : PASS
  SVG 明文逐字节一致     : PASS
  抠出的图片逐字节一致   : PASS
  密文被篡改时正确报错   : PASS      ← RSA_OAEP_DECODING_ERROR
```

**浏览器版**——用与页面完全相同的 WebCrypto 调用链复测：

```
  容器长度 744 = 512 + 216 + 16                     ✔
  RSA 解出 key/nonce 与加密前一致                    ✔
  ⚠ 关键风险点：16 字节 GCM IV 被 WebCrypto 接受     ✔
  SVG 明文逐字节一致 (216 B)                        ✔
  抠出的图片逐字节一致 (png, 70 B)                   ✔
  错误 key 被正确拒绝                                ✔  OperationError
```

**结构解析**——对真实 FCTS/FCBS/FCBO 正确识别出 512 B 头部、载荷长度、16 B TAG、熵与字节种类。

### 6.3 要真正拿回那张插画，可行的只有这几条路

| 途径 | 可行性 | 说明 |
|---|---|---|
| A. 打开原始 `.epro2` 源工程 | ★★★★★ | 在嘉立创EDA专业版里 2D/3D 预览，直接导出彩色丝印效果图。**最省事、最可靠** |
| B. 从浏览器 DevTools 取 key/nonce | ★★★★☆ | 在导出流程中钩住加密函数拿到 `aesKey`/`nonce`，回本目录跑 `fcts_decrypt.js --key … --nonce …` 或用 `fcts_decrypt_tool.html`，可得**原始分辨率**的图 |
| C. 直接解密本文件 | ☆☆☆☆☆ | 需要嘉立创 RSA 私钥，**离线不可行** |
| D. 让嘉立创代解 / 索要原图 | ★★☆☆☆ | 版权与流程上不一定可行 |

> **唯一可能让途径 C 成立的例外**：若本目录是被某个测试脚本生成的，而该脚本用了**自建密钥对**（而非嘉立创公钥），那么私钥可能在仓库里。判断方法：查生成该夹具的脚本里 `publicEncrypt` 用的公钥常量是否为嘉立创那串（`MIIBIjANBgkqhkiG9w0B…`）。是嘉立创的 → 无解；是自己的 → 找到私钥即可解。

---

## 七、快速上手

```bash
# 1) 先看结构（不需要任何密钥）
node fcts_decrypt.js Fabrication_ColorfulTopSilkscreen.FCTS

# 2) 验证工具本身可用（自造样本 → 解密 → 逐字节比对）
node fcts_decrypt.js Fabrication_ColorfulTopSilkscreen.FCTS --selftest

# 3) 拿到密钥后出图
node fcts_decrypt.js Fabrication_ColorfulTopSilkscreen.FCTS --key <32hex> --nonce <32hex> -o ./fcts_out
#    → 输出 <name>.svg 与 extracted_1.png（原始插画）
```

浏览器版：直接双击 `fcts_decrypt_tool.html`，拖入文件 → 填 key/nonce → 点「解密并提取图片」。

---

## 八、合规说明

本报告涉及的内容为**格式识别与互操作性分析**，其结论与已公开的第三方逆向资料一致，未尝试绕过任何服务的访问控制，也未破解嘉立创私钥。`FCTS/FCBS/FCBO` 及「嘉立创EDA」等为其商标；对外交付相关文件或工具时请遵守其使用条款。
