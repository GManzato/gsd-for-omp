'use strict';

// English (default) messages for the gsd-for-omp host CLI and EoS bootstrap.
// Keys are flat and dotted by namespace. Add parallel keys to zh-CN.cjs.

module.exports = {
  'cli.usage': 'Usage: gsd-for-omp [install|update|uninstall|doctor|descriptor] [--root <path>] [--force] [--json]',

  'cli.error.unknownCommand': 'Unknown command: {command}',
  'cli.error.unknownArgument': 'Unknown argument: {arg}',
  'cli.error.rootRequiresPath': '--root requires a path',
  'cli.error.cannotReadManifest': 'Cannot read {path}: {message}',
  'cli.error.invalidManifest': 'Invalid gsd-for-omp manifest at {path}: {message}',
  'cli.error.unsupportedCore': 'gsd-for-omp requires @opengsd/gsd-core >={minimum}; found {version}',
  'cli.error.refusingOverwrite': 'Refusing to overwrite unmanaged or modified file: {path} (rerun with --force to replace GSD-owned projections)',
  'cli.error.updateCheckFailed': 'gsd-for-omp: could not check for updates (GitHub API unreachable or returned no release)',
  'cli.error.updateFailed': 'gsd-for-omp: update failed — npm install did not exit cleanly; run the tarball URL manually and then `gsd-for-omp install`',
  'cli.error.updateProjectionFailed': 'gsd-for-omp: update installed the new package but could not re-project OMP files; run `gsd-for-omp install` manually',

  'eos.error.unexpectedProfile': 'gsd-for-omp: EoS negotiation produced {profile}, expected programmatic-cli',
  'eos.error.unsupportedProtocol': 'gsd-for-omp: unsupported EoS protocol {version}',
};
