/**
 * Resolves an `IDBRequest` to its result, awaiting `success` / `error` events
 * unless the request has already completed.
 */
export async function getResult<T>(request: IDBRequest<T>): Promise<T> {
  if (request.readyState === 'done') {
    return request.result;
  }

  return await new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      const error: Error = request.error ?? new Error('Unknown error');
      reject(error);
    });
  });
}
