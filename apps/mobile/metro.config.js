const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// Resolve .js imports to .ts files (shared package uses ESM .js extensions)
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js")) {
    const tsName = moduleName.replace(/\.js$/, ".ts");
    try {
      return (originalResolveRequest || context.resolveRequest)(
        context,
        tsName,
        platform,
      );
    } catch {
      // Fall through to default resolution
    }
  }
  return (originalResolveRequest || context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

// Inject polyfills before any app code (Metro guarantees this order)
const defaultGetPolyfills = config.serializer.getPolyfills;
config.serializer.getPolyfills = (options) => {
  const polyfills = defaultGetPolyfills
    ? defaultGetPolyfills(options)
    : [];
  return [
    path.resolve(projectRoot, "polyfills.js"),
    ...polyfills,
  ];
};

module.exports = withNativeWind(config, { input: "./global.css" });
