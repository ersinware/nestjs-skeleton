/**
 * @file eslint.config.spec.ts
 * @description Verifies that `boundaries/elements` in eslint.config.mjs still describes the folders actually on disk under core/ and shared/.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

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
    type: string;
    pattern: string;
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
async function loadElementDescriptors(): Promise<ElementDescriptor[]> {
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
        const elements = (block as { settings?: Record<string, unknown> } | null)?.settings?.['boundaries/elements'];

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
function listChildFolders(pillar: string): string[] {
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
