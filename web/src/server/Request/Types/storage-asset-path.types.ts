export type ParsedStorageAssetPath =
    | { kind: 'invalid' }
    | { kind: 'not-storage' }
    | { kind: 'storage'; pathname: string; relativePath: string }
