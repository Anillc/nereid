import { Nereid } from '..'
import { closure, sample, select } from '../utils'
import { createHttpSource } from './http'

export interface Source {
  src: string
  fetchIndex(index: string): Promise<Nereid.Index>
  task(composable: string): Promise<Task>
}

export interface Task {
  progress: number
  start(start?: number): void
  stop(): void
  pause(): void
  promise(): Promise<void>
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

function createSource(source: string, options: ResolveOptions) {
  const match = /^(\w+):\/\//
  if (!match) return
  switch (match[1]) {
    case 'http':
      return createHttpSource(source, options.timeout)
    default:
      return
  }
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
  type CheckResult = readonly [Nereid.Index, Nereid.Composable[],Source]
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

  const avaliable = (await Promise.all(checks)).filter(source => source)


}