import type { Dataset, EvaluationResult, MatrixSnapshot } from '../../contracts/src/index.js';
import { evaluateScenario } from '../../domain/src/index.js';

export interface CohortRepository { getDataset(): Promise<Dataset> }
export interface MatrixRepository { getMatrix(): Promise<MatrixSnapshot> }
export interface Clock { now(): Date }
export interface EvaluationDependencies { cohorts: CohortRepository; matrices: MatrixRepository; clock: Clock }

export async function evaluate(input: unknown, dependencies: EvaluationDependencies): Promise<EvaluationResult> {
  const [dataset, matrix] = await Promise.all([dependencies.cohorts.getDataset(), dependencies.matrices.getMatrix()]);
  return evaluateScenario(dataset, matrix, input, dependencies.clock.now());
}
