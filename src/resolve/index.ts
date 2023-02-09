import EventEmitter from 'events'
import { promises as fs } from 'fs'
import { Nereid } from '..'
import { closure, select } from '../utils'
import { createHttpSource } from './http'
import { download } from './download'
import { link } from './link'

declare module '..' {
  namespace Nereid {
    interface Composable {
      retry: number
    }
  }
}

export interface Source<I = unknown> {
  src: string
  weight?: number
  fetchIndex(index: string): Promise<Nereid.Index<I>>
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

export interface State extends EventEmitter {
  status: 'checking' | 'downloading' | 'linking' | 'done' | 'failed'
  progress: number
  pause(): void
  resume(): void
  cancel(): void
}

export interface ResolveOptions {
  timeout?: number
  checkFileHash?: boolean
  index?: string
  output?: string
  maxTaskCount?: number
  hash?: string
  retry?: number
}

export function sync(srcs: string[], bucket: string, options: ResolveOptions) {
  options = {
    timeout: 30000,
    checkFileHash: false,
    index: '/nereid.json',
    output: process.cwd() + '/nered',
    maxTaskCount: 10,
    retry: 3,
    ...options,
  }
  const state = new EventEmitter() as State
  startSync(state, srcs, bucket, options)
  return state
}

function createSource(src: string, options: ResolveOptions) {
  const match = /^(\w+):\/\//
  if (!match) return
  let source: Source
  switch (match[1]) {
    case 'http':
      source = createHttpSource(src, options.timeout, options.output)
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
  type CheckResult = readonly [Nereid.Index<unknown>, Nereid.Composable[], Source]
  const checks: Promise<CheckResult>[] = sources.map(async source => {
    try {
      const index = await source.fetchIndex(options.index)
      const composables = closure(index, bucket, options.hash)
      if (!composables) return null
      return [index, composables, source] as const
    } catch (error) {
      return null
    }
  })

  try {
    await fs.access(options.output, fs.constants.F_OK | fs.constants.W_OK)
  } catch (e) {
    await fs.mkdir(`${options.output}/store`, { recursive: true })
    await fs.access(options.output, fs.constants.F_OK | fs.constants.W_OK)
  }

  const checker = select(checks)
  let checkResult: IteratorResult<CheckResult>
  while (!(checkResult = await checker.next()).done) {
    if (checkResult.value) break
  }
  if (!checkResult) {
    state.status = 'failed'
    const error = new Error('No source is avaliable.')
    state.emit('check/failed', error)
    state.emit('failed', error)
    return
  }

  const checked = (await Promise.all(checks)).filter(source => source)
  const avaliable = checked.map(source => source[2])
  const composables = checked[0][1]
  await download(state, avaliable, composables, options)
  await link()
}
