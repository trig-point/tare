import type { Database } from "better-sqlite3";

export type DeleteMachineParams = {
  user_id: number;
  id: number;
};

export type DeleteMachineResult = {
  id: number;
};

export function deleteMachine(
  db: Database,
  params: DeleteMachineParams,
): DeleteMachineResult | null {
  const sql = `
	DELETE FROM training_machines
	WHERE user_id = ? AND id = ?
	RETURNING id;
	
	`;
  const res = db.prepare(sql).raw(true).get([params.user_id, params.id]);

  return res ? mapArrayToDeleteMachineResult(res) : null;
}

function mapArrayToDeleteMachineResult(data: any) {
  const result: DeleteMachineResult = {
    id: data[0],
  };
  return result;
}
