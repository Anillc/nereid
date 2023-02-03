export namespace Nereid {
  export interface Index {
    version: 1
    hashMode: 'nix'
    bucket: Record<string, Node>
    composables: Composable[]
  }

  export interface Composable {
    hash: string
    size: number
  }

  export type Node = File | Folder

  export interface NodeCommon {
    name: string
    hash: string
    size: number
  }

  export interface File extends NodeCommon {
    type: 'file'
    composables: string[]
  }

  export interface Folder extends NodeCommon {
    type: 'folder'
    files: Node[]
  }
}