module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@hooks': './src/hooks',
            '@utils': './src/utils',
            '@services': './src/services',
            '@store': './src/store',
            '@components': './src/components',
          },
        },
      ],
      // react-native-reanimated MUST be last
      'react-native-reanimated/plugin',
    ],
  };
};
