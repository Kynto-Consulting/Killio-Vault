import { HyperFormula } from 'hyperformula';

/**
 * Vault port of Killio-Frontend's `lib/sheetEngine.ts`. Singleton HyperFormula
 * instance keyed by brick id. Same enGB locale + DD/MM/YYYY date format so
 * formulas round-trip identically between the web table brick and the
 * mobile spreadsheet.
 */
class SheetEngine {
  private static instance: SheetEngine;
  private hf: HyperFormula;

  private constructor() {
    this.hf = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      dateFormats: ['DD/MM/YYYY'],
      language: 'enGB',
    });
  }

  static getInstance(): SheetEngine {
    if (!SheetEngine.instance) SheetEngine.instance = new SheetEngine();
    return SheetEngine.instance;
  }

  /** Replace the sheet's content. Translates `=SUM(A1;A2)` → `=SUM(A1,A2)` so
   *  Spanish-style separators survive. */
  updateSheet(sheetId: string, data: string[][]): void {
    const sanitized = data.map((row) =>
      row.map((cell) =>
        typeof cell === 'string' && cell.startsWith('=') && cell.includes(';')
          ? cell.replace(/;/g, ',')
          : cell,
      ),
    );
    if (this.hf.doesSheetExist(sheetId)) {
      const id = this.hf.getSheetId(sheetId)!;
      this.hf.setSheetContent(id, sanitized);
    } else {
      this.hf.addSheet(sheetId);
      const id = this.hf.getSheetId(sheetId)!;
      this.hf.setSheetContent(id, sanitized);
    }
  }

  getComputedValue(sheetId: string, row: number, col: number): string {
    if (!this.hf.doesSheetExist(sheetId)) return '';
    const val = this.hf.getCellValue({ sheet: this.hf.getSheetId(sheetId)!, row, col });
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && val !== null && 'type' in val && (val as any).type === 'ERROR') {
      return (val as any).value || '#ERROR';
    }
    return String(val);
  }

  getComputedData(sheetId: string, rows: number, cols: number): string[][] {
    if (!this.hf.doesSheetExist(sheetId)) return [];
    const out: string[][] = [];
    for (let r = 0; r < rows; r += 1) {
      const row: string[] = [];
      for (let c = 0; c < cols; c += 1) row.push(this.getComputedValue(sheetId, r, c));
      out.push(row);
    }
    return out;
  }

  /** Returns column-letter aliases in spreadsheet style (A, B, …, Z, AA, AB…). */
  static colLabel(idx: number): string {
    let n = idx;
    let label = '';
    while (n >= 0) {
      label = String.fromCharCode((n % 26) + 65) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }
}

export const sheetEngine = SheetEngine.getInstance();
export const colLabel = SheetEngine.colLabel;
