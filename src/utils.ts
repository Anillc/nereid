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

export function closure(index: Nereid.Index, bucket: string) {
  const node = index?.bucket?.[bucket]
  if (!node) return
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

export function sample<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}