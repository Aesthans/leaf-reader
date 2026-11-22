# 第三方组件与内容来源

一页自身的代码使用 MIT 许可证。第三方组件保留各自的版权声明和许可证。

| 组件 | 用途 | 许可证与声明 |
| --- | --- | --- |
| foliate-js | EPUB、MOBI、AZW3 阅读内核 | MIT，见 `vendor/foliate/LICENSE` |
| zip.js | 电子书压缩文件读取 | BSD-3-Clause，见 `vendor/foliate/vendor/LICENSE` |
| fflate | Kindle 格式解压 | MIT，见 `vendor/foliate/vendor/fflate.LICENSE` |
| PDF.js | PDF 渲染、文字层和目录 | Apache-2.0，发行包内见 `vendor/pdfjs/LICENSE` |
| Electron | Windows 应用运行时 | MIT，Windows 发行目录包含 `LICENSE` 和 `LICENSES.chromium.html` |

foliate-js 基于提交 `78914aef4466eb960965702401634c2cb348e9b1`，本项目修改了阅读框架中的脚本执行、滚动输入及手机翻页相关逻辑。原始声明随源码与发行包保留。[上游源码](https://github.com/johnfactotum/foliate-js/tree/78914aef4466eb960965702401634c2cb348e9b1)

PDF.js 版本由 `package-lock.json` 固定，Android 使用同版本的 legacy 构建。PDF.js 随附的标准字体和 WebAssembly 解码器在 `vendor/pdfjs/standard_fonts`、`vendor/pdfjs/wasm` 中保留各自的 `LICENSE_*` 文件。Windows 中这些文件位于 `resources/app` 下，Android 中位于 APK 的 `assets` 下。[上游源码](https://github.com/mozilla/pdf.js)

手机端在线查词会调用萌典、中文维基百科或维基词典，查询结果在界面中标注来源。萌典释义保留教育部《重編國語辭典修訂本》的原文与 CC BY-ND 3.0 TW 标注，维基内容标注 CC BY-SA。源码和安装包通过在线接口请求这些内容。[萌典](https://www.moedict.tw/)、[教育部辞典授权说明](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html)、[维基百科](https://zh.wikipedia.org/)、[维基词典](https://en.wiktionary.org/)

README 中的截图使用项目自编示例文本。
