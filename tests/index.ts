// import { build, sync } from '../src'

// describe('build', () => {
//   it('build', async () => {
//     await build('./sample/a', 'build')
//     await build('./sample/b', 'build')
//   })

//   it('sync', () => new Promise((resolve, reject) => {
//     const state = sync(['file://./build'], 'b')
//     state.on('done', () => {
//       resolve(null)
//     })
//     state.on('failed', (error) => {
//       reject(error)
//     })
//   }))
// })