const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow bundling TFLite models + MediaPipe task files as assets
config.resolver.assetExts.push('tflite', 'task', 'bin', 'ort');

// Module resolution for reanimated + skia
config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'];

module.exports = config;
