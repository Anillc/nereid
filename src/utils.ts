import { createReadStream, promises as fsp } from 'fs'
import { createHash } from 'crypto'
import { Nereid } from '.'

export function visit(
  node: Nereid.Node,
  callback: (node: Nereid.Node) => void,
  thiz?: unknown
) {
  callback.apply(thiz, callback)
  if (node.type === 'folder') {
    node.files.forEach(file => visit(file, callback, thiz))
  }
}

export async function visitAsync(
  node: Nereid.Node,
  callback: (node: Nereid.Node) => Promise<void>,
  thiz?: unknown
) {
  await callback.apply(thiz, callback)
  if (node.type === 'folder') {
    for (const file of node.files) {
      await visitAsync(file, callback, thiz)
    }
  }
}

export function closure(index: Nereid.Index<unknown>, bucket: string, hash?: string) {
  const node = index?.buckets?.[bucket]
  if (!node) return
  // a not and a logical implication (<=)
  if (!!hash > (node.hash === hash)) return
  const composables = new Set<string>()
  visit(node, node => {
    if (node.type === 'file') {
      node.composables.forEach(composable => composables.add(composable))
    }
  })
  return index.composables.filter(composable => composables.has(composable.hash))
}

export async function *select<T>(promises: Promise<T>[]) {
  const channels = promises.map(async (promise, i) => [await promise, i] as const)
  while (channels.length != 0) {
    const [fast, i] = await Promise.race(channels)
    channels.splice(i, 1)
    yield fast
  }
}

export function sample<T extends { weight?: number }>(array: T[]): T {
  const weight = array.map(element => element.weight)
  for (let i = 1; i < weight.length; i++) {
    weight[i] += weight[i - 1]
  }
  const random = Math.random() * weight[weight.length - 1]
  return array.find((_, i) => weight[i] > random)
}

export function zip<T, U>(ts: T[], us: U[]): [T, U][] {
  const length = Math.min(ts.length, us.length)
  const result: [T, U][] = []
  for (let i = 0; i < length; i++) {
    result.push([ts[i], us[i]])
  }
  return result
}

export async function nixHashFile(file: string) {
  const stream = createReadStream(file)
  const sha256 = createHash('sha256')
  stream.pipe(sha256)
  await new Promise(resolve => stream.on('close', resolve))
  return nixHash(sha256.digest('hex'))
}

export async function nixHashText(text: string) {
  const sha256 = createHash('sha256')
  sha256.update(text)
  return nixHash(sha256.digest('hex'))
}

const base32Chars = '0123456789abcdfghijklmnpqrsvwxyz'
function nixHash(sha256: string) {
  const description = `source:sha256:${sha256}:/nereid/store`
  const hash = createHash('sha256').update(description).digest()
  const hashSize = 20
  const truncation = Buffer.alloc(hashSize)
  for (let i = 0; i < 32; i++) {
    truncation[i % hashSize] ^= hash[i]
  }
  let result = ''
  for (let n = 32 - 1; n >= 0; n--) {
    const b = n * 5
    const i = Math.floor(b / 8)
    const j = b % 8
    const c =
      (truncation[i] >> j)
      | (i >= hashSize - 1 ? 0 : truncation[i + 1] << (8 - j))
    result += base32Chars[c & 0x1f]
  }
  return result
}

export async function validate(path: string, hash: string, mode: string) {
  if (mode !== 'nix') throw new Error('unsupported hash mode')
  const result = await nixHashFile(path)
  return result === hash
}

export async function exists(path: string) {
  try {
    await fsp.access(path, fsp.constants.F_OK | fsp.constants.W_OK)
    return true
  } catch (e) {
    return false
  }
}
