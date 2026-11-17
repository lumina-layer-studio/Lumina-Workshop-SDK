// Matches the Workshop manifest model's module ID and SemVer rules.
const moduleIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$(?![\s\S])/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$(?![\s\S])/;

export function validateIdentity(manifest) {
  if (typeof manifest?.id !== 'string' || manifest.id.length < 3 || manifest.id.length > 128 || !moduleIdPattern.test(manifest.id) || typeof manifest.version !== 'string' || !semverPattern.test(manifest.version)) throw new Error('Invalid module identity');
}
