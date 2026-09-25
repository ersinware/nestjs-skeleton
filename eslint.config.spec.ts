/**
 * @file eslint.config.spec.ts
 * @description Verifies filesystem alignment and module shared import boundaries against the real ESLint configuration.
 */

import { ESLint, type Linter } from 'eslint';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The two pillars whose folders are declared one by one. `module/` is excluded on purpose:
 * its elements are declared with wildcard patterns that already cover any new bounded
 * context, so nothing there can fall out of sync.
 */
const DECLARED_PILLARS = ['src/core', 'src/shared'] as const;

/**
 * Shape of one entry in the `boundaries/elements` setting. Declared locally rather than
 * imported because the config is a `.mjs` file outside `tsconfig.json`, so it arrives untyped.
 */
type ElementDescriptor = {
    readonly type: string;
    readonly pattern: string;
};

/**
 * Loads `boundaries/elements` out of the real ESLint config.
 *
 * The config is imported through a computed file URL rather than a static path: it lives outside
 * `tsconfig.json`, so a normal import would not type-check, and the project bans relative imports.
 * Reading the actual config — instead of restating its contents here — is the whole point; a test
 * asserting against its own copy of the list would pass forever while the config rotted.
 *
 * @returns Every element descriptor declared in the config.
 */
async function loadElementDescriptors(): Promise<readonly ElementDescriptor[]> {
    const configUrl = pathToFileURL(join(process.cwd(), 'eslint.config.mjs')).href,
        configModule: unknown = await import(/* @vite-ignore */ configUrl);

    if (typeof configModule !== 'object' || configModule === null || !('default' in configModule)) {
        throw new Error('eslint.config.mjs did not export a default config.');
    }

    const blocks = configModule.default;

    if (!Array.isArray(blocks)) {
        throw new Error('The ESLint config default export is not an array of config blocks.');
    }

    for (const block of blocks) {
        const elements = (block as { readonly settings?: Readonly<Record<string, unknown>> } | null)?.settings?.[
            'boundaries/elements'
        ];

        if (Array.isArray(elements)) {
            return elements as ElementDescriptor[];
        }
    }

    throw new Error('No config block declares the "boundaries/elements" setting.');
}

/**
 * Lists the immediate subdirectories of a pillar, which are the folders that must each be declared.
 *
 * @param pillar Pillar path relative to the repository root.
 * @returns The subdirectory names.
 */
