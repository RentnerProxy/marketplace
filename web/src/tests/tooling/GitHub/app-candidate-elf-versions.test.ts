import { describe, expect, test } from 'bun:test'
import {
    libraryDefinitions,
    verifyApplianceLinkage,
} from '../../../../../.github/scripts/ci/app-candidates/elf-appliance.ts'
import {
    inspectCandidateLinkage,
    type ElfLinkage,
} from '../../../../../.github/scripts/ci/app-candidates/elf.ts'

const loader = 'ld-linux-x86-64.so.2'
const interpreter = `/lib64/${loader}` as const
const available = new Map([
    [loader, new Set(['GLIBC_2.41'])],
    [
        'libc.so.6',
        new Set(['GLIBC_2.41', 'GLIBC_ABI_DT_RELR', 'GLIBC_PRIVATE']),
    ],
    ['libstdc++.so.6', new Set(['GLIBCXX_3.4.33', 'CXXABI_1.3.15'])],
    ['libgcc_s.so.1', new Set(['GCC_13.0.0'])],
])

function versionedLinkage(library: string, ...versions: string[]): ElfLinkage {
    return {
        interpreter,
        needed: [library],
        versions: new Map([[library, new Set(versions)]]),
    }
}

function executableWithVersion() {
    const bytes = Buffer.alloc(576)
    const base = 0x400000n
    bytes.write('\x7fELF')
    bytes.set([2, 1, 1, 0], 4)
    bytes.writeUInt16LE(3, 16)
    bytes.writeUInt16LE(62, 18)
    bytes.writeUInt32LE(1, 20)
    bytes.writeBigUInt64LE(base + 100n, 24)
    bytes.writeBigUInt64LE(64n, 32)
    bytes.writeUInt16LE(64, 52)
    bytes.writeUInt16LE(56, 54)
    bytes.writeUInt16LE(3, 56)

    function segment(
        index: number,
        type: number,
        offset: number,
        length: number,
    ) {
        const header = 64 + 56 * index
        bytes.writeUInt32LE(type, header)
        bytes.writeUInt32LE(type === 1 ? 5 : 4, header + 4)
        bytes.writeBigUInt64LE(BigInt(offset), header + 8)
        bytes.writeBigUInt64LE(base + BigInt(offset), header + 16)
        bytes.writeBigUInt64LE(BigInt(length), header + 32)
        bytes.writeBigUInt64LE(BigInt(length), header + 40)
    }
    const strings = 'libstdc++.so.6\0GLIBCXX_3.4.33\0libgcc_s.so.1\0'
    segment(0, 1, 0, bytes.length)
    segment(1, 3, 0xe8, interpreter.length + 1)
    segment(2, 2, 0x110, 6 * 16)
    bytes.write(interpreter, 0xe8)
    bytes.write(strings, 0x180)
    for (const [index, [tag, value]] of [
        [5n, base + 0x180n],
        [10n, BigInt(strings.length)],
        [1n, 0n],
        [0x6ffffffen, base + 0x1c0n],
        [0x6fffffffn, 1n],
        [0n, 0n],
    ].entries()) {
        bytes.writeBigUInt64LE(tag, 0x110 + 16 * index)
        bytes.writeBigUInt64LE(value, 0x118 + 16 * index)
    }
    bytes.writeUInt16LE(1, 0x1c0) // vn_version
    bytes.writeUInt16LE(1, 0x1c2) // vn_cnt
    bytes.writeUInt32LE(16, 0x1c8) // vn_aux
    bytes.writeUInt32LE(0x0297f843, 0x1d0) // ELF hash of GLIBCXX_3.4.33
    bytes.writeUInt16LE(2, 0x1d6) // vna_other
    bytes.writeUInt32LE(strings.indexOf('GLIBCXX'), 0x1d8) // vna_name
    return bytes
}

