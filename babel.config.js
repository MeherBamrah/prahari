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
            '@screens': './src/screens',
            '@components': './src/components',
          },
        },
      ],
    ],
  };
};
