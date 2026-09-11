/** One CSV row, quoting only the cells that need it (quote, comma or newline). */
function csvRow(cells) {
  return cells
    .map((cell) => {
      const text = cell === null || cell === undefined ? "" : String(cell);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

module.exports = { csvRow };
