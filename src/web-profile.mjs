// Target the upstream entry ID, not the plugin's exported name "web-app".
// Keep this in both the installed profile and every task overlay, so older
// profile installations cannot open a browser or print a launch token.
export const WEB_RUNTIME_PATCH = [
  '- id: web-runtime',
  '  config:',
  '    openBrowser: false',
  '    printUrl: false',
  '    surfaceContext: true',
].join('\n') + '\n';
