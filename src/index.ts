export namespace Nereid {
  export interface Index<I> {
    version: 1
    hashMode: 'nix'
    buckets: Record<string, Node>
    composables: Composable[]
    data: I
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
    perm: number
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