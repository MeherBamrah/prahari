const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow bundling .tflite and .task model files as assets
config.resolver.assetExts.push('tflite', 'task', 'bin', 'ort');

// Needed for @shopify/react-native-skia
config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'];

module.exports = config;
