import { State, Source, ResolveOptions, Task } from '.'
import { Nereid } from '..'
import { sample } from '../utils'

export async function* download<I>(
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
  const done: Task[] = []
  while (composables.length !== 0) {
    while (tasks.length < options.maxTaskCount && composables.length !== 0) {
      const source = sample(sources)
      tasks.push(source.task(composables.shift()))
    }

    if (state.status as any === 'pause') {
      tasks.forEach(task => task.pause())
      yield
    }
    if (state.status as any === 'canceled') return

    const resolves: Function[] = []
    const [task, i] = await Promise.any(tasks.map((task, i) => {
      state.emit('download/composable/start', task.composable, task.source)
      return new Promise<[Task, number]>((resolve, reject) => {
        resolves.push(resolve)
        task.promise()
          .then(task => { resolve([task, i]) })
          .catch(reject)
      })
    }))
    // resolve all promises to avoid memory leak
    resolves.forEach(resolve => resolve())

    switch (task.status) {
      case 'failed':
        tasks.splice(i, 1)
        task.source.weight -= 1
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
        break
      case 'done':
        tasks.splice(i, 1)
        done.push(task)
        task.source.weight += 1
        state.emit('download/composable/done', task.composable, task.source)
        break
      case 'pause':
        // do nothing
        break
      default:
        throw new Error('Unknown error.')
    }
  }
  state.status = 'done'
  state.emit('download/done')
}
