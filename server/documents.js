const path = require("node:path");

const supportedExtensions = new Set([".txt", ".docx", ".pdf"]);

async function extractDocumentText({ name, content }) {
  const extension = path.extname(name || "").toLowerCase();

  if (!supportedExtensions.has(extension)) {
    throw new Error("仅支持 Word、PDF 和 TXT 文档。");
  }

  if (extension === ".txt") {
    return content.toString("utf8").replace(/^\uFEFF/, "");
  }

  if (extension === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer: content });
    return result.value;
  }

  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: content });
  try {
    const result = await parser.getText();
    if (!result.text.trim()) {
      throw new Error("PDF 没有可读取的文字，首版暂不支持扫描件。");
    }
    return result.text;
  } finally {
    await parser.destroy();
  }
}

module.exports = { extractDocumentText };