function listChildFolders(pillar: string): readonly string[] {
    return readdirSync(join(process.cwd(), pillar), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

describe('boundaries/elements', () => {
    /**
     * A concern is consumed as one thing and therefore owns a barrel; a shelf merely holds
     * concerns and must never have one. That single on-disk fact decides which pattern form
     * the folder needs, so the expected config is derived from the filesystem rather than
     * duplicated from it.
     */
    function expectedPatternFor(pillar: string, folder: string): string {
        const isConcern = existsSync(join(process.cwd(), pillar, folder, 'index.ts'));

        return isConcern ? `${pillar}/${folder}` : `${pillar}/${folder}/*`;
    }

    it('declares every core/ and shared/ folder, in the form its barrel implies', async () => {
        const declaredPatterns = new Set((await loadElementDescriptors()).map((element) => element.pattern)),
            missing: string[] = [];

        for (const pillar of DECLARED_PILLARS) {
            for (const folder of listChildFolders(pillar)) {
                const expected = expectedPatternFor(pillar, folder);

                if (!declaredPatterns.has(expected)) {
                    missing.push(expected);
                }
            }
        }

        // Asserted as a list so a failure names every missing pattern at once, and names the exact
        // string to paste into the config rather than only reporting that something is wrong.
        expect(missing).toEqual([]);
    });

    it('declares no core/ or shared/ pattern whose folder no longer exists', async () => {
        const stale = (await loadElementDescriptors())
            .map((element) => element.pattern)
            .filter((pattern) => DECLARED_PILLARS.some((pillar) => pattern.startsWith(`${pillar}/`)))
            .filter((pattern) => !existsSync(join(process.cwd(), pattern.replace(/\/\*$/, ''))));

        expect(stale).toEqual([]);
    });

    it('gives every capability inside a shelf its own barrel', () => {
        const barrelless: string[] = [];

        for (const pillar of DECLARED_PILLARS) {
            for (const folder of listChildFolders(pillar)) {
                const isShelf = !existsSync(join(process.cwd(), pillar, folder, 'index.ts'));

                if (!isShelf) {
                    continue;
                }

                for (const capability of listChildFolders(`${pillar}/${folder}`)) {
                    if (!existsSync(join(process.cwd(), pillar, folder, capability, 'index.ts'))) {
                        barrelless.push(`${pillar}/${folder}/${capability}`);
                    }
                }
            }
        }

        // A folder inside a shelf that has no index.ts is neither a concern nor a shelf: the
        // `<shelf>/*` pattern makes it an element, so it is reachable at any depth with no barrel
        // to cross. It has to become one or the other.
        expect(barrelless).toEqual([]);
    });
});

describe('module shared boundaries', () => {
    let eslint: ESLint;
    const sharedDirectory = 'src/module/admin/shared';
    const sharedDirectoryExisted = existsSync(sharedDirectory);
    // Real files let the resolver verify boundaries independently of production vocabulary.
    mkdirSync(sharedDirectory, { recursive: true });
    const fixtureDirectory = mkdtempSync(`${sharedDirectory}/boundary-fixture-`);
    const sharedContract = `${fixtureDirectory}/contract`;
    writeFileSync(`${sharedContract}.ts`, 'export type Contract = string;\n');

    afterAll(() => {
        rmSync(fixtureDirectory, { recursive: true });
        if (!sharedDirectoryExisted) {
            rmdirSync(sharedDirectory);
        }
    });

    beforeAll(async () => {
        const config = (await new ESLint().calculateConfigForFile('src/module/admin/shared/probe.ts')) as Linter.Config;

        // Keep the production parser, resolution and boundary settings. Synthetic source paths
        // need no TypeScript program; unrelated style rules would obscure permission failures.
        eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [
                {
                    plugins: config.plugins ?? {},
                    settings: config.settings ?? {},
                    files: ['src/**/*.ts'],
                    languageOptions: {
                        ...config.languageOptions,
                        parserOptions: { project: false, projectService: false },
                    },
                    rules: Object.fromEntries(
                        Object.entries(config.rules ?? {}).filter(
                            ([name]) => name.startsWith('boundaries/') || name === 'import-x/no-unresolved',
                        ),
                    ),
                },
            ],
        });
    });

    const moduleFiles = [
        'domain/aggregate/probe.ts',
        'application/query/probe.ts',
        'infrastructure/adapter/probe.ts',
        'presentation/dto/probe.ts',
        'shared/probe.ts',
        'shared/vocabulary/nested/probe.ts',
        'MODULE.facade.ts',
        'MODULE.module.ts',
    ];
    const cases = [
        ...moduleFiles.flatMap((file) =>
            ['admin', 'user'].map((module) => ({
                from: `src/module/${module}/${file.replace('MODULE', module)}`,
                to: sharedContract,
                allowed: module === 'admin',
            })),
        ),
        ...[
            'src/module/admin/index.ts',
            'src/module/user/index.ts',
            'src/core/http/probe.ts',
            'src/core/cqrs/probe.ts',
            'src/shared/domain/principal/probe.ts',
            'src/instrument.ts',
            'src/tracing.ts',
        ].map((from) => ({ from, to: sharedContract, allowed: false })),
        ...['src/shared/domain/principal', 'src/shared/exception', 'node:crypto'].map((to) => ({
            from: 'src/module/admin/shared/probe.ts',
            to,
            allowed: true,
        })),
        ...[
            'src/module/admin/domain/aggregate/admin.aggregate',
            'src/module/admin/application/query/list-admins/query',
            'src/module/admin/infrastructure/admin.schema',
            'src/module/admin/presentation/dto/response-admin.dto',
            'src/module/admin/admin.facade',
            'src/module/admin/admin.module',
            'src/module/admin',
            'src/module/user',
            'src/core/http',
            'src/core/cqrs',
            'src/shared/domain/principal/permission.enum',
            '@nestjs/common',
        ].map((to) => ({ from: 'src/module/admin/shared/probe.ts', to, allowed: false })),
    ];

    // Type imports and re-exports must not create an alternative route around isolation.
    describe.each(['value import', 'type import', 're-export'])('%s', (syntax) => {
        it.each(cases)('$from → $to (allowed: $allowed)', async ({ from, to, allowed }) => {
            const source =
                syntax === 'value import'
                    ? `import '${to}';`
                    : syntax === 'type import'
                      ? `import type { Contract } from '${to}';`
                      : `export { Contract } from '${to}';`;
            const results = await eslint.lintText(source, { filePath: from });

            expect(results).toHaveLength(1);
            // A denied case must fail for the architectural rule itself, never an unresolved
            // dependency, unclassified path or parser error that accidentally looks like a denial.
            expect(results[0]?.messages.map(({ ruleId }) => ruleId)).toEqual(
                allowed ? [] : ['boundaries/dependencies'],
            );
        });
    });
});
