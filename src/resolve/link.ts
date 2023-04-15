import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { ResolveOptions, State } from '.'
import { Nereid } from '..'
import { exists, validate } from '../utils'

export async function link(
  state: State,
  index: Nereid.Index<unknown>,
  bucket: string,
  options: ResolveOptions,
) {
  state.emit('link/start')
  const root = index.buckets[bucket]
  try {
    await buildBucket(root, options.output, options, index.hashMode)
  } catch (error) {
    state.status = 'failed'
    state.emit('link/failed', error)
    state.emit('failed', error)
  }
  state.emit('link/done')
}

// TODO: write to tmp and move
async function buildBucket(
  node: Nereid.Node,
  prefix: string,
  options: ResolveOptions,
  hashMode: string
) {
  const path = `${prefix}/${node.name}`
  if (await exists(path)) return
  if (node.type === 'folder') {
    await fsp.mkdir(path)
    for (const child of node.files) {
      await buildBucket(child, path, options, hashMode)
    }
  } else if (node.type === 'file') {
    await writeFile(path, node.composables, options, node.hash, hashMode)
  } else if (node.type === 'symlink') {
    await fsp.symlink(node.to, path)
  } else {
    throw new Error(`Unsupported file type ${node['type']}`)
  }
  if (node.perm) {
    await fsp.chmod(path, node.perm)
  }
}

async function writeFile(
  path: string,
  composables: string[],
  options: ResolveOptions,
  hash: string,
  hashMode: string,
) {
  const writer = createWriteStream(path)
  for (const composable of composables) {
    const reader = createReadStream(`${options.output}/store/${composable}`)
    reader.pipe(writer, { end: false })
    await new Promise(resolve => reader.on('end', resolve))
  }
  await new Promise(resolve => writer.end(resolve))
  if (options.checkFileHash) {
    const result = await validate(path, hash, hashMode)
    if (!result) throw new Error(`hash mismatched: ${path}`)
  }
}
