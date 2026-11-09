import type { Database } from "better-sqlite3";

export type SelectInstallIdResult = {
  id: string;
};

export function selectInstallId(db: Database): SelectInstallIdResult | null {
  const sql = `
	SELECT id FROM install WHERE singleton = 1;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToSelectInstallIdResult(res) : null;
}

function mapArrayToSelectInstallIdResult(data: any) {
  const result: SelectInstallIdResult = {
    id: data[0],
  };
  return result;
}
