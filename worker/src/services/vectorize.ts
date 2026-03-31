import type { Env, NoteMetadata } from '../types'

export async function insertVector(
  env: Env,
  id: string,
  values: number[],
  metadata: NoteMetadata
): Promise<void> {
  await env.PI_VECTORS.upsert([{ id, values, metadata: metadata as unknown as Record<string, VectorizeVectorMetadata> }])
}

export async function queryVectors(
  env: Env,
  values: number[],
  topK: number = 3
): Promise<Array<{ id: string; score: number; metadata: NoteMetadata }>> {
  const results = await env.PI_VECTORS.query(values, {
    topK,
    returnValues: false,
    returnMetadata: 'all',
  })

  return results.matches.map((match) => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata as unknown as NoteMetadata,
  }))
}

export async function deleteVector(env: Env, id: string): Promise<void> {
  await env.PI_VECTORS.deleteByIds([id])
}

export async function getVectorsByIds(
  env: Env,
  ids: string[]
): Promise<Array<{ id: string; metadata: NoteMetadata }>> {
  const results = await env.PI_VECTORS.getByIds(ids)

  return results.map((v) => ({
    id: v.id,
    metadata: v.metadata as unknown as NoteMetadata,
  }))
}
