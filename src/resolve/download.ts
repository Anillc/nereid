import { promises as fsp } from 'fs'
import { State, Source, ResolveOptions, Task } from '.'
import { Nereid } from '..'
import { exists, sample, validate } from '../utils'

export async function *download<I>(
  state: State,
  sources: Source<I>[],
  composables: Nereid.Composable[],
  options: ResolveOptions
) {
  state.on('internal/download/cancel', () => {
    if (tasks) tasks.forEach(task => task.stop())
  })

  state.status = 'downloading'
  state.emit('download/start')
  composables.forEach(composable => composable.retry = options.retry)
  const tasks: Task[] = []
  const done: Nereid.Composable[] = []
  while (composables.length !== 0 && tasks.length !== 0) {
    while (tasks.length < options.maxTaskCount && composables.length !== 0) {
      const source = sample(sources)
      const composable = composables.shift()
      const path = `${options.output}/store/${composable.hash}`
      if (await exists(path) && validate(path, composable.hash, source.index.hashMode)) {
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

    if (state.status as any === 'pause') {
      tasks.forEach(task => task.pause())
      yield
    }
    if (state.status as any === 'canceled') return

    const resolves: Function[] = []
    const [task, i] = await Promise.race(tasks.map((task, i) => {
      state.emit('download/composable/start', task.composable, task.source)
      return new Promise<[Task, number]>(resolve => {
        resolves.push(resolve)
        task.promise().then(task => { resolve([task, i]) })
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
        if (validate(path, task.composable.hash, task.source.index.hashMode)) {
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
      // default:
      //   // unreachable
    }
    if (task.composable.retry <= 0) {
      state.status = 'failed'
      const error = new Error(`Failed to download ${task.composable.hash}`)
      state.emit('download/failed', error)
      state.emit('failed', error)
      return
    } else {
      task.composable.retry--
      composables.push(task.composable)
      state.emit('download/composable/retry', task.composable, task.source)
    }
  }
  state.status = 'done'
  state.emit('download/done')
}
