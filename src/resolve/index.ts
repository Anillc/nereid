import { Nereid } from '..'
import { closure, sample, select, zip } from '../utils'
import { createHttpSource } from './http'

export interface Source {
  src: string
  weight?: number
  fetchIndex(index: string): Promise<Nereid.Index>
  task(composable: Nereid.Composable): Task
}

export interface Task {
  status: 'downloading' | 'pause' | 'failed' | 'done'
  source: Source
  composable: Nereid.Composable,
  downloaded: number
  start(start?: number): void
  stop(): void
  pause(): void
  promise(): Promise<Task>
}

export interface State {
  status: 'checking' | 'downloading' | 'linking' | 'done' | 'failed'
  progress: number
  pause(): void
  resume(): void
  cancel(): void
  callback?: (message: string) => void
}

export interface ResolveOptions {
  timeout?: number
  checkFileHash?: boolean
  index?: string
  output?: string
  maxTaskCount?: number
}

export function sync(srcs: string[], bucket: string, options: ResolveOptions) {
  options = {
    timeout: 30000,
    checkFileHash: false,
    index: '/nereid.json',
    output: process.cwd() + '/nered',
    maxTaskCount: 10,
    ...options,
  }
  const state = {} as State
  startSync(state, srcs, bucket, options)
  return state
}

function createSource(src: string, options: ResolveOptions) {
  const match = /^(\w+):\/\//
  if (!match) return
  let source: Source
  switch (match[1]) {
    case 'http':
      source = createHttpSource(src, options.timeout)
      break
    default:
      return
  }
  source.weight = 10
  return source
}

async function startSync(state: State, srcs: string[], bucket: string, options: ResolveOptions) {
  state.status = 'checking'
  state.progress = 0
  // TODO: functions

  const sources = srcs
    .map(src => createSource(src, options))
    .filter(src => {
      if (!src) console.warn(`unsupported source ${src}`)
      return src
    })
  type CheckResult = readonly [Nereid.Index, Nereid.Composable[], Source]
  const checks: Promise<CheckResult>[] = sources.map(async source => {
    try {
      const index = await source.fetchIndex(options.index)
      const composables = closure(index, bucket)
      if (!composables) return null
      return [index, composables, source] as const
    } catch (error) {
      return null
    }
  })

  const checker = select(checks)
  let checkResult: IteratorResult<CheckResult>
  while (!(checkResult = await checker.next()).done) {
    if (checkResult.value) break
  }
  if (!checkResult) {
    state.status = 'failed'
    state.callback?.('No source is avaliable.')
    return
  }

  const checked = (await Promise.all(checks)).filter(source => source)
  const avaliable = checked.map(source => source[2])
  const composables = checked[0][1]
  await download(avaliable, composables, options)
}

async function download(
  sources: Source[],
  composables: Nereid.Composable[],
  options: ResolveOptions
) {
  const tasks: Task[] = []
  const done: Task[] = []
  while (composables.length !== 0) {
    while (tasks.length < options.maxTaskCount && composables.length !== 0) {
      const source = sample(sources)
      tasks.push(source.task(composables.shift()))
    }

    const [task, i] = await Promise.race(tasks.map(async (task, i) =>
      [await task.promise(), i] as const))
    switch (task.status) {
      case 'failed':
        tasks.splice(i, 1)
        task.source.weight -= 1
        composables.push(task.composable)
        break
      case 'done':
        tasks.splice(i, 1)
        done.push(task)
        task.source.weight += 1
        break
      case 'pause':
        // do nothing
        break
      default:
        throw new Error('Unknown error.')
    }
  }
}