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
  const path = await buildBucket(root, options.output, options, index.hashMode, bucket)
  state.emit('link/done')
  return path
}

// TODO: write to tmp and move
async function buildBucket(
  node: Nereid.Node,
  prefix: string,
  options: ResolveOptions,
  hashMode: string,
  top: string,
): Promise<string> {
  const path = top ? `${prefix}/${top}` : `${prefix}/${node.name}`
  if (await exists(path)) return path
  if (node.type === 'folder') {
    await fsp.mkdir(path)
    for (const child of node.files) {
      await buildBucket(child, path, options, hashMode, null)
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
  return path
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
