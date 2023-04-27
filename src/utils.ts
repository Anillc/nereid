import { createReadStream, promises as fsp } from 'fs'
import { createHash } from 'crypto'
import { Duplex } from 'stream'
import { Nereid } from '.'

export function visit<T>(
  node: Nereid.Node & T,
  callback: (node: Nereid.Node & T) => void,
  after = false,
  thiz?: unknown,
) {
  if (!after) callback.apply(thiz, [node])
  if (node.type === 'folder') {
    node.files.forEach(file => visit(file, callback, after, thiz))
  }
  if (after) callback.apply(thiz, [node])
}

export async function visitAsync<T>(
  node: Nereid.Node & T,
  callback: (node: Nereid.Node & T) => Promise<void>,
  after = false,
  thiz?: unknown,
) {
  if (!after) await callback.apply(thiz, [node])
  if (node.type === 'folder') {
    for (const file of node.files) {
      await visitAsync(file, callback, after, thiz)
    }
  }
  if (after) await callback.apply(thiz, [node])
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

export async function hashFile(file: string, mode: string) {
  if (mode !== 'nix') throw new Error('Unsupported hash mode')
  const stream = createReadStream(file)
  const sha256 = createHash('sha256')
  stream.pipe(sha256)
  await new Promise(resolve => stream.on('close', resolve))
  return nixHash(sha256.digest('hex'))
}

export function hashText(text: string | Buffer, mode: string) {
  if (mode !== 'nix') throw new Error('Unsupported hash mode')
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
  const result = await hashFile(path, mode)
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

export class DummyWriter extends Duplex {
  promise: Promise<Buffer>
  reject: (error: Error) => void
  private resolve: (buffer: Buffer) => void
  private chunks: Buffer[] = []

  constructor() {
    super()
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    this.on('close', () => this.resolve(Buffer.concat(this.chunks)))
    this.on('error', this.reject)
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  _read() {
    this.push(null)
  }

  count() {
    return this.chunks.reduce((acc, x) => acc + x.length, 0)
  }
}
