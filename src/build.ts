import { promises as fsp, Stats } from 'fs'
import { basename, resolve } from 'path'
import { Nereid } from '.'
import { hashFile, hashText, visitAsync } from './utils'

export interface BuildOptions {
  hashMode: 'nix'
  chunkSize: number
  parallel: number
}

export async function build(src: string, dst: string, bucket: string, options?: BuildOptions) {
  options = {
    hashMode: 'nix',
    // 10MiB
    chunkSize: 10 * 1024 * 1024,
    ...options,
  }
  const output = `${dst}/composables`
  await fsp.mkdir(output, { recursive: true })
  const map = new Map<string, Nereid.Composable>()
  const root = await buildTree(src, output, map, options)
}

async function buildTree(
  path: string,
  output: string,
  map: Map<string, Nereid.Composable>,
  options: BuildOptions
): Promise<Nereid.Node> {
  const name = basename(path)
  const stat = await fsp.stat(path)
  if (stat.isFile()) {
    const hash = await hashFile(path, options.hashMode)
    const composables = await buildComposables(path, stat, output, map, options)
    return {
      name, hash,
      size: stat.size,
      perm: stat.mode,
      type: 'file',
      composables,
    }
  } else if (stat.isDirectory()) {
    const files = await fsp.readdir(path)
    const results: Nereid.Node[] = []
    for (const file of files) {
      results.push(await buildTree(resolve(path, file), output, map, options))
    }
    const hashes = results.map(file => file.hash).sort()
    const hash = hashText(hashes.join(''), options.hashMode)
    return {
      name, hash,
      size: results.reduce((acc, x) => acc + x.size, 0),
      perm: stat.mode,
      type: 'folder',
      files: results,
    }
  } else {
    throw new Error(`Unsupported file type ${path}`)
  }
}

async function buildComposables(
  path: string,
  stat: Stats,
  output: string,
  map: Map<string, Nereid.Composable>,
  options: BuildOptions,
) {
  const { chunkSize } = options
  const results = new Set<string>
  const count = Math.floor(stat.size / chunkSize)
  const rest = stat.size % chunkSize
  const fd = await fsp.open(path, 'r')

  for (let i = 0; i < count; i++) {
    const position = i * chunkSize
    const buffer = Buffer.allocUnsafe(chunkSize)
    let read = 0
    while (read < chunkSize) {
      const { bytesRead } = await fd.read({
        buffer, position,
        offset: read,
        length: chunkSize - read,
      })
      read += bytesRead
    }
    const hash = hashText(buffer, options.hashMode)
    map[hash] = { hash, size: chunkSize }
    results.add(hash)
    await fsp.writeFile(`${output}/${hash}`, buffer)
  }

  const buffer = Buffer.allocUnsafe(rest)
  let read = 0
  while (read < rest) {
    const { bytesRead } = await fd.read({
      buffer,
      offset: read,
      length: rest - read,
      position: count * chunkSize,
    })
    read += bytesRead
  }
  const hash = hashText(buffer, options.hashMode)
  map[hash] = { hash, size: chunkSize }
  results.add(hash)
  await fsp.writeFile(`${output}/${hash}`, buffer)

  return [...results]
}