describe('ELF versions in the pinned appliance', () => {
    test('accepts available glibc, C++, GCC and loader ABI names', () => {
        verifyApplianceLinkage(
            versionedLinkage('libc.so.6', 'GLIBC_2.41', 'GLIBC_ABI_DT_RELR'),
            available,
        )
        verifyApplianceLinkage(
            versionedLinkage(
                'libstdc++.so.6',
                'GLIBCXX_3.4.33',
                'CXXABI_1.3.15',
            ),
            available,
        )
        verifyApplianceLinkage(
            versionedLinkage('libgcc_s.so.1', 'GCC_13.0.0'),
            available,
        )
    })

    test.each([
        ['libstdc++.so.6', 'GLIBCXX_3.4.99'],
        ['libstdc++.so.6', 'CXXABI_9.9'],
        ['libgcc_s.so.1', 'GCC_99.0.0'],
        ['libgcc_s.so.1', 'GLIBCXX_3.4.33'],
        ['libc.so.6', 'GLIBC_2.42'],
        ['libc.so.6', 'GLIBC_PRIVATE'],
        ['libc.so.6', 'UNRECOGNIZED_ABI_1'],
    ])('rejects unavailable %s versions', (library, version) => {
        expect(() =>
            verifyApplianceLinkage(
                versionedLinkage(library, version),
                available,
            ),
        ).toThrow('version is unavailable')
    })

    test('rejects a missing library even without a named symbol version', () => {
        expect(() =>
            verifyApplianceLinkage(
                versionedLinkage('libpthread.so.0'),
                available,
            ),
        ).toThrow('library is missing')
    })

    test('reads loader-visible version requirements without section headers', () => {
        expect(
            inspectCandidateLinkage(executableWithVersion(), 'linux-amd64'),
        ).toEqual(versionedLinkage('libstdc++.so.6', 'GLIBCXX_3.4.33'))
    })

    test('reads separate blocks of version headers and auxiliary records', () => {
        const binary = executableWithVersion()
        binary.writeBigUInt64LE(7n * 16n, 64 + 2 * 56 + 32)
        binary.writeBigUInt64LE(7n * 16n, 64 + 2 * 56 + 40)
        binary.writeBigUInt64LE(2n, 0x158) // DT_VERNEEDNUM
        binary.writeBigUInt64LE(1n, 0x160) // DT_NEEDED (libgcc_s.so.1)
        binary.writeBigUInt64LE(30n, 0x168)
        binary.copy(binary, 0x1e0, 0x1d0, 0x1e0)
        binary.copy(binary, 0x1f0, 0x1d0, 0x1e0)
        binary.writeUInt32LE(32, 0x1c8) // First vn_aux follows both headers.
        binary.writeUInt32LE(16, 0x1cc) // First vn_next points at the second header.
        binary.fill(0, 0x1d0, 0x1e0)
        binary.writeUInt16LE(1, 0x1d0)
        binary.writeUInt16LE(1, 0x1d2)
        binary.writeUInt32LE(30, 0x1d4)
        binary.writeUInt32LE(32, 0x1d8)
        binary.writeUInt16LE(3, 0x1f6)
        const linkage = inspectCandidateLinkage(binary, 'linux-amd64')
        expect(linkage?.needed).toEqual(['libstdc++.so.6', 'libgcc_s.so.1'])
        expect(linkage?.versions.get('libgcc_s.so.1')).toEqual(
            new Set(['GLIBCXX_3.4.33']),
        )
    })

    test('rejects version metadata inconsistent with dynamic dependencies', () => {
        const binary = executableWithVersion()
        binary.writeUInt32LE(30, 0x1c4)
        expect(() => inspectCandidateLinkage(binary, 'linux-amd64')).toThrow(
            'Invalid ELF version dependency record',
        )
    })

    test('matches the provider SONAME and reads definitions independently from its dependencies', () => {
        const sections = ` 0x000000000000000e (SONAME) Library soname: [libstdc++.so.6]
Version definition section '.gnu.version_d' contains 3 entries:
 Addr: 0x0000000000000050  Offset: 0x00000050  Link: 5 (.dynstr)
  000000: Rev: 1  Flags: BASE  Index: 1  Cnt: 1  Name: libstdc++.so.6
  0x001c: Rev: 1  Flags: none  Index: 2  Cnt: 1  Name: GLIBCXX_3.4.33
  0x0038: Rev: 1  Flags: none  Index: 3  Cnt: 1  Name: CXXABI_1.3.15

Version needs section '.gnu.version_r' contains 1 entry:
  000000: Version: 1  File: libc.so.6  Cnt: 1
  0x0010:   Name: GLIBC_2.41  Flags: none  Version: 4
`
        expect(libraryDefinitions(sections, 'libstdc++.so.6')).toEqual(
            new Set(['GLIBCXX_3.4.33', 'CXXABI_1.3.15']),
        )
        expect(() => libraryDefinitions(sections, 'libc.so.6')).toThrow(
            'version definitions',
        )
    })
})
