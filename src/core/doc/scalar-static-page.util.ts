/**
 * @file scalar-static-page.util.ts
 * @description Generates the static HTML page that renders the Scalar API reference with an
 * inline OpenAPI JSON document — consumed by the offline doc build, not the running application.
 */

/**
 * Generates a static HTML page embedding the OpenAPI specification inline so it works both over
 * HTTP and when opened directly via `file://` without CORS fetch failures.
 *
 * @param specJson Serialized OpenAPI JSON document.
 * @param title Title of the documentation webpage.
 * @returns HTML document template string.
 */
export function generateStaticScalarHtml(specJson: string, title: string): string {
    return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" type="application/json" data-configuration='{ "showOperationId": true, "operationsSorter": "method" }'>
${specJson}
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
