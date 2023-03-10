import EventEmitter from 'events'
import { promises as fs } from 'fs'
import { Nereid } from '..'
import { closure, exists } from '../utils'
import { download } from './download'
import { link } from './link'
import { Task } from './task'
import { createFileSource, createHttpSource } from './sources'

declare module '..' {
  namespace Nereid {
    interface Composable {
      retry?: number
    }
  }
}

export interface Source<I = unknown> {
  src: string
  weight?: number
  index?: Nereid.Index<I>
  fetchIndex(index: string): Promise<Nereid.Index<I>>
  task(composable: Nereid.Composable): Task<I>
}

// pause and cancel are only valid for downloading status
export interface State extends EventEmitter {
  status: 'checking' | 'downloading' | 'pause' | 'linking' | 'done' | 'failed' | 'canceled'
  progress: number
  pause(): Promise<void>
  resume(): void
  cancel(): Promise<void>
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

export function sync(srcs: string[], bucket: string, options?: ResolveOptions) {
  options = {
    timeout: 30000,
    checkFileHash: false,
    index: '/nereid.json',
    output: process.cwd() + '/nereid',
    maxTaskCount: 10,
    retry: 3,
    ...options,
  }
  const state = new EventEmitter() as State
  startSync(state, srcs, bucket, options)
  return state
}

function createSource(src: string, options: ResolveOptions) {
  const match = /^(\w+):\/\//.exec(src)
  if (!match) return
  let source: Source
  switch (match[1]) {
    case 'http':
      source = createHttpSource(src, options.timeout, options.output)
      break
    case 'file':
      source = createFileSource(src, options.output)
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

  state.pause = async () => {
    return new Promise(resolve => {
      switch (state.status) {
        case 'checking':
          state.once('download/start', () => state.pause())
          return
        case 'downloading':
          // will check the status in download function
          state.status = 'pause'
          resolve()
          return
        default:
          resolve()
      }
    })
  }
  state.resume = () => {
    if (state.status !== 'pause') return
    state.status = 'downloading'
    next()
  }
  state.cancel = () => {
    return new Promise(resolve => {
      switch (state.status) {
        case 'checking':
          state.once('download/start', () => state.cancel())
          return
        case 'downloading':
          // will check the status in download function, too
          state.status = 'canceled'
          state.emit('internal/download/cancel')
          resolve()
          return
        default:
          resolve()
      }
    })
  }

  const store = `${options.output}/store`
  if (!await exists(store)) {
    await fs.mkdir(store, { recursive: true })
    if (!exists(store)) {
      state.status = 'failed'
      state.emit('error', new Error(`failed to access ${store}`))
      return
    }
  }

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
      source.index = index
      return [index, composables, source] as const
    } catch (error) {
      return null
    }
  })

  const checked = (await Promise.all(checks)).filter(source => source)
  const avaliable = checked.map(source => source[2])

  if (avaliable.length === 0) {
    state.status = 'failed'
    const error = new Error('No source is avaliable.')
    state.emit('check/failed', error)
    state.emit('failed', error)
    return
  }

  const composables = checked[0][1]
  const downloader = download(state, avaliable, composables, options)
  function next() {
    downloader.next().catch(error => {
      state.status = 'failed'
      state.emit('check/failed', error)
      state.emit('failed', error)
    })
  }
  next()
  state.on('download/done', async () => {
    await link(state, checked[0][0], bucket, options)
    if (state.status === 'failed') return
    state.status = 'done'
    state.emit('done')
  })
}
