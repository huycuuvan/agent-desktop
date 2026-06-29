import { google } from "googleapis";

export class SheetsClient {
  private readonly sheetsApi: ReturnType<typeof google.sheets>;

  constructor(credentialsPath: string) {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.sheetsApi = google.sheets({ version: "v4", auth });
  }

  async readSheet(spreadsheetId: string, tabName: string): Promise<string[][]> {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A:Z`,
    });
    return (response.data.values as string[][] | undefined) ?? [];
  }

  async writeHeader(spreadsheetId: string, tabName: string, header: string[]): Promise<void> {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }

  async appendRows(spreadsheetId: string, tabName: string, rows: string[][]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.sheetsApi.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  }

  async updateRow(spreadsheetId: string, tabName: string, rowIndex: number, values: string[]): Promise<void> {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
  }
}
