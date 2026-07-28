/**
 * @file scalar-static-page.util.ts
 * @description Generates the static HTML page that loads the Scalar API reference against a
 * pre-built OpenAPI JSON file — consumed by the offline doc build, not the running application.
 */

/**
 * Generates a static HTML template string configured to load Scalar API reference pointing to a local JSON file.
 *
 * @param jsonFilename Name of the static JSON specification file.
 * @param title Title of the documentation webpage.
 * @returns HTML document template string.
 */
export function generateStaticScalarHtml(jsonFilename: string, title: string): string {
    return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="./${jsonFilename}" data-configuration='{ "showOperationId": true, "operationsSorter": "method" }'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
