import eslint from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Relative imports hide where a file sits in the architecture and break on every move.
 * Declared once because every block that narrows `no-restricted-imports` must re-state it.
 */
const RELATIVE_IMPORT_PATTERN = {
    /** `.` and `..` address a folder's own `index.ts` without a path segment, so the globs alone miss them. */
    group: ['.', '..', './*', '../*'],
    message: 'Relative imports are not allowed. Please use absolute imports starting with "src/" or "test/".',
};

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            '.act-artifacts/**',
            '.vitest-cache/**',
            '.vitest-cache-e2e/**',
            'node_modules/**',
            'coverage/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        /**
         * These files are outside `tsconfig.json`'s `include`. Disabling only the type-checked
         * rules keeps them linted — adding them to
         * `ignores` instead would exempt them from every rule.
         */
        files: ['eslint.config.mjs', '.lintstagedrc.js', 'script/spectral-unicode.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            parserOptions: {
                project: null,
                projectService: false,
            },
        },
    },
    {
        /**
         * Scoped to `src/` only: `test/` has no element definitions yet, so `no-unknown-files` would
         * reject every test file. See the TODO in agent/testing.md#testing-rules.
         */
        files: ['src/**/*.ts'],
        plugins: {
            boundaries,
            'import-x': importX,
        },
        settings: {
            /**
             * `shared` and `core` are declared at their CONCERN ROOTS, not as `**` globs: the barrel
             * rule below measures `internalPath` from the matched root, so a wrong root mis-locates
             * the door. Shelves (`core/security`, `shared/domain`, …) never appear here — only the
             * capabilities inside them do.
             */
            'boundaries/elements': [
                { type: 'shared', pattern: 'src/shared/domain/*' },
                { type: 'shared', pattern: 'src/shared/application/*' },
                { type: 'shared', pattern: 'src/shared/exception' },
                { type: 'shared', pattern: 'src/shared/pagination' },
                { type: 'shared', pattern: 'src/shared/search' },
                { type: 'core', pattern: 'src/core/observability/*' },
                { type: 'core', pattern: 'src/core/security/*' },
                { type: 'core', pattern: 'src/core/cache' },
                { type: 'core', pattern: 'src/core/redis' },
                { type: 'core', pattern: 'src/core/config' },
                /**
                 * The CQRS pipeline is its OWN element, not a plain `core` concern: it is the one
                 * core surface a `facade` may import (QueryPipeline/CommandPipeline), and nothing
                 * else in `core`. A dedicated type lets the facade rule allow exactly this door
                 * (`coreCqrs`) instead of opening all of `core` to facades.
                 */
                { type: 'coreCqrs', pattern: 'src/core/cqrs' },
                { type: 'core', pattern: 'src/core/database' },
                { type: 'core', pattern: 'src/core/doc' },
                { type: 'core', pattern: 'src/core/email' },
                { type: 'core', pattern: 'src/core/event-bus' },
                { type: 'core', pattern: 'src/core/exception' },
                { type: 'core', pattern: 'src/core/http' },
                { type: 'bootstrap', pattern: 'src/{instrument,tracing}.ts', mode: 'file' },
                { type: 'moduleIndex', pattern: 'src/module/*/index.ts', mode: 'file', capture: ['module'] },
                { type: 'facade', pattern: 'src/module/*/*.facade.ts', mode: 'file', capture: ['module'] },
                { type: 'module', pattern: 'src/module/*/*.module.ts', mode: 'file', capture: ['module'] },
                { type: 'domain', pattern: 'src/module/*/domain/**', capture: ['module'] },
                { type: 'application', pattern: 'src/module/*/application/**', capture: ['module'] },
                { type: 'infrastructure', pattern: 'src/module/*/infrastructure/**', capture: ['module'] },
                { type: 'presentation', pattern: 'src/module/*/presentation/**', capture: ['module'] },
            ],
            'boundaries/ignore': ['src/main.ts', 'src/app.module.ts'],
            /**
             * Without this mapping the graph rules cannot parse `.ts` dependency files: the graph
             * they build is EMPTY and every one of them — `no-cycle` above all — passes silently.
             * A green run is therefore NOT evidence the graph exists; only a deliberate cycle is.
             */
            'import-x/parsers': {
                '@typescript-eslint/parser': ['.ts', '.mts', '.cts'],
            },
            /**
             * `resolver-next` is the v3 resolver interface: one `ResolverFactory` built once and
             * reused, instead of v2's per-edge resolution. `no-cycle` resolves every edge of the
             * graph for every file, so this is the difference between a ~72s and a ~24s cold run.
             */
            'import-x/resolver-next': [
                createTypeScriptImportResolver({
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                }),
            ],
            /**
             * NOT dead settings, and NOT a duplicate of the two above: `eslint-plugin-boundaries`
             * carries its own `eslint-module-utils` and requires `eslint-module-utils/resolve`
             * directly, which reads ONLY the legacy `import/*` keys. Delete these and every
             * `boundaries/*` rule silently stops resolving — the failure mode is a passing lint,
             * not an error. They stay on the v2 interface because each boundaries rule resolves a
             * file's own imports once; the per-edge cost that made v2 expensive is `no-cycle`'s.
             */
            'import/parsers': {
                '@typescript-eslint/parser': ['.ts', '.mts', '.cts'],
            },
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                },
            },
        },
        rules: {
            /**
             * Ordered by what each rule protects, most load-bearing first.
             *
             * One rule carries what `dependencies`, `entry-point` and `external` used to split (the
             * latter two are deprecated in v6, gone in v7): WHO may depend on a concern and THROUGH
             * WHICH DOOR are one decision.
             *
             * Rules are LAST-MATCH-WINS, so ordering is load-bearing: broad allowances first, the
             * doctrine-enforcing denials last, where they can override them.
             */
            'boundaries/dependencies': [
                'error',
                {
                    default: 'disallow',
                    /** Without this the rule sees only local elements and every npm import is invisible. */
                    checkAllOrigins: true,
                    rules: [
                        {
                            from: { type: 'shared' },
                            allow: [{ to: { type: 'shared' } }],
                        },
                        {
                            from: { type: 'core' },
                            allow: [{ to: { type: 'shared' } }, { to: { type: 'core' } }],
                        },
                        {
                            /**
                             * The pipeline concern is a core capability: it composes the behaviors
                             * (cache-aside, invalidation) over the framework buses, so it reaches
                             * `core` (e.g. `core/cache`) and `shared` like any other core concern.
                             */
                            from: { type: 'coreCqrs' },
                            allow: [{ to: { type: 'shared' } }, { to: { type: 'core' } }],
                        },
                        {
                            from: { type: 'bootstrap' },
                            allow: [{ to: { type: 'shared' } }, { to: { type: 'core' } }],
                        },
                        {
                            from: { type: 'domain' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'application' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'coreCqrs' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'infrastructure' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'infrastructure', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'moduleIndex' } },
                            ],
                        },
                        {
                            from: { type: 'presentation' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'coreCqrs' } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'presentation', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            /**
                             * A facade dispatches cross-module reads through the QueryPipeline, so it
                             * reaches `coreCqrs` — and ONLY that core surface, never the rest of
                             * `core`. This is the single deliberate widening of the facade's imports.
                             */
                            from: { type: 'facade' },
                            allow: [
                                { to: { type: 'coreCqrs' } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'moduleIndex' },
                            allow: [
                                { to: { type: 'facade', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'module', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'module' },
                            allow: [
                                { to: { type: 'presentation', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'infrastructure', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'facade', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'moduleIndex' } },
                                { to: { type: 'core' } },
                                { to: { type: 'coreCqrs' } },
                                { to: { type: 'shared' } },
                            ],
                        },
                        /**
                         * `checkAllOrigins` put npm packages and Node builtins under `default:
                         * 'disallow'`, so they must be allowed back. Blanket on purpose — vetting the
                         * npm surface per layer is the next rule's job, not this one's.
                         */
                        {
                            from: { type: '*' },
                            allow: [{ to: { origin: 'external' } }, { to: { origin: 'core' } }],
                        },
                        /**
                         * Domain must stay framework-free so a bounded context can be lifted into its
                         * own service without a rewrite. `shared` is held to the same bar because
                         * domain imports it — a package admitted there reaches domain transitively.
                         * Only `external` (npm) is denied; Node builtins stay legal. Subtracts from
                         * the blanket allowance above, so it must come after it.
                         */
                        {
                            from: { type: ['domain', 'shared'] },
                            disallow: [{ to: { origin: 'external' } }],
                            message:
                                'The domain and shared layers are pure TypeScript and must not import any external package (agent/architecture.md#layer-isolation).',
                        },
                        /**
                         * Barrels are BOUNDARIES: reaching past a concern's `index.ts` re-opens what
                         * the barrel closed. Stated once as a denial over every origin instead of
                         * pinning `internalPath` onto each selector above — one statement cannot be
                         * half-applied when a new selector is added. A concern's own files are
                         * unaffected: `checkInternals` defaults to false.
                         */
                        {
                            to: { type: ['shared', 'core', 'coreCqrs'], internalPath: '!index.ts' },
                            disallow: [{ from: { type: '*' } }],
                            message:
                                'A core/shared concern may only be entered through its index.ts barrel (agent/architecture.md#barrels).',
                        },
                    ],
                },
            ],
            /**
             * The rule above only governs files it can classify; these two close the escape hatches:
             * a file matching no element — exactly how a fourth pillar sneaks in — and a dependency
             * reaching somewhere unclassifiable.
             */
            'boundaries/no-unknown-files': 'error',
            'boundaries/no-unknown': 'error',
            /**
             * `no-unknown` explicitly skips targets in `boundaries/ignore`, so without this rule any
             * file may import `src/main.ts` or `src/app.module.ts` unchecked. The composition roots
             * must see everything; nothing may see them.
             */
            'boundaries/no-ignored': 'error',
            /**
             * The boundary rules reason about the RESOLVED target of an import, so a typo'd path is
             * invisible to all of them rather than a violation. This makes an unresolvable path an
             * error in its own right, so nothing reaches the boundary rules unclassified.
             */
            'import-x/no-unresolved': 'error',
            /**
             * `boundaries` only constrains direction BETWEEN layers; a cycle inside one layer is
             * invisible to it, and `forwardRef()` is prohibited, so nothing else would catch this.
             * `ignoreExternal` costs no coverage — nothing in `node_modules` can import `src/`, so a
             * cycle through our files never leaves `src/` — and skips parsing thousands of
             * dependency files.
             */
            'import-x/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
            /**
             * A devDependency imported from `src/` works everywhere except `npm ci --omit=dev` in the
             * production image, where it dies at container start with MODULE_NOT_FOUND. This moves
             * that failure to the moment the import is written. Co-located `*.spec.ts` files are
             * exempt — the one legitimately dev-only part of `src/`.
             */
            'import-x/no-extraneous-dependencies': ['error', { devDependencies: ['**/*.spec.ts'] }],
            /**
             * The degenerate cycle, and the one `no-cycle` deliberately does NOT cover: it bails on
             * a self-import (`imported.path === filename`) and delegates the case here, so dropping
             * this rule would leave a file importing itself entirely unreported.
             */
            'import-x/no-self-import': 'error',
        },
    },
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [RELATIVE_IMPORT_PATTERN],
                    paths: [
                        {
                            /**
                             * Only the emitter class is banned. `@OnEvent` and `EventEmitterModule`
                             * are the subscribe and wiring sides, which have no port to go through.
                             */
                            name: '@nestjs/event-emitter',
                            importNames: ['EventEmitter2'],
                            message:
                                'Publish through IEventPublisherPort (TOKEN_EVENT_PUBLISHER_PORT) so the transport stays swappable (agent/events-and-messaging.md#events--messaging).',
                        },
                    ],
                },
            ],
        },
    },
    {
        /** The event bus adapter IS the seam that owns the transport, so it is the one legal caller. */
        files: ['src/core/event-bus/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [RELATIVE_IMPORT_PATTERN] }],
        },
    },
);
