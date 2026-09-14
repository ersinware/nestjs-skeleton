/**
 * @file spectral-unicode.mjs
 * @description Adapts Unicode schema patterns for Spectral's flagless example validator.
 */
import { oas } from '@stoplight/spectral-rulesets';
import traverse from 'json-schema-traverse';
import rewritePattern from 'regexpu-core';

const compiledPatterns = new Map();

/**
 * Converts patterns on a private schema copy, preserving Spectral's example handling.
 * @param rule Built-in example rule to adapt.
 * @returns The rule with Unicode-aware pattern validation.
 */
function withUnicodePatterns(rule) {
    return {
        ...rule,
        then: {
            ...rule.then,
            function: function (target, options, context) {
                const adaptedTarget = JSON.parse(JSON.stringify(target)),
                    schema = options.schemaField === '$' ? adaptedTarget : adaptedTarget[options.schemaField];

                // Traverse schema keywords only: example payloads may themselves contain "pattern" fields.
                traverse(schema, (fragment) => {
                    if (typeof fragment.pattern !== 'string') {
                        return;
                    }

                    const pattern = fragment.pattern;

                    if (!compiledPatterns.has(pattern)) {
                        compiledPatterns.set(
                            pattern,
                            rewritePattern(pattern, 'u', {
                                unicodePropertyEscapes: 'transform',
                                unicodeFlag: 'transform',
                            }),
                        );
                    }

                    fragment.pattern = compiledPatterns.get(pattern);
                });

                return rule.then.function(adaptedTarget, options, context);
            },
        },
    };
}

export default {
    rules: {
        'oas3-valid-schema-example': withUnicodePatterns(oas.rules['oas3-valid-schema-example']),
        'oas3-valid-media-example': withUnicodePatterns(oas.rules['oas3-valid-media-example']),
    },
};
