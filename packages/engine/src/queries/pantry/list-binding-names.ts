import type { Database } from "better-sqlite3";

export type ListBindingNamesParams = {
  user_id: number;
  generation: number;
};

export type ListBindingNamesResult = {
  reference_kind: string;
  reference_id: number;
  name: string;
};

export function listBindingNames(
  db: Database,
  params: ListBindingNamesParams,
): ListBindingNamesResult[] {
  const sql = `
	SELECT pantry_bindings.reference_kind, pantry_bindings.reference_id, foods.name
	FROM pantry_bindings
	JOIN foods ON foods.user_id = pantry_bindings.user_id AND foods.id = pantry_bindings.reference_id
	WHERE pantry_bindings.user_id = ? AND pantry_bindings.generation = ? AND pantry_bindings.reference_kind = 'food'
	UNION ALL
	SELECT pantry_bindings.reference_kind, pantry_bindings.reference_id, source_foods.name
	FROM pantry_bindings
	JOIN source_foods ON source_foods.id = pantry_bindings.reference_id
	WHERE pantry_bindings.user_id = ? AND pantry_bindings.generation = ? AND pantry_bindings.reference_kind = 'source_food';
	
	`;
  const rows = db
    .prepare(sql)
    .raw(true)
    .all([
      params.user_id,
      params.generation,
      params.user_id,
      params.generation,
    ]);

  return rows.map((data) => mapArrayToListBindingNamesResult(data));
}

function mapArrayToListBindingNamesResult(data: any) {
  const result: ListBindingNamesResult = {
    reference_kind: data[0],
    reference_id: data[1],
    name: data[2],
  };
  return result;
}
