import type {Dataset,MatrixSnapshot} from '../../../packages/contracts/src/index';
import {evaluateCapacityComparison,validateCapacityInput} from '../../../packages/domain/src/capacity';
import {body,failure,json,loadDataset,loadMatrix,type ApiEvent} from './common';

/** Read-only ports: public capacity evaluations cannot persist results or build routes. */
export interface CapacityDependencies {
  loadDataset():Promise<Dataset>;
  loadMatrix():Promise<MatrixSnapshot>;
  now():Date;
}

export function createCapacityEvaluationHandler(dependencies:CapacityDependencies) {
  return async (event:ApiEvent) => {
    const requestId=event.requestContext.requestId;
    try {
      // Reject unknown fields and excessive work before accessing either snapshot.
      const input=validateCapacityInput(body(event));
      const [dataset,matrix]=await Promise.all([dependencies.loadDataset(),dependencies.loadMatrix()]);
      return json(200,evaluateCapacityComparison(dataset,matrix,input,dependencies.now()),requestId);
    } catch(error) {return failure(error,requestId);}
  };
}

export const capacityEvaluationHandler=createCapacityEvaluationHandler({loadDataset,loadMatrix,now:()=>new Date()});
