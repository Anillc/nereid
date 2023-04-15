import { build, sync } from '../src'

describe('build', () => {
  it('build', async () => {
    await build('./sample', 'build')
  })

  it('sync', () => new Promise((resolve, reject) => {
    const state = sync(['file://./build'], 'sample')
    state.on('done', () => {
      resolve(null)
    })
    state.on('failed', (error) => {
      reject(error)
    })
  }))
})