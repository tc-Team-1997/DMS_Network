const ExcelJS = require('exceljs');

function toCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => {
    const v = r[c] == null ? '' : String(r[c]);
    return '"' + v.replace(/"/g, '""') + '"';
  }).join(','));
  return [header, ...lines].join('\n');
}

async function toXlsx(rows, columns, sheetName = 'Export') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map(c => ({ header: c, key: c, width: 20 }));
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow(r));
  return await wb.xlsx.writeBuffer();
}

module.exports = { toCsv, toXlsx };
