/**
 * Count pages from a rendered PDF's page tree (catalog /Pages /Count).
 * Same approach as generate-pdf.mjs — ignores page-like text in content streams.
 */
export function countPdfPagesFromBuffer(pdfBuffer) {
  const pdf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString("latin1") : String(pdfBuffer);
  const objects = new Map();
  const objectPattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
  for (const match of pdf.matchAll(objectPattern)) {
    const streamIndex = match[3].search(/\bstream(?:\r?\n|\r)/);
    const dictionary = streamIndex === -1 ? match[3] : match[3].slice(0, streamIndex);
    objects.set(`${match[1]} ${match[2]}`, dictionary);
  }
  const catalog = [...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body));
  const pagesRef = catalog?.match(/\/Pages\s+(\d+)\s+(\d+)\s+R\b/);
  const pages = pagesRef ? objects.get(`${pagesRef[1]} ${pagesRef[2]}`) : null;
  const count = pages && /\/Type\s*\/Pages\b/.test(pages) ? pages.match(/\/Count\s+(\d+)\b/) : null;
  const pageCount = count ? Number(count[1]) : 0;
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("Could not determine the rendered PDF page count from its page tree.");
  }
  return pageCount;
}

export function parseLoggedPdfPageCount(stdout) {
  const logged = String(stdout || "").match(/Pages:\s+(\d+)/);
  return logged ? Number(logged[1]) : null;
}

export function parsePdfPageCount(stdout, pdfBuffer) {
  const logged = parseLoggedPdfPageCount(stdout);
  if (logged) return logged;
  return countPdfPagesFromBuffer(pdfBuffer);
}
