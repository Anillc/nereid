import { promises as fsp } from 'fs'
import { Task } from './task'
import { exists, sample, validate } from '../utils'
import { State, Source, ResolveOptions } from '.'
import { Nereid } from '..'

export async function *download<I>(
  state: State,
  sources: Source<I>[],
  composables: Nereid.Composable[],
  options: ResolveOptions
) {
  const total = composables.reduce((acc, x) => acc + x.size, 0)

  state.on('internal/download/cancel', () => {
    if (tasks) tasks.forEach(task => task.stop())
  })
  state.on('internal/download/pause', () => {
    if (tasks) tasks.forEach(task => task.pause())
  })

  state.status = 'downloading'
  state.emit('download/start')
  composables.forEach(composable => composable.retry = options.retry)
  const tasks: Task<unknown>[] = []
  const done: Nereid.Composable[] = []

  state.progress = () => {
    const downloading = tasks.reduce((acc, x) => acc + x.current, 0)
    const downloaded = done.reduce((acc, x) => acc + x.size, 0)
    return (downloading + downloaded) / total
  }

  while (true) {
    while (tasks.length < options.maxTaskCount && composables.length !== 0) {
      const source = sample(sources)
      const composable = composables.shift()
      const path = `${options.output}/store/${composable.hash}`
      if (await exists(path) && await validate(path, composable.hash, source.index.hashMode)) {
        done.push(composable)
        continue
      } else {
        try {
          await fsp.rm(path, { force: true })
        } catch (e) {
          state.status = 'failed'
          state.emit('failed', e)
          return
        }
        tasks.push(source.task(composable))
      }
    }

    if (composables.length + tasks.length === 0) {
      break
    }

    if (state.status as any === 'pause') {
      yield
    }

    if (state.status as any === 'canceled') return

    const resolves: Function[] = []
    const [task, i] = await Promise.race(tasks.map((task, i) => {
      state.emit('download/composable/start', task.composable, task.source)
      return new Promise<[Task<unknown>, number]>(resolve => {
        resolves.push(resolve)
        task.promise().then(() => { resolve([task, i]) })
      })
    })).finally(() => {
      // resolve all promises to avoid memory leak
      resolves.forEach(resolve => resolve())
    })

    let retry = false
    switch (task.status) {
      case 'failed':
        tasks.splice(i, 1)
        task.source.weight -= 1
        retry = true
        break
      case 'done':
        tasks.splice(i, 1)
        const path = `${options.output}/store/${task.composable.hash}`
        if (await validate(path, task.composable.hash, task.source.index.hashMode)) {
          done.push(task.composable)
          task.source.weight += 1
          state.emit('download/composable/done', task.composable, task.source)
        } else {
          try {
            await fsp.rm(path, { force: true })
          } catch (e) {
            state.status = 'failed'
            state.emit('failed', e)
            return
          }
          retry = true
        }
        break
      // case 'pause':
      // case 'downloading':
      //   // do nothing
      // default:
      //   // unreachable
    }
    if (retry) {
      if (task.composable.retry <= 0) {
        state.status = 'failed'
        const error = new Error(`Failed to download ${task.composable.hash}`)
        state.emit('download/failed', error)
        state.emit('failed', error)
        return
      } else {
        task.current = 0
        task.composable.retry--
        composables.push(task.composable)
        state.emit('download/composable/retry', task.composable, task.source)
      }
    }
  }
  state.status = 'done'
  state.emit('download/done')
}
