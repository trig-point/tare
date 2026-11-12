import type { Database } from "better-sqlite3";

export type ReadNonceResult = {
  nonce: string;
};

export function readNonce(db: Database): ReadNonceResult | null {
  const sql = `
	SELECT nonce FROM grocery_restore_nonce WHERE id = 1;
	
	`;
  const res = db.prepare(sql).raw(true).get();

  return res ? mapArrayToReadNonceResult(res) : null;
}

function mapArrayToReadNonceResult(data: any) {
  const result: ReadNonceResult = {
    nonce: data[0],
  };
  return result;
}
