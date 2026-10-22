import { v7 as uuidv7 } from 'uuid';

export function newId(): string {
  return uuidv7();
}

export function newBatchId(): string {
  return uuidv7();
}